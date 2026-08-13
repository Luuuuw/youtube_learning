// Whisper JSON → VTT（带词级时间戳）
// 输入：Groq/OpenAI Whisper 返回的 { words: [{word, start, end}], text }
// 输出：WebVTT 字符串，每个 cue 嵌入 <hh:mm:ss.mmm> 词级时间戳
// 现有 vtt-parser.ts 的 extractWordTimings() 可直接解析
//
// 两种模式：
// - buildVttFromWhisper(text, words)：text 已由 DeepSeek 恢复标点 + 大小写，
//   按句号/问号/感叹号断句，每个句子一个 cue；过长的句子按逗号/停顿再切。
// - buildVttFromWords(words)：无标点恢复时的回退，按词数/时长/停顿断句 + 首字母大写。

interface WhisperWord {
  word: string;
  start: number;  // 秒
  end: number;    // 秒
}

interface VttCue {
  startTime: number;
  endTime: number;
  words: WhisperWord[];
}

interface AlignedToken {
  text: string;
  start: number;
  end: number;
}

export interface BuildVttOptions {
  maxWordsPerCue?: number;     // 默认 28
  maxDurationPerCue?: number;  // 秒，默认 10
  pauseThreshold?: number;     // 秒，gap > 此值则断句，默认 1.2
}

function fmtVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

const SENTENCE_END = /[.!?]$/;
// 兼容闭合引号/括号紧跟在句末标点之后（如 world." / world!)）
const SENTENCE_END_FULL = /[.!?]["')\]]*$/;
const CLAUSE_BREAK = /[,;:]$/;

// 判断 token 是否为真正的句末：排除缩写（J.K. / U.S. / Mr. / Dr. 等），
// 避免把 "J.K. Rowling" 这类缩写在句中错误断句。
function endsSentence(token: string): boolean {
  if (!SENTENCE_END_FULL.test(token)) return false;
  const core = token.replace(/["')\]]*$/, '');
  // 单个字母缩写（J. K. U. S.）或点分缩写（J.K. e.g. i.e. U.S.）
  if (/^[A-Za-z]\.$/.test(core)) return false;
  if (/^(?:[A-Za-z]\.){2,}$/.test(core)) return false;
  // 常见缩写
  if (/^(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Inc|Ltd|Co|Mt)\.$/i.test(core)) return false;
  return true;
}

function normalizeWord(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// Capitalize the word: first word of sentence, "i" → "I", etc.
function capitalizeWord(word: string, isSentenceStart: boolean): string {
  if (word === 'i') return 'I';
  if (word === "i'm") return "I'm";
  if (word === "i've") return "I've";
  if (word === "i'll") return "I'll";
  if (word === "i'd") return "I'd";
  if (isSentenceStart && /^[a-z]/.test(word)) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

function segmentSentences(words: WhisperWord[], pauseThreshold: number): WhisperWord[][] {
  const sentences: WhisperWord[][] = [];
  let current: WhisperWord[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    current.push(w);

    const isLast = i === words.length - 1;
    const endsSentence = SENTENCE_END.test(w.word);
    const nextWord = isLast ? null : words[i + 1];
    const hasLongPause = nextWord ? (nextWord.start - w.end) > pauseThreshold : false;

    if (isLast || endsSentence || hasLongPause) {
      sentences.push(current);
      current = [];
    }
  }

  return sentences;
}

function splitLongSentence(sentence: WhisperWord[], maxWords: number, maxDuration: number): WhisperWord[][] {
  const chunks: WhisperWord[][] = [];
  let chunk: WhisperWord[] = [];
  let chunkStart = sentence[0]?.start ?? 0;

  for (let i = 0; i < sentence.length; i++) {
    const w = sentence[i];
    const dur = w.end - chunkStart;
    const isClauseEnd = CLAUSE_BREAK.test(w.word);
    const nearingLimit = chunk.length >= maxWords - 3;
    const overLimit = chunk.length >= maxWords || dur > maxDuration;

    if (overLimit || (nearingLimit && isClauseEnd)) {
      if (chunk.length > 0) chunks.push(chunk);
      chunk = [];
      chunkStart = w.start;
    }
    chunk.push(w);
  }
  if (chunk.length > 0) chunks.push(chunk);

  return chunks;
}

export function buildVttFromWords(
  words: WhisperWord[],
  options: BuildVttOptions = {}
): string {
  if (!words || words.length === 0) return '';

  const maxWords = options.maxWordsPerCue ?? 20;
  const maxDuration = options.maxDurationPerCue ?? 8;
  const pauseThreshold = options.pauseThreshold ?? 1.2;

  const sentences = segmentSentences(words, pauseThreshold);
  const cues: VttCue[] = [];

  for (const sentence of sentences) {
    const dur = sentence[sentence.length - 1].end - sentence[0].start;
    if (sentence.length > maxWords || dur > maxDuration) {
      const chunks = splitLongSentence(sentence, maxWords, maxDuration);
      for (const chunk of chunks) {
        cues.push({
          startTime: chunk[0].start,
          endTime: chunk[chunk.length - 1].end,
          words: chunk,
        });
      }
    } else {
      cues.push({
        startTime: sentence[0].start,
        endTime: sentence[sentence.length - 1].end,
        words: sentence,
      });
    }
  }

  const lines: string[] = ['WEBVTT', ''];

  for (const cue of cues) {
    lines.push(`${fmtVttTime(cue.startTime)} --> ${fmtVttTime(cue.endTime)}`);

    const textParts: string[] = [];
    for (let i = 0; i < cue.words.length; i++) {
      const w = cue.words[i];
      const isFirstInCue = i === 0;
      const prevWord = i > 0 ? cue.words[i - 1].word : '';
      const isSentenceStart = isFirstInCue || SENTENCE_END.test(prevWord);
      const cap = capitalizeWord(w.word, isSentenceStart);
      textParts.push(`<${fmtVttTime(w.start)}>${cap} `);
    }
    lines.push(textParts.join('').trimEnd());
    lines.push('');
  }

  return lines.join('\n');
}

// 将恢复后的文本 token 与 whisper words 逐词对齐，返回每个 token 的起止时间。
// DeepSeek 严格保持词序不变，因此对齐几乎是 1:1；lookahead 3 仅用于跳过个别噪声词。
function alignTextToWords(
  tokens: string[],
  words: WhisperWord[]
): { tokens: AlignedToken[]; coverage: number } {
  const normWords = words.map(w => normalizeWord(w.word));
  const result: AlignedToken[] = [];
  let cursor = 0;
  let matched = 0;
  let denom = 0;

  for (const token of tokens) {
    const nt = normalizeWord(token);
    if (!nt) {
      // 纯标点/引号等无字母 token，附到上一个词的时间
      const prev = result[result.length - 1];
      result.push({ text: token, start: prev ? prev.end : 0, end: prev ? prev.end : 0 });
      continue;
    }

    denom++;
    let found = -1;
    for (let j = cursor; j < words.length && j < cursor + 3; j++) {
      if (normWords[j] === nt) {
        found = j;
        break;
      }
    }

    if (found >= 0) {
      const w = words[found];
      result.push({ text: token, start: w.start, end: w.end });
      cursor = found + 1;
      matched++;
    } else {
      // 未匹配：插值时间，避免丢失显示文本
      const prev = result[result.length - 1];
      const start = prev ? prev.end : 0;
      result.push({ text: token, start, end: start + 0.3 });
    }
  }

  const coverage = denom > 0 ? matched / denom : 1;
  return { tokens: result, coverage };
}

function makeCue(tokens: AlignedToken[]): VttCue {
  const words: WhisperWord[] = tokens.map(t => ({ word: t.text, start: t.start, end: t.end }));
  return {
    startTime: tokens[0].start,
    endTime: tokens[tokens.length - 1].end,
    words,
  };
}

// 过长的句子按逗号/分号/冒号或长停顿拆成多个 cue
function splitTokensToCues(
  tokens: AlignedToken[],
  maxWords: number,
  maxDuration: number,
  pauseThreshold: number
): VttCue[] {
  const cues: VttCue[] = [];
  let chunk: AlignedToken[] = [];
  let chunkStart = tokens[0].start;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const dur = t.end - chunkStart;
    const isClauseEnd = CLAUSE_BREAK.test(t.text);
    const next = tokens[i + 1];
    const hasLongPause = next ? (next.start - t.end) > pauseThreshold : false;
    const overLimit = chunk.length >= maxWords || dur > maxDuration;
    const atClauseNearLimit = isClauseEnd && chunk.length >= maxWords - 4;

    if (chunk.length > 0 && (overLimit || atClauseNearLimit || hasLongPause)) {
      cues.push(makeCue(chunk));
      chunk = [];
      chunkStart = t.start;
    }
    chunk.push(t);
  }
  if (chunk.length > 0) cues.push(makeCue(chunk));

  return cues;
}

function renderVtt(cues: VttCue[]): string {
  const lines: string[] = ['WEBVTT', ''];

  for (const cue of cues) {
    lines.push(`${fmtVttTime(cue.startTime)} --> ${fmtVttTime(cue.endTime)}`);

    const textParts: string[] = [];
    for (const w of cue.words) {
      textParts.push(`<${fmtVttTime(w.start)}>${w.word} `);
    }
    lines.push(textParts.join('').trimEnd());
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 用「已恢复标点 + 大小写」的文本与词级时间戳构建 VTT。
 * 优先按句子边界（.?!）断句；对齐覆盖不足或文本为空时回退到 buildVttFromWords。
 */
export function buildVttFromWhisper(
  text: string,
  words: WhisperWord[],
  options: BuildVttOptions = {}
): string {
  const maxWords = options.maxWordsPerCue ?? 28;
  const maxDuration = options.maxDurationPerCue ?? 10;
  const pauseThreshold = options.pauseThreshold ?? 1.2;

  if (!text || !text.trim() || !words || words.length === 0) {
    return buildVttFromWords(words, options);
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return buildVttFromWords(words, options);

  const { tokens: aligned, coverage } = alignTextToWords(tokens, words);
  // 对齐覆盖不足时回退，避免时间戳错配
  if (coverage < 0.8) {
    return buildVttFromWords(words, options);
  }

  // 按句子边界把对齐后的 token 分组
  const sentenceGroups: AlignedToken[][] = [];
  let current: AlignedToken[] = [];
  for (const t of aligned) {
    current.push(t);
    if (endsSentence(t.text)) {
      sentenceGroups.push(current);
      current = [];
    }
  }
  if (current.length > 0) sentenceGroups.push(current);

  const cues: VttCue[] = [];
  for (const group of sentenceGroups) {
    const dur = group[group.length - 1].end - group[0].start;
    if (group.length <= maxWords && dur <= maxDuration) {
      cues.push(makeCue(group));
    } else {
      cues.push(...splitTokensToCues(group, maxWords, maxDuration, pauseThreshold));
    }
  }

  return renderVtt(cues);
}
