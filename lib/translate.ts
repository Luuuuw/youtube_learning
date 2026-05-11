import fs from 'fs';
import path from 'path';
import { parseVtt, Subtitle } from '@/lib/vtt-parser';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const BATCH_SIZE = 20;
const MAX_CONCURRENT = 2;
const API_TIMEOUT_MS = 120_000;

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
  const lines = subtitles.map((s) => `[[ID:${s.id}]] ${s.text}`).join('\n');
  const expectedIds = subtitles.map((s) => s.id).join(', ');

  const systemPrompt =
    mode === 'translate'
      ? `# 字幕翻译指令

## 身份
你是专业视频字幕翻译官，精通英语到中文的口语化翻译。

## 核心规则（必须严格遵守）

### 规则1: 逐行独立翻译
- 每一行必须**独立翻译**，不要参考其他行的内容
- 不要将上一行的信息带入当前行的翻译
- 不要因为上下文而增减当前行的内容

### 规则2: 行数与ID一致
- 输出行数必须与输入行数**完全相等**
- 每行开头的 [[ID:数字]] 必须**原样保留**
- 严禁合并或拆分任何行

### 规则3: 精准翻译
- 准确翻译原文的每一个语义单元，不要遗漏
- 不要添加原文没有的内容
- 口语化表达，避免生硬直译
- 中文建议控制在15-20字以内

### 规则4: 专有名词保留
人名、地名、品牌名等专有名词保持英文原样
示例: Sally, Copenhagen, YouTube, React

### 规则5: 语气词处理
忽略无意义的填充词: uhm, uh, um, you know, right?
但保留有实际意义的语气词

### 规则6: 输出格式
- 只输出翻译结果，不要任何解释
- 不要使用Markdown代码块
- 不要使用特殊符号

## 输出示例

输入:
[[ID:1]] Good morning. I'm so happy this morning.
[[ID:2]] The sun is shining in Copenhagen.

输出:
[[ID:1]] 早上好。我今天早上好开心。
[[ID:2]] 哥本哈根阳光明媚。

## 待翻译内容
必须完整翻译以下ID: ${expectedIds}

`
      : `# 字幕审校指令

## 身份
你是专业字幕审校专家，负责修正机器翻译的质量问题。

## 审校规则

### 规则1: 保持结构不变
- 总行数必须与输入完全相等
- 所有 [[ID:数字]] 标识符必须原样保留

### 规则2: 修正重点
- 修正误译：确保中文准确传达英文原意
- 修正重复翻译：如果中文包含了不属于当前行的内容，删除多余部分
- 修正漏译：补充缺失的关键信息
- 优化表达：将生硬直译改为自然口语

### 规则3: 每行独立
- 每行翻译必须只对应当前行的英文原文
- 不要将其他行的内容混入当前行

### 规则4: 保留专有名词
人名、地名、品牌名保持英文原样

### 规则5: 只输出修正结果
不要输出任何解释或说明

## 输出格式
[[ID:N]] 修正后的中文翻译

## 待审校内容
必须完整处理以下ID: ${expectedIds}

`;

  const userPrompt =
    mode === 'translate'
      ? `${lines}`
      : `${lines}`;

  const content = await callMiniMax(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey
  );

  return parseTranslationResponse(content);
}

async function translateBatch(
  subtitles: SubtitleItem[],
  apiKey: string
): Promise<Map<number, string>> {
  const translated = await requestBatchTranslation(subtitles, apiKey, 'translate');
  if (translated.size === subtitles.length) return translated;

  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = subtitles.filter((s) => !translated.has(s.id));
    if (missing.length === 0) break;

    const retry = await requestBatchTranslation(missing, apiKey, 'translate');
    retry.forEach((text, id) => translated.set(id, text));
  }

  for (const s of subtitles) {
    if (!translated.has(s.id)) {
      translated.set(s.id, '');
    }
  }

  return translated;
}

async function reviewBatch(
  enSubtitles: SubtitleItem[],
  zhTranslations: Map<number, string>,
  apiKey: string
): Promise<Map<number, string>> {
  if (enSubtitles.length === 0) return zhTranslations;

  const subtitles = enSubtitles.map((s) => ({
    id: s.id,
    text: `EN: ${s.text}\nZH: ${zhTranslations.get(s.id) || ''}`,
  }));

  const reviewed = await requestBatchTranslation(subtitles, apiKey, 'review');
  if (reviewed.size === enSubtitles.length) return reviewed;

  // Keep already translated text as safe fallback when review misses ids.
  enSubtitles.forEach((s) => {
    if (!reviewed.has(s.id)) {
      const old = zhTranslations.get(s.id);
      if (old) reviewed.set(s.id, old);
    }
  });
  return reviewed;
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

  const batches: SubtitleItem[][] = [];
  for (let i = 0; i < translatableSubs.length; i += BATCH_SIZE) {
    batches.push(translatableSubs.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await runWithConcurrencyLimit(
    batches.map((batch) => () => translateBatch(batch, apiKey)),
    MAX_CONCURRENT
  );

  const allTranslations = new Map<number, string>();
  for (const result of batchResults) {
    result.forEach((text, id) => allTranslations.set(id, text));
  }

  const reviewResults = await runWithConcurrencyLimit(
    batches.map((batch) => () => reviewBatch(batch, allTranslations, apiKey)),
    MAX_CONCURRENT
  );

  const reviewedTranslations = new Map<number, string>();
  for (const result of reviewResults) {
    result.forEach((text, id) => reviewedTranslations.set(id, text));
  }

  const finalTranslations = new Map<number, string>();
  allTranslations.forEach((text, id) => {
    finalTranslations.set(id, reviewedTranslations.get(id) || text);
  });

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

  const translationMap: Record<number, string> = {};
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
    translationMap[sub.id] = translation;
    zhResult.push({
      id: sub.id,
      startTime: sub.startTime,
      endTime: sub.endTime,
      text: translation,
    });
  }

  fs.writeFileSync(zhJsonPath, JSON.stringify(translationMap, null, 2), 'utf-8');

  return zhResult;
}

const NON_SPEECH_RE = /^\s*(\[music\]|\[applause\]|\[laughter\]|\[coughs\]|\[sighs\]|\[groans\]|\[cheers\]|\[booing\]|\[indistinct\]|\[inaudible\])\s*$/i;
const SPEAKER_MARKER_RE = /^>>\s*/;
const FILLER_WORDS_RE = /\b(uh+|um+|uhm+|like,|you know,?)\b/gi;

function isNonSpeechLine(text: string): boolean {
  return NON_SPEECH_RE.test(text.trim());
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

  const batches: SubtitleItem[][] = [];
  for (let i = 0; i < translatableSubs.length; i += BATCH_SIZE) {
    batches.push(translatableSubs.slice(i, i + BATCH_SIZE));
  }

  const allTranslations = new Map<number, string>();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    try {
      const result = await translateBatch(batches[batchIdx], apiKey);
      result.forEach((text, id) => allTranslations.set(id, text));
    } catch (err) {
      console.error(`Batch ${batchIdx} translate failed:`, (err as Error).message);
    }
    if ((batchIdx + 1) % 5 === 0 || batchIdx === batches.length - 1) {
      console.log(`Translate progress: ${batchIdx + 1}/${batches.length} batches, ${allTranslations.size}/${translatableSubs.length} subtitles`);
    }
  }

  const reviewedTranslations = new Map<number, string>();

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const batchTranslations = new Map<number, string>();
    for (const s of batch) {
      const t = allTranslations.get(s.id);
      if (t !== undefined) batchTranslations.set(s.id, t);
    }
    if (batchTranslations.size === 0) continue;

    try {
      const result = await reviewBatch(batch, batchTranslations, apiKey);
      result.forEach((text, id) => reviewedTranslations.set(id, text));
    } catch (err) {
      console.error(`Batch ${batchIdx} review failed:`, (err as Error).message);
      batchTranslations.forEach((text, id) => reviewedTranslations.set(id, text));
    }
    if ((batchIdx + 1) % 5 === 0 || batchIdx === batches.length - 1) {
      console.log(`Review progress: ${batchIdx + 1}/${batches.length} batches`);
    }
  }

  const finalTranslations = new Map<number, string>();
  allTranslations.forEach((text, id) => {
    finalTranslations.set(id, reviewedTranslations.get(id) || text);
  });

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

  const translationMap: Record<number, string> = {};
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
    translationMap[enSub.id] = translation;
    zhResult.push({
      id: enSub.id,
      startTime: enSub.startTime,
      endTime: enSub.endTime,
      text: translation,
    });
  }

  fs.writeFileSync(zhJsonPath, JSON.stringify(translationMap, null, 2), 'utf-8');

  return zhResult;
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
