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
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const BATCH_SIZE = 8;
const MAX_CONCURRENT = 2;
const API_TIMEOUT_MS = 120_000;
const MAX_BATCH_RETRIES = 3;

interface SubtitleItem {
  id: number;
  text: string;
}

function parseRawVttForTranslation(vttContent: string): SubtitleItem[] {
  const lines = vttContent.split('\n');
  const result: SubtitleItem[] = [];
  let id = 1;
  let prevText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim() || line.trim() === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) {
      continue;
    }

    const timeMatch = line.match(
      /^(\d{2}):(\d{2}):(\d{2})[\.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[\.](\d{3})/
    );
    const shortTimeMatch = line.match(
      /^(\d{2}):(\d{2})[\.](\d{3})\s*-->\s*(\d{2}):(\d{2})[\.](\d{3})/
    );

    if (timeMatch || shortTimeMatch) {
      const textLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTime = nextLine.match(
          /^(\d{2}):(\d{2}):(\d{2})[\.](\d{3})\s*-->/
        ) || nextLine.match(
          /^(\d{2}):(\d{2})[\.](\d{3})\s*-->/
        );
        if (nextTime) break;
        if (nextLine.trim()) {
          textLines.push(nextLine.trim());
        }
        j++;
      }

      if (textLines.length >= 2) {
        const targetLine = textLines[1];
        const cleaned = targetLine
          .replace(/<\d+:\d+\.\d+><c>/g, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleaned && cleaned.length > 0 && cleaned !== prevText) {
          result.push({ id: id++, text: cleaned });
          prevText = cleaned;
        }
      }
    }
  }

  return result;
}

async function callMiniMax(messages: { role: string; content: string }[], apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'MiniMax-M2.5', messages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`MiniMax API 错误: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();

  const cleanedContent = content
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, '')
    .replace(/^\s*[\r\n]+/gm, '');

  const lines = cleanedContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const doubleBracketMatch = trimmed.match(/^\[\[ID:(\d+)\]\]\s*(.+)$/);
    if (doubleBracketMatch) {
      const id = parseInt(doubleBracketMatch[1], 10);
      const text = doubleBracketMatch[2].trim();
      if (!isNaN(id) && text) {
        result.set(id, text);
      }
      continue;
    }

    const singleBracketMatch = trimmed.match(/^\[(\d+)\]\s*(.+)$/);
    if (singleBracketMatch) {
      const id = parseInt(singleBracketMatch[1], 10);
      const text = singleBracketMatch[2].trim();
      if (!isNaN(id) && text) {
        result.set(id, text);
      }
    }
  }

  return result;
}

function parseJsonTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();

  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = (blockMatch?.[1] || content).trim();
  if (!jsonCandidate) return result;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (!Array.isArray(parsed)) return result;

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = Number((item as { id?: unknown }).id);
      const zh = String((item as { zh?: unknown }).zh || '').trim();
      if (!Number.isNaN(id) && zh) {
        result.set(id, zh);
      }
    }
  } catch {
    return result;
  }

  return result;
}

async function requestBatchTranslation(
  subtitles: SubtitleItem[],
  apiKey: string,
  mode: 'translate' | 'review'
): Promise<Map<number, string>> {
  // 优先用 JSON 数组格式（比 [[ID:N]] 文本稳定得多），fallback 回旧的文本格式
  const items = subtitles.map((s) => ({ id: s.id, text: s.text }));

  const systemPrompt =
    mode === 'translate'
      ? `你是专业视频字幕翻译，把每条英文翻译成自然口语化中文。

【输出格式】严格 JSON 数组，每项格式 { "id": 数字, "zh": "中文" }。
【必须】
- 必须返回输入的全部 ${items.length} 条，按 id 一一对应
- 每条独立翻译，但要参考上下文理解语义
- 中文 15-25 字以内，按中文语序，不要逐词直译
- 专有名词（人名/地名/品牌如 Sally, Copenhagen, YouTube）保留英文原样
- 忽略 "uhm/uh/um/you know" 等填充词
- 只输出 JSON 数组，不要任何解释、markdown、代码块`
      : `你是专业字幕审校专家，修正机器翻译质量。

【输出格式】严格 JSON 数组，每项 { "id": 数字, "zh": "修正后的中文" }。
【必须】
- 必须返回输入的全部 ${items.length} 条
- 修正语序、误译、漏译、生硬直译
- 保留专有名词的英文原样
- 只输出 JSON 数组，无任何解释`;

  const userPrompt = JSON.stringify(items);

  const content = await callMiniMax(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey
  );

  // 先尝试 JSON 解析（新格式），失败回退到 [[ID:N]] 文本解析（兼容老 prompt 偶尔遗留）
  const jsonResult = parseJsonTranslationResponse(content);
  if (jsonResult.size > 0) return jsonResult;
  return parseTranslationResponse(content);
}

async function translateBatch(
  subtitles: SubtitleItem[],
  apiKey: string
): Promise<Map<number, string>> {
  const translated = new Map<number, string>();

  // 1) 整批翻译，重试 MAX_BATCH_RETRIES 次直到全 / 收益边际
  for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
    const missing = subtitles.filter((s) => !translated.has(s.id));
    if (missing.length === 0) return translated;
    try {
      const result = await requestBatchTranslation(missing, apiKey, 'translate');
      result.forEach((text, id) => {
        if (text) translated.set(id, text);
      });
      if (translated.size === subtitles.length) return translated;
    } catch (err) {
      console.error(`[translate] batch attempt ${attempt + 1} failed:`, (err as Error).message);
    }
  }

  // 2) 单条 fallback：批仍不全的最后兜底，保证每条都尝试过单独翻译
  const stillMissing = subtitles.filter((s) => !translated.has(s.id));
  if (stillMissing.length > 0) {
    console.warn(`[translate] falling back to per-item translation for ${stillMissing.length} cues`);
    for (const sub of stillMissing) {
      try {
        const single = await requestBatchTranslation([sub], apiKey, 'translate');
        const text = single.get(sub.id);
        if (text) translated.set(sub.id, text);
      } catch (err) {
        console.error(`[translate] per-item ${sub.id} failed:`, (err as Error).message);
      }
    }
  }

  return translated;
}

// 审校阶段交给 DeepSeek（见 lib/deepseek.ts:reviewAndFillGaps）。
// 这里只保留一个工具函数：当 DeepSeek key 缺失时降级为"原样返回 MiniMax 结果"。
function passthroughReview(zhTranslations: Map<number, string>): Map<number, string> {
  return new Map(zhTranslations);
}

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing: Set<Promise<void>> = new Set();

  for (let i = 0; i < tasks.length; i++) {
    const taskIndex = i;
    const p = tasks[taskIndex]().then((result) => {
      results[taskIndex] = result;
    });
    executing.add(p);
    p.finally(() => executing.delete(p));

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

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

  fs.writeFileSync(zhJsonPath, JSON.stringify(tsMap, null, 2), 'utf-8');

  return zhResult;
}

const NON_SPEECH_RE = /^\s*(\[music\]|\[applause\]|\[laughter\]|\[coughs\]|\[sighs\]|\[groans\]|\[cheers\]|\[booing\]|\[indistinct\]|\[inaudible\]|\[laughs\]|\[clears throat\]|\[sneezes\]|\[whispers\]|\[gasps\]|\[sniffs\]|\[breathes\]|\[humming\]|\[singing\]|\[upbeat music\]|\[dramatic music\]|\[soft music\]|\[gentle music\]|\[suspenseful music\]|\[upbeat music playing\]|\[music playing\]|\[music continues\]|\[music fades\]|\[instrumental\]|\[intro music\]|\[outro music\]|\[background music\])\s*$/i;
const MUSIC_SYMBOL_RE = /^[♪♫🎵🎶\s\(\)\[\]]+$/;
const LYRICS_RE = /^\s*[♪♫]\s*.+[♪♫]\s*$/;
const SPEAKER_MARKER_RE = /^>>\s*/;
const FILLER_WORDS_RE = /\b(uh+|um+|uhm+|like,|you know,?)\b/gi;

function isNonSpeechLine(text: string): boolean {
  const trimmed = text.trim();
  if (NON_SPEECH_RE.test(trimmed)) return true;
  if (MUSIC_SYMBOL_RE.test(trimmed)) return true;
  if (LYRICS_RE.test(trimmed)) return true;
  if (/^\(.*music.*\)$/i.test(trimmed)) return true;
  if (/^\[.*music.*\]$/i.test(trimmed)) return true;
  return false;
}

function cleanSubtitleText(text: string): string {
  return text
    .replace(SPEAKER_MARKER_RE, '')
    .replace(FILLER_WORDS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
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

  fs.writeFileSync(zhJsonPath, JSON.stringify(tsMap, null, 2), 'utf-8');

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
