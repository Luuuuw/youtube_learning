// Whisper JSON → VTT（带词级时间戳）
// 输入：Groq/OpenAI Whisper 返回的 { words: [{word, start, end}] }
// 输出：WebVTT 字符串，每个 cue 嵌入 <hh:mm:ss.mmm> 词级时间戳
// 现有 vtt-parser.ts 的 extractWordTimings() 可直接解析

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

export interface BuildVttOptions {
  maxWordsPerCue?: number;     // 默认 15
  maxDurationPerCue?: number;  // 秒，默认 8
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

  for (const w of sentence) {
    const dur = w.end - chunkStart;
    if (chunk.length >= maxWords || dur > maxDuration) {
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

  const maxWords = options.maxWordsPerCue ?? 15;
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
    for (const w of cue.words) {
      textParts.push(`<${fmtVttTime(w.start)}>${w.word} `);
    }
    lines.push(textParts.join('').trimEnd());
    lines.push('');
  }

  return lines.join('\n');
}
