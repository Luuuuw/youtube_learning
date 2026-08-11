import fs from 'fs';
import path from 'path';
import { parseVtt, Subtitle } from '@/lib/vtt-parser';
import { invalidateVideoCache } from '@/lib/videos';
import { reviewAndFillGaps } from '@/lib/deepseek';
import {
  loadState,
  initState,
  saveState,
  markDone,
  markFailed,
  getDoneTranslation,
  cueKey,
  countDone,
} from '@/lib/translate-state';
import { AI_MODELS } from '@/lib/ai-models';
import { safeAiWrite, buildProposal } from '@/lib/safe-ai-write';
import { mustRecordModel, mustAllZhBeChinese } from '@/lib/ai-invariants';
import { translateBatch } from './api';
import {
  SubtitleItem,
  formatVttTime,
  runWithConcurrencyLimit,
  isNonSpeechLine,
  cleanSubtitleText,
  passthroughReview,
} from './utils';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const BATCH_SIZE = 8;
const MAX_CONCURRENT = 2;

export async function translateSubtitlesForVideo(
  videoId: string,
  subtitles: Subtitle[]
): Promise<Subtitle[]> {
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  const zhJsonPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');

  if (fs.existsSync(zhVttPath)) {
    try {
      if (fs.existsSync(zhJsonPath)) {
        const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
        const entries = Object.entries(jsonMap) as [string, string][];
        const isTimestampKey = entries.some(([k]) => k.includes('-'));
        if (isTimestampKey) {
          const tsMap = new Map<string, string>();
          for (const [k, v] of entries) {
            if (v && v.trim()) tsMap.set(k, v);
          }
          return subtitles.map(sub => {
            const tsKey = `${sub.startTime.toFixed(3)}-${sub.endTime.toFixed(3)}`;
            let text = tsMap.get(tsKey) || '';
            if (!text) {
              const candidates = Array.from(tsMap.entries());
              for (const [k, v] of candidates) {
                const [s, e] = k.split('-').map(Number);
                if (Math.abs(s - sub.startTime) < 0.15 && Math.abs(e - sub.endTime) < 0.15) {
                  text = v;
                  break;
                }
              }
            }
            return { id: sub.id, startTime: sub.startTime, endTime: sub.endTime, text };
          });
        }
        return subtitles.map(sub => ({
          id: sub.id,
          startTime: sub.startTime,
          endTime: sub.endTime,
          text: jsonMap[sub.id] || '',
        }));
      }
      return parseVtt(fs.readFileSync(zhVttPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey || subtitles.length === 0) return [];

  const translatableSubs: SubtitleItem[] = [];
  const isNonSpeech: boolean[] = [];

  for (const sub of subtitles) {
    const cleaned = cleanSubtitleText(sub.text);
    if (isNonSpeechLine(cleaned) || !cleaned) {
      isNonSpeech.push(true);
      continue;
    }
    isNonSpeech.push(false);
    translatableSubs.push({ id: sub.id, text: cleaned });
  }

  if (translatableSubs.length === 0) return [];

  // 状态持久化：已 done 的 cue 直接复用
  const cueTimeById = new Map<number, { start: number; end: number }>();
  for (const sub of subtitles) {
    cueTimeById.set(sub.id, { start: sub.startTime, end: sub.endTime });
  }
  const state = initState(videoId, translatableSubs.length, loadState(videoId));

  const allTranslations = new Map<number, string>();
  const remaining: SubtitleItem[] = [];
  for (const ts of translatableSubs) {
    const t = cueTimeById.get(ts.id);
    if (!t) { remaining.push(ts); continue; }
    const cached = getDoneTranslation(state, cueKey(t.start, t.end), ts.text);
    if (cached) allTranslations.set(ts.id, cached);
    else remaining.push(ts);
  }
  if (allTranslations.size > 0) {
    console.log(`[translate] ${videoId} 复用状态文件 ${allTranslations.size}/${translatableSubs.length} 条，剩余 ${remaining.length} 条待翻译`);
  }

  const batches: SubtitleItem[][] = [];
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    batches.push(remaining.slice(i, i + BATCH_SIZE));
  }

  const runBatchWithState = async (batch: SubtitleItem[]): Promise<Map<number, string>> => {
    let result: Map<number, string>;
    try {
      result = await translateBatch(batch, apiKey);
    } catch (err) {
      console.error('[translate] batch failed:', (err as Error).message);
      result = new Map();
    }
    for (const sub of batch) {
      const t = cueTimeById.get(sub.id);
      if (!t) continue;
      const key = cueKey(t.start, t.end);
      const zh = result.get(sub.id);
      if (zh) markDone(state, key, sub.text, zh, 'minimax');
      else markFailed(state, key, sub.text);
    }
    saveState(state);
    return result;
  };

  const batchResults = await runWithConcurrencyLimit(
    batches.map((batch) => () => runBatchWithState(batch)),
    MAX_CONCURRENT
  );

  for (const result of batchResults) {
    result.forEach((text, id) => allTranslations.set(id, text));
  }

  // DeepSeek 审校 + 补漏（缺 key 时降级为直接用 MiniMax 结果）
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const finalTranslations = deepseekKey
    ? await reviewAndFillGaps(translatableSubs, allTranslations, deepseekKey)
    : passthroughReview(allTranslations);

  // 回写 DeepSeek 改动到 state
  for (const sub of translatableSubs) {
    const t = cueTimeById.get(sub.id);
    if (!t) continue;
    const key = cueKey(t.start, t.end);
    const finalZh = finalTranslations.get(sub.id);
    if (!finalZh) continue;
    const mmZh = allTranslations.get(sub.id);
    if (finalZh !== mmZh) {
      markDone(state, key, sub.text, finalZh, 'deepseek');
    } else if (!state.cues[key] || state.cues[key].status !== 'done') {
      markDone(state, key, sub.text, finalZh, 'minimax');
    }
  }
  saveState(state);

  const lines = ['WEBVTT', ''];
  let transIdx = 0;

  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    lines.push(`${formatVttTime(sub.startTime)} --> ${formatVttTime(sub.endTime)}`);

    if (isNonSpeech[i]) {
      lines.push(sub.text.trim());
    } else if (transIdx < translatableSubs.length) {
      const zh = finalTranslations.get(translatableSubs[transIdx].id) || '';
      lines.push(zh);
      transIdx++;
    } else {
      lines.push('');
    }

    lines.push('');
  }

  fs.writeFileSync(zhVttPath, lines.join('\n'), 'utf-8');

  // 用时间戳作为 key，避免 ID 不匹配
  const tsMap: Record<string, string> = {};
  const zhResult: Subtitle[] = [];
  let transIdx2 = 0;
  for (let i = 0; i < subtitles.length; i++) {
    const sub = subtitles[i];
    let translation = '';
    if (isNonSpeech[i]) {
      translation = sub.text.trim();
    } else if (transIdx2 < translatableSubs.length) {
      translation = finalTranslations.get(translatableSubs[transIdx2].id) || '';
      transIdx2++;
    }
    if (translation) {
      const tsKey = `${sub.startTime.toFixed(3)}-${sub.endTime.toFixed(3)}`;
      tsMap[tsKey] = translation;
    }
    zhResult.push({
      id: sub.id,
      startTime: sub.startTime,
      endTime: sub.endTime,
      text: translation,
    });
  }

  // Safe-Mutation：主翻译流程不能 HITL 阻塞，走 medium（snapshot + audit log）
  let oldZhMap: Record<string, string> | undefined;
  try {
    if (fs.existsSync(zhJsonPath)) {
      oldZhMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
    }
  } catch {
    oldZhMap = undefined;
  }
  const proposalA = buildProposal({
    operation: 'translate-full-video',
    targetFile: zhJsonPath,
    before: oldZhMap,
    after: tsMap,
    metadata: {
      model: `${AI_MODELS.minimax_chat.id}+${AI_MODELS.deepseek_chat.id}`,
      videoId,
      cueCount: zhResult.length,
      zhMap: tsMap,
    },
    actor: 'system:translate-pipeline',
  });
  await safeAiWrite(
    proposalA,
    { riskLevel: 'medium', invariants: [mustRecordModel, mustAllZhBeChinese] },
    () => {
      fs.writeFileSync(zhJsonPath, JSON.stringify(tsMap, null, 2), 'utf-8');
    },
  );

  // 翻译完成后自动 AI 二审 + 顺序重译标红段。AUTO_REVIEW_TRANSLATION=0 跳过；失败 silent。
  try {
    const { autoReviewAndFix } = await import('@/lib/translation-review');
    await autoReviewAndFix(videoId);
  } catch (err) {
    console.warn(`[translate] ${videoId} auto-review 失败:`, (err as Error).message);
  }

  return zhResult;
}

export async function translateVideoFromRawVtt(videoId: string): Promise<Subtitle[]> {
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  const zhJsonPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');

  if (fs.existsSync(zhVttPath)) {
    try {
      if (fs.existsSync(zhJsonPath)) {
        const enVttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
        if (fs.existsSync(enVttPath)) {
          const en = parseVtt(fs.readFileSync(enVttPath, 'utf-8'));
          const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
          const entries = Object.entries(jsonMap) as [string, string][];
          const isTimestampKey = entries.some(([k]) => k.includes('-'));
          if (isTimestampKey) {
            const tsMap = new Map<string, string>();
            for (const [k, v] of entries) {
              if (v && v.trim()) tsMap.set(k, v);
            }
            return en.map(sub => {
              const tsKey = `${sub.startTime.toFixed(3)}-${sub.endTime.toFixed(3)}`;
              let text = tsMap.get(tsKey) || '';
              if (!text) {
                const candidates = Array.from(tsMap.entries());
                for (const [k, v] of candidates) {
                  const [s, e] = k.split('-').map(Number);
                  if (Math.abs(s - sub.startTime) < 0.15 && Math.abs(e - sub.endTime) < 0.15) {
                    text = v;
                    break;
                  }
                }
              }
              return { id: sub.id, startTime: sub.startTime, endTime: sub.endTime, text };
            });
          }
          return en.map(sub => ({
            id: sub.id,
            startTime: sub.startTime,
            endTime: sub.endTime,
            text: jsonMap[sub.id] || '',
          }));
        }
      }
      return parseVtt(fs.readFileSync(zhVttPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  const enVttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(enVttPath)) return [];

  const rawVtt = fs.readFileSync(enVttPath, 'utf-8');

  const finalEnSubtitles = parseVtt(rawVtt);
  if (finalEnSubtitles.length === 0) return [];

  const translatableSubs: SubtitleItem[] = [];
  const isNonSpeech: boolean[] = [];

  for (const sub of finalEnSubtitles) {
    const cleaned = cleanSubtitleText(sub.text);
    if (isNonSpeechLine(cleaned) || !cleaned) {
      isNonSpeech.push(true);
      continue;
    }
    isNonSpeech.push(false);
    translatableSubs.push({ id: sub.id, text: cleaned });
  }

  if (translatableSubs.length === 0) return [];

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return [];

  // 状态持久化：相同 (start,end) 已 done 的 cue 直接复用，避免重复 API 调用
  const cueTimeById = new Map<number, { start: number; end: number }>();
  for (const sub of finalEnSubtitles) {
    cueTimeById.set(sub.id, { start: sub.startTime, end: sub.endTime });
  }
  const state = initState(videoId, translatableSubs.length, loadState(videoId));

  const allTranslations = new Map<number, string>();
  const remaining: SubtitleItem[] = [];
  for (const ts of translatableSubs) {
    const t = cueTimeById.get(ts.id);
    if (!t) { remaining.push(ts); continue; }
    const cached = getDoneTranslation(state, cueKey(t.start, t.end), ts.text);
    if (cached) allTranslations.set(ts.id, cached);
    else remaining.push(ts);
  }
  if (allTranslations.size > 0) {
    console.log(`[translate] ${videoId} 复用状态文件 ${allTranslations.size}/${translatableSubs.length} 条，剩余 ${remaining.length} 条待翻译`);
  }

  const batches: SubtitleItem[][] = [];
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    batches.push(remaining.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    try {
      const result = await translateBatch(batches[batchIdx], apiKey);
      for (const sub of batches[batchIdx]) {
        const t = cueTimeById.get(sub.id);
        if (!t) continue;
        const key = cueKey(t.start, t.end);
        const zh = result.get(sub.id);
        if (zh) {
          allTranslations.set(sub.id, zh);
          markDone(state, key, sub.text, zh, 'minimax');
        } else {
          markFailed(state, key, sub.text);
        }
      }
      saveState(state);
    } catch (err) {
      console.error(`Batch ${batchIdx} translate failed:`, (err as Error).message);
      for (const sub of batches[batchIdx]) {
        const t = cueTimeById.get(sub.id);
        if (t) markFailed(state, cueKey(t.start, t.end), sub.text);
      }
      saveState(state);
    }
    if ((batchIdx + 1) % 5 === 0 || batchIdx === batches.length - 1) {
      console.log(`Translate progress: ${batchIdx + 1}/${batches.length} batches, ${allTranslations.size}/${translatableSubs.length} subtitles (state-done=${countDone(state)})`);
    }
  }

  // DeepSeek 审校 + 补漏：替代过去用 MiniMax 逐批 review 的方式，一次调用搞定整批。
  // 缺 DEEPSEEK_API_KEY 时降级为直接用 MiniMax 结果（不阻塞主流程）。
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  let finalTranslations: Map<number, string>;
  if (deepseekKey) {
    try {
      finalTranslations = await reviewAndFillGaps(translatableSubs, allTranslations, deepseekKey);
    } catch (err) {
      console.error(`[translate] ${videoId} DeepSeek 审校失败，回退 MiniMax 结果:`, (err as Error).message);
      finalTranslations = new Map(allTranslations);
    }
  } else {
    console.warn('[translate] DEEPSEEK_API_KEY 未配置，跳过审校阶段');
    finalTranslations = new Map(allTranslations);
  }

  // DeepSeek 改过的条目要回写到 state，未改的保持 minimax 标记不变
  for (const sub of translatableSubs) {
    const t = cueTimeById.get(sub.id);
    if (!t) continue;
    const key = cueKey(t.start, t.end);
    const finalZh = finalTranslations.get(sub.id);
    if (!finalZh) continue;
    const mmZh = allTranslations.get(sub.id);
    if (finalZh !== mmZh) {
      markDone(state, key, sub.text, finalZh, 'deepseek');
    } else if (!state.cues[key] || state.cues[key].status !== 'done') {
      markDone(state, key, sub.text, finalZh, 'minimax');
    }
  }
  saveState(state);

  const coverage = finalTranslations.size / translatableSubs.length;
  if (coverage < 0.3) {
    console.warn(`[translate] ${videoId} 翻译覆盖率 ${Math.round(coverage * 100)}% < 30%，不写入文件（保留旧 zh-Hans 若存在）`);
    return [];
  }
  if (coverage < 0.95) {
    console.warn(`[translate] ${videoId} 翻译覆盖率 ${Math.round(coverage * 100)}%，写入但部分缺漏；可后续跑 scripts/fix-translation-gaps.mjs ${videoId} 补足`);
  }

  const lines = ['WEBVTT', ''];
  let transIdx = 0;

  for (let i = 0; i < finalEnSubtitles.length; i++) {
    const enSub = finalEnSubtitles[i];
    lines.push(`${formatVttTime(enSub.startTime)} --> ${formatVttTime(enSub.endTime)}`);

    if (isNonSpeech[i]) {
      lines.push(enSub.text.trim());
    } else if (transIdx < translatableSubs.length) {
      const zh = finalTranslations.get(translatableSubs[transIdx].id) || '';
      lines.push(zh);
      transIdx++;
    } else {
      lines.push('');
    }

    lines.push('');
  }

  fs.writeFileSync(zhVttPath, lines.join('\n'), 'utf-8');

  // 用 "startTime-endTime" 时间戳作为 key，避免 parseVtt 重新解析后 ID 不匹配
  const tsMap: Record<string, string> = {};
  const zhResult: Subtitle[] = [];
  let transIdx2 = 0;
  for (let i = 0; i < finalEnSubtitles.length; i++) {
    const enSub = finalEnSubtitles[i];
    let translation = '';
    if (isNonSpeech[i]) {
      translation = enSub.text.trim();
    } else if (transIdx2 < translatableSubs.length) {
      translation = finalTranslations.get(translatableSubs[transIdx2].id) || '';
      transIdx2++;
    }
    if (translation) {
      const tsKey = `${enSub.startTime.toFixed(3)}-${enSub.endTime.toFixed(3)}`;
      tsMap[tsKey] = translation;
    }
    zhResult.push({
      id: enSub.id,
      startTime: enSub.startTime,
      endTime: enSub.endTime,
      text: translation,
    });
  }

  // Safe-Mutation：主翻译流程不能 HITL 阻塞，走 medium（snapshot + audit log）
  let oldZhMapB: Record<string, string> | undefined;
  try {
    if (fs.existsSync(zhJsonPath)) {
      oldZhMapB = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
    }
  } catch {
    oldZhMapB = undefined;
  }
  const proposalB = buildProposal({
    operation: 'translate-full-video',
    targetFile: zhJsonPath,
    before: oldZhMapB,
    after: tsMap,
    metadata: {
      model: `${AI_MODELS.minimax_chat.id}+${AI_MODELS.deepseek_chat.id}`,
      videoId,
      cueCount: zhResult.length,
      zhMap: tsMap,
    },
    actor: 'system:translate-pipeline',
  });
  await safeAiWrite(
    proposalB,
    { riskLevel: 'medium', invariants: [mustRecordModel, mustAllZhBeChinese] },
    () => {
      fs.writeFileSync(zhJsonPath, JSON.stringify(tsMap, null, 2), 'utf-8');
    },
  );

  // 翻译完成后自动 AI 二审 + 顺序重译标红段。
  // AUTO_REVIEW_TRANSLATION=0 跳过；失败 silent，不阻塞主流程。
  try {
    const { autoReviewAndFix } = await import('@/lib/translation-review');
    await autoReviewAndFix(videoId);
  } catch (err) {
    console.warn(`[translate] ${videoId} auto-review 失败:`, (err as Error).message);
  }

  return zhResult;
}

// Fire-and-forget 后台翻译，避免阻塞页面渲染
const inflightTranslations = new Set<string>();
const TRANSLATE_TIMEOUT_MS = 5 * 60 * 1000; // 单个视频翻译上限 5 分钟

export function triggerBackgroundTranslation(videoId: string): void {
  if (inflightTranslations.has(videoId)) return;
  inflightTranslations.add(videoId);

  const timeout = setTimeout(() => {
    if (inflightTranslations.has(videoId)) {
      inflightTranslations.delete(videoId);
      console.warn(`[translate] ${videoId} 翻译超时 ${TRANSLATE_TIMEOUT_MS / 1000}s，已放弃`);
    }
  }, TRANSLATE_TIMEOUT_MS);

  translateVideoFromRawVtt(videoId)
    .then((result) => {
      if (result.length > 0) {
        try { saveZhSubtitles(videoId, result); } catch (e) { console.error('saveZhSubtitles failed:', e); }
        invalidateVideoCache(videoId);
        console.log(`[translate] ${videoId} 后台翻译完成 ${result.length} 条`);
      }
    })
    .catch((err) => {
      console.error(`[translate] ${videoId} 后台翻译失败:`, err?.message || err);
    })
    .finally(() => {
      clearTimeout(timeout);
      inflightTranslations.delete(videoId);
    });
}

export function saveZhSubtitles(videoId: string, subtitles: Subtitle[]): void {
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  const lines = ['WEBVTT', ''];
  const translationMap: Record<number, string> = {};
  for (const sub of subtitles) {
    const start = formatVttTime(sub.startTime);
    const end = formatVttTime(sub.endTime);
    lines.push(`${start} --> ${end}`);
    lines.push(sub.text);
    lines.push('');
    if (sub.text.trim()) {
      translationMap[sub.id] = sub.text;
    }
  }
  fs.writeFileSync(zhVttPath, lines.join('\n'), 'utf-8');

  const zhJsonPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');
  fs.writeFileSync(zhJsonPath, JSON.stringify(translationMap, null, 2), 'utf-8');
}

export function getVideosNeedingTranslation(): { videoId: string; hasEn: boolean; hasZh: boolean }[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const results: { videoId: string; hasEn: boolean; hasZh: boolean }[] = [];
  const dirs = fs.readdirSync(CONTENT_DIR);

  for (const dir of dirs) {
    const videoPath = path.join(CONTENT_DIR, dir, 'video.mp4');
    if (!fs.existsSync(videoPath)) continue;

    const enVttPath = path.join(CONTENT_DIR, dir, 'video.en.vtt');
    const zhVttPath = path.join(CONTENT_DIR, dir, 'video.zh-Hans.vtt');

    results.push({
      videoId: dir,
      hasEn: fs.existsSync(enVttPath),
      hasZh: fs.existsSync(zhVttPath),
    });
  }

  return results;
}
