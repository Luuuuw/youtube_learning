export interface WordTiming {
  word: string;
  startTime: number;
}

export interface Subtitle {
  id: number;
  startTime: number;
  endTime: number;
  text: string;
  translation?: string;
  wordTimings?: WordTiming[];
}

export interface ParseVttOptions {
  // For translated subtitles (e.g. zh), keep one cue per timestamp and avoid
  // English-oriented merge/split heuristics that can collapse many lines.
  preserveCues?: boolean;
}

function parseTime(h: string, m: string, s: string, ms: string): number {
  return parseInt(h || '0') * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function parseShortTime(m: string, s: string, ms: string): number {
  return parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

function cleanVttText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/>>\s*/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractWordTimings(text: string, cueStartTime?: number): WordTiming[] {
  const timings: WordTiming[] = [];
  const cleaned = text.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/>>\s*/g, '');

  const timeTagRegex = /<(\d{2}):(\d{2}):(\d{2})\.(\d{3})>/g;
  let lastEndTime = cueStartTime ?? 0;
  let match: RegExpExecArray | null;

  const stripped = cleaned.replace(/<\/?c>/g, '');

  const segments: { text: string; startTime: number }[] = [];
  let lastIndex = 0;

  timeTagRegex.lastIndex = 0;
  while ((match = timeTagRegex.exec(stripped)) !== null) {
    const beforeText = stripped.slice(lastIndex, match.index).trim();
    if (beforeText) {
      const words = beforeText.split(/\s+/).filter(Boolean);
      for (const w of words) {
        segments.push({ text: w, startTime: lastEndTime });
      }
    }
    lastEndTime = parseTime(match[1], match[2], match[3], match[4]);
    lastIndex = match.index + match[0].length;
  }

  const remaining = stripped.slice(lastIndex).replace(/<[^>]*>/g, '').trim();
  if (remaining) {
    const words = remaining.split(/\s+/).filter(Boolean);
    for (const w of words) {
      segments.push({ text: w, startTime: lastEndTime });
    }
  }

  for (const seg of segments) {
    timings.push({ word: seg.text, startTime: seg.startTime });
  }

  return timings;
}

function isContinuation(prev: Subtitle | null, currentStart: number): boolean {
  if (!prev) return false;
  const gap = currentStart - prev.endTime;
  return gap < 0.5;
}

function shouldMerge(prevText: string, currentText: string): boolean {
  const prevTrimmed = prevText.trim();
  const currentTrimmed = currentText.trim();

  // 如果两段文本完全相同，不合并（避免重复）
  if (prevTrimmed === currentTrimmed) {
    return false;
  }

  // 如果 current 完全包含在 prev 中，不合并
  if (prevTrimmed.includes(currentTrimmed)) {
    return false;
  }

  // 如果 prev 完全包含在 current 中，不合并
  if (currentTrimmed.includes(prevTrimmed)) {
    return false;
  }

  const prevEndsWithPunctuation = /[.!?]$/.test(prevTrimmed);
  const currentStartsWithCapital = /^[A-Z]/.test(currentTrimmed);

  if (prevEndsWithPunctuation && currentStartsWithCapital) {
    return false;
  }

  const currentFirstWord = currentTrimmed.split(/\s+/)[0]?.toLowerCase() || '';

  const conjunctions = ['and', 'but', 'or', 'so', 'because', 'when', 'if', 'that', 'which', 'who', 'where', 'what', 'how', 'why', 'whether', 'although', 'though', 'while', 'since', 'unless', 'until', 'before', 'after', 'as', 'than'];

  if (conjunctions.includes(currentFirstWord)) {
    return true;
  }

  if (!prevEndsWithPunctuation && !currentStartsWithCapital) {
    return true;
  }

  return false;
}

function endsSentence(text: string): boolean {
  return /[.!?。！？]["')\]]?$/.test(text.trim());
}

function startsLowercaseContinuation(text: string): boolean {
  return /^[a-z]/.test(text.trim());
}

function isPrefixByWords(shortText: string, longText: string): boolean {
  const s = shortText.trim().toLowerCase();
  const l = longText.trim().toLowerCase();
  if (!s || !l || s.length >= l.length) return false;
  if (l.startsWith(s)) return true;

  const sWords = s.split(/\s+/);
  const lWords = l.split(/\s+/);
  if (sWords.length === 0 || sWords.length > lWords.length) return false;
  for (let i = 0; i < sWords.length; i++) {
    if (sWords[i] !== lWords[i]) return false;
  }
  return true;
}

function isSuffixOverlap(prevText: string, curText: string): boolean {
  const pWords = prevText.trim().toLowerCase().split(/\s+/);
  const cWords = curText.trim().toLowerCase().split(/\s+/);
  if (pWords.length < 3 || cWords.length < 3) return false;

  const minOverlap = Math.min(3, Math.floor(pWords.length / 2));
  for (let len = minOverlap; len <= Math.min(pWords.length, cWords.length); len++) {
    const tail = pWords.slice(-len);
    const head = cWords.slice(0, len);
    let match = true;
    for (let k = 0; k < len; k++) {
      if (tail[k] !== head[k]) { match = false; break; }
    }
    if (match) return true;
  }
  return false;
}

function stabilizeEnglishCues(rawEntries: RawEntry[]): RawEntry[] {
  if (rawEntries.length === 0) return [];

  const kept: boolean[] = new Array(rawEntries.length).fill(true);

  for (let i = 0; i < rawEntries.length; i++) {
    if (!kept[i]) continue;
    const cur = rawEntries[i];

    for (let j = i + 1; j < rawEntries.length; j++) {
      if (!kept[j]) continue;
      const later = rawEntries[j];
      if (later.startTime - cur.startTime > 10) break;

      if (isPrefixByWords(cur.text, later.text) && later.endTime >= cur.endTime) {
        kept[i] = false;
        break;
      }
      if (isPrefixByWords(later.text, cur.text) && cur.endTime >= later.endTime) {
        kept[j] = false;
        continue;
      }
      if (isSuffixOverlap(cur.text, later.text) && later.endTime >= cur.endTime && later.text.length >= cur.text.length) {
        kept[i] = false;
        break;
      }

      const curDuration = cur.endTime - cur.startTime;
      const laterDuration = later.endTime - later.startTime;
      const overlap = Math.max(0, Math.min(cur.endTime, later.endTime) - Math.max(cur.startTime, later.startTime));
      const curOverlapRatio = curDuration > 0 ? overlap / curDuration : 0;
      const laterOverlapRatio = laterDuration > 0 ? overlap / laterDuration : 0;

      if (curOverlapRatio > 0.7 && later.text.length > cur.text.length * 1.3) {
        kept[i] = false;
        break;
      }
      if (laterOverlapRatio > 0.7 && cur.text.length > later.text.length * 1.3) {
        kept[j] = false;
      }
    }
  }

  const noDup: RawEntry[] = [];
  for (let i = 0; i < rawEntries.length; i++) {
    if (kept[i]) noDup.push(rawEntries[i]);
  }

  const merged: RawEntry[] = [];
  for (const entry of noDup) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...entry });
      continue;
    }

    const gap = entry.startTime - last.endTime;
    const lastEndsSentence = endsSentence(last.text);

    if (gap >= -0.02 && gap <= 1.5 && !lastEndsSentence) {
      last.text = `${last.text} ${entry.text}`.trim();
      last.endTime = Math.max(last.endTime, entry.endTime);
      if (last.wordTimings && entry.wordTimings) {
        last.wordTimings = [...last.wordTimings, ...entry.wordTimings];
      } else if (entry.wordTimings) {
        last.wordTimings = entry.wordTimings;
      }
    } else {
      merged.push({ ...entry });
    }
  }

  return merged;
}

const SENTENCE_END_RE = /(?<=[.!?])\s+(?=[A-Z"\[])|(?<=[.!?]")\s+(?=[A-Z])/g;
const MAX_WORDS_PER_SUB = 18;

function splitWordTimings(timings: WordTiming[], startWord: number, endWord: number): WordTiming[] | undefined {
  if (!timings || timings.length === 0) return undefined;
  const slice = timings.slice(startWord, endWord);
  return slice.length > 0 ? slice : undefined;
}

function splitLongSentences(subtitles: Subtitle[]): Subtitle[] {
  const result: Subtitle[] = [];
  let id = 1;

  for (const sub of subtitles) {
    const words = sub.text.split(/\s+/);
    const duration = sub.endTime - sub.startTime;

    if (words.length <= MAX_WORDS_PER_SUB) {
      result.push({ ...sub, id: id++ });
      continue;
    }

    const sentences = sub.text.split(SENTENCE_END_RE).filter(Boolean);

    if (sentences.length > 1) {
      const chunks: { text: string; wordCount: number }[] = [];
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (!trimmed) continue;
        const sWords = trimmed.split(/\s+/).length;
        if (sWords <= MAX_WORDS_PER_SUB) {
          chunks.push({ text: trimmed, wordCount: sWords });
        } else {
          const sWords = trimmed.split(/\s+/);
          const chunkSize = MAX_WORDS_PER_SUB;
          for (let i = 0; i < sWords.length; i += chunkSize) {
            const chunk = sWords.slice(i, i + chunkSize).join(' ');
            chunks.push({ text: chunk, wordCount: Math.min(chunkSize, sWords.length - i) });
          }
        }
      }

      let wordOffset = 0;
      for (let i = 0; i < chunks.length; i++) {
        const chunkWords = chunks[i].wordCount;
        let segStart: number;
        let segEnd: number;

        if (sub.wordTimings && sub.wordTimings.length > 0) {
          const firstTiming = sub.wordTimings[wordOffset];
          segStart = firstTiming ? firstTiming.startTime : sub.startTime;
          const nextTiming = sub.wordTimings[wordOffset + chunkWords];
          segEnd = nextTiming ? nextTiming.startTime : sub.endTime;
        } else {
          const totalWords = words.length;
          const charRatio = chunkWords / totalWords;
          segStart = i === 0 ? sub.startTime : sub.startTime + duration * (wordOffset / totalWords);
          segEnd = i === chunks.length - 1 ? sub.endTime : sub.startTime + duration * ((wordOffset + chunkWords) / totalWords);
        }

        result.push({
          id: id++,
          startTime: segStart,
          endTime: segEnd,
          text: chunks[i].text,
          wordTimings: splitWordTimings(sub.wordTimings || [], wordOffset, wordOffset + chunkWords),
        });
        wordOffset += chunkWords;
      }
    } else {
      const chunks: string[] = [];
      const chunkSize = Math.ceil(words.length / Math.ceil(words.length / MAX_WORDS_PER_SUB));
      for (let i = 0; i < words.length; i += chunkSize) {
        chunks.push(words.slice(i, i + chunkSize).join(' '));
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunkWordStart = i * chunkSize;
        const chunkWordEnd = Math.min((i + 1) * chunkSize, words.length);
        let segStart: number;
        let segEnd: number;

        if (sub.wordTimings && sub.wordTimings.length > 0) {
          const firstTiming = sub.wordTimings[chunkWordStart];
          segStart = firstTiming ? firstTiming.startTime : sub.startTime;
          const nextTiming = sub.wordTimings[chunkWordEnd];
          segEnd = nextTiming ? nextTiming.startTime : sub.endTime;
        } else {
          const segDuration = duration / chunks.length;
          segStart = sub.startTime + segDuration * i;
          segEnd = i === chunks.length - 1 ? sub.endTime : sub.startTime + segDuration * (i + 1);
        }

        result.push({
          id: id++,
          startTime: segStart,
          endTime: segEnd,
          text: chunks[i],
          wordTimings: splitWordTimings(sub.wordTimings || [], chunkWordStart, chunkWordEnd),
        });
      }
    }
  }

  return result;
}

export function parseVtt(vttContent: string, options: ParseVttOptions = {}): Subtitle[] {
  if (!vttContent || typeof vttContent !== 'string') return [];
  try {
    if (options.preserveCues) {
      return parseVttPreserveCues(vttContent);
    }
    return parseVttInternal(vttContent);
  } catch {
    return [];
  }
}

interface RawEntry {
  startTime: number;
  endTime: number;
  text: string;
  wordTimings?: WordTiming[];
}

function extractRawEntries(vttContent: string, keepEmpty: boolean = false): RawEntry[] {
  const lines = vttContent.split('\n');
  const allEntries: RawEntry[] = [];

  let currentStart = 0;
  let currentEnd = 0;
  let currentText = '';
  let currentRawText = '';

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
      if (currentText || keepEmpty) {
        const cleaned = cleanVttText(currentText);
        if (cleaned || keepEmpty) {
          const wordTimings = extractWordTimings(currentRawText, currentStart);
          allEntries.push({
            startTime: currentStart,
            endTime: currentEnd,
            text: cleaned,
            wordTimings: wordTimings.length > 0 ? wordTimings : undefined,
          });
        }
      }

      if (timeMatch) {
        currentStart = parseTime(timeMatch[1], timeMatch[2], timeMatch[3], timeMatch[4]);
        currentEnd = parseTime(timeMatch[5], timeMatch[6], timeMatch[7], timeMatch[8]);
      } else if (shortTimeMatch) {
        currentStart = parseShortTime(shortTimeMatch[1], shortTimeMatch[2], shortTimeMatch[3]);
        currentEnd = parseShortTime(shortTimeMatch[4], shortTimeMatch[5], shortTimeMatch[6]);
      }
      currentText = '';
      currentRawText = '';
    } else {
      currentText += line + '\n';
      currentRawText += line + '\n';
    }
  }

  if (currentText || keepEmpty) {
    const cleaned = cleanVttText(currentText);
    if (cleaned || keepEmpty) {
      const wordTimings = extractWordTimings(currentRawText, currentStart);
      allEntries.push({
        startTime: currentStart,
        endTime: currentEnd,
        text: cleaned,
        wordTimings: wordTimings.length > 0 ? wordTimings : undefined,
      });
    }
  }

  if (allEntries.length === 0) return [];

  const isShort = allEntries.map(e => (e.endTime - e.startTime) < 0.05);
  const hasProgressiveReveal = isShort.filter(s => s).length > isShort.filter(s => !s).length * 0.5;

  if (!hasProgressiveReveal) {
    return allEntries;
  }

  function mapWordTimingsToText(
    sourceTimings: WordTiming[],
    sourceText: string,
    targetText: string
  ): WordTiming[] | undefined {
    if (!sourceTimings || sourceTimings.length === 0) return undefined;
    const sourceWords = sourceText.split(/\s+/).filter(Boolean);
    const targetWords = targetText.split(/\s+/).filter(Boolean);

    for (let offset = 0; offset <= sourceWords.length - targetWords.length; offset++) {
      let match = true;
      for (let k = 0; k < targetWords.length; k++) {
        if (sourceWords[offset + k].toLowerCase() !== targetWords[k].toLowerCase()) {
          match = false;
          break;
        }
      }
      if (match) {
        return sourceTimings.slice(offset, offset + targetWords.length);
      }
    }

    return undefined;
  }

  const result: RawEntry[] = [];
  for (let i = 0; i < allEntries.length; i++) {
    if (!isShort[i]) continue;

    const shortEntry = allEntries[i];
    let bestLong: RawEntry | null = null;
    let bestOverlap = 0;

    for (let j = Math.max(0, i - 2); j <= Math.min(allEntries.length - 1, i + 2); j++) {
      if (isShort[j]) continue;
      const longEntry = allEntries[j];
      if (longEntry.text.includes(shortEntry.text) || shortEntry.text.includes(longEntry.text)) {
        const overlap = Math.min(shortEntry.text.length, longEntry.text.length);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestLong = longEntry;
        }
      }
    }

    if (bestLong) {
      const mappedTimings = bestLong.wordTimings
        ? mapWordTimingsToText(bestLong.wordTimings, bestLong.text, shortEntry.text)
        : undefined;
      result.push({
        startTime: bestLong.startTime,
        endTime: bestLong.endTime,
        text: shortEntry.text,
        wordTimings: mappedTimings ?? shortEntry.wordTimings,
      });
    } else {
      let prevLong: RawEntry | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (!isShort[j]) { prevLong = allEntries[j]; break; }
      }
      let nextLong: RawEntry | null = null;
      for (let j = i + 1; j < allEntries.length; j++) {
        if (!isShort[j]) { nextLong = allEntries[j]; break; }
      }

      const startTime = prevLong ? prevLong.startTime : shortEntry.startTime;
      const endTime = nextLong ? nextLong.endTime : shortEntry.endTime;
      result.push({
        startTime,
        endTime,
        text: shortEntry.text,
        wordTimings: shortEntry.wordTimings,
      });
    }
  }

  return result;
}

function parseVttPreserveCues(vttContent: string): Subtitle[] {
  const rawEntries = extractRawEntries(vttContent, true);
  const seen = new Set<string>();
  const result: Subtitle[] = [];
  let id = 1;

  for (const entry of rawEntries) {
    if (!entry.text.trim()) continue;
    const key = `${entry.startTime.toFixed(3)}-${entry.endTime.toFixed(3)}-${entry.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      id: id++,
      startTime: entry.startTime,
      endTime: entry.endTime,
      text: entry.text,
      wordTimings: entry.wordTimings,
    });
  }

  return result;
}

function parseVttInternal(vttContent: string): Subtitle[] {
  const rawEntries = stabilizeEnglishCues(extractRawEntries(vttContent));

  const seen = new Set<string>();
  const deduped: typeof rawEntries = [];
  for (const entry of rawEntries) {
    const key = `${entry.startTime.toFixed(2)}-${entry.endTime.toFixed(2)}-${entry.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }

  const finalDeduped: typeof rawEntries = [];
  for (const entry of deduped) {
    const last = finalDeduped[finalDeduped.length - 1];
    if (last && last.text === entry.text) {
      last.endTime = Math.max(last.endTime, entry.endTime);
      if (entry.wordTimings) {
        last.wordTimings = entry.wordTimings;
      }
      continue;
    }
    finalDeduped.push({ ...entry });
  }

  const merged: Subtitle[] = [];
  let id = 1;

  for (const entry of finalDeduped) {
    const last = merged[merged.length - 1] || null;

    if (last && !endsSentence(last.text)) {
      last.text += ' ' + entry.text;
      last.endTime = entry.endTime;
      if (last.wordTimings && entry.wordTimings) {
        last.wordTimings = [...last.wordTimings, ...entry.wordTimings];
      } else if (entry.wordTimings) {
        last.wordTimings = entry.wordTimings;
      }
    } else {
      merged.push({
        id: id++,
        startTime: entry.startTime,
        endTime: entry.endTime,
        text: entry.text,
        wordTimings: entry.wordTimings,
      });
    }
  }

  return splitLongSentences(merged);
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
