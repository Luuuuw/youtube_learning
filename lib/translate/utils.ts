export interface SubtitleItem {
  id: number;
  text: string;
}

export function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

export async function runWithConcurrencyLimit<T>(
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

const NON_SPEECH_RE = /^\s*(\[music\]|\[applause\]|\[laughter\]|\[coughs\]|\[sighs\]|\[groans\]|\[cheers\]|\[booing\]|\[indistinct\]|\[inaudible\]|\[laughs\]|\[clears throat\]|\[sneezes\]|\[whispers\]|\[gasps\]|\[sniffs\]|\[breathes\]|\[humming\]|\[singing\]|\[upbeat music\]|\[dramatic music\]|\[soft music\]|\[gentle music\]|\[suspenseful music\]|\[upbeat music playing\]|\[music playing\]|\[music continues\]|\[music fades\]|\[instrumental\]|\[intro music\]|\[outro music\]|\[background music\])\s*$/i;
const MUSIC_SYMBOL_RE = /^[♪♫🎵🎶\s\(\)\[\]]+$/;
const LYRICS_RE = /^\s*[♪♫]\s*.+[♪♫]\s*$/;
const SPEAKER_MARKER_RE = /^>>\s*/;
const FILLER_WORDS_RE = /\b(uh+|um+|uhm+|like,|you know,?)\b/gi;

export function isNonSpeechLine(text: string): boolean {
  const trimmed = text.trim();
  if (NON_SPEECH_RE.test(trimmed)) return true;
  if (MUSIC_SYMBOL_RE.test(trimmed)) return true;
  if (LYRICS_RE.test(trimmed)) return true;
  if (/^\(.*music.*\)$/i.test(trimmed)) return true;
  if (/^\[.*music.*\]$/i.test(trimmed)) return true;
  return false;
}

export function cleanSubtitleText(text: string): string {
  return text
    .replace(SPEAKER_MARKER_RE, '')
    .replace(FILLER_WORDS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 审校阶段交给 DeepSeek（见 lib/deepseek.ts:reviewAndFillGaps）。
// 这里只保留一个工具函数：当 DeepSeek key 缺失时降级为"原样返回 MiniMax 结果"。
export function passthroughReview(zhTranslations: Map<number, string>): Map<number, string> {
  return new Map(zhTranslations);
}
