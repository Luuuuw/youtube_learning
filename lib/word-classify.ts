import { getLocalDictEntry } from './local-dict';
import stopList from '@/data/word-lists/stop.json';
import basicList from '@/data/word-lists/basic.json';
import cet4List from '@/data/word-lists/cet4.json';
import cet6List from '@/data/word-lists/cet6.json';
import ieltsList from '@/data/word-lists/ielts.json';

// ── Legacy types (kept for backward compat with subtitle highlighting) ──

export type WordCategory = 'verb' | 'noun' | 'adj' | 'adv' | 'prep' | 'pron' | 'conj' | 'det' | 'num' | 'int' | 'art' | 'other';

export interface WordClassResult {
  category: WordCategory;
  label: string;
  color: string;
  bgColor: string;
  isKeyVocab: boolean;
}

// ── New: Learning priority ──

export type LearningPriority = 'core' | 'advanced' | 'basic';

export type ExamLevel = '四级' | '六级' | '考研' | '雅思' | '托福' | '专八';

export interface VideoVocabEntry {
  word: string;
  count: number;
  priority: LearningPriority;
  /** First subtitle index where this word appears */
  firstIndex: number;
  /** Local dict definition (if available) */
  definition: string | null;
  /** Part-of-speech label from local dict */
  pos: string | null;
  /** Exam level tag */
  examLevel: ExamLevel | null;
}

const CATEGORY_CONFIG: Record<WordCategory, { label: string; color: string; bgColor: string }> = {
  verb: { label: '动词', color: 'text-green-700 dark:text-green-300', bgColor: 'bg-green-100 dark:bg-green-900/40' },
  noun: { label: '名词', color: 'text-blue-700 dark:text-blue-300', bgColor: 'bg-blue-100 dark:bg-blue-900/40' },
  adj: { label: '形容词', color: 'text-amber-700 dark:text-amber-300', bgColor: 'bg-amber-100 dark:bg-amber-900/40' },
  adv: { label: '副词', color: 'text-purple-700 dark:text-purple-300', bgColor: 'bg-purple-100 dark:bg-purple-900/40' },
  prep: { label: '介词', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-100 dark:bg-slate-800/30' },
  pron: { label: '代词', color: 'text-pink-700 dark:text-pink-300', bgColor: 'bg-pink-100 dark:bg-pink-900/30' },
  conj: { label: '连词', color: 'text-teal-700 dark:text-teal-300', bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  det: { label: '限定词', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
  num: { label: '数字', color: 'text-indigo-700 dark:text-indigo-300', bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  int: { label: '感叹词', color: 'text-red-700 dark:text-red-300', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  art: { label: '冠词', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
  other: { label: '其他', color: 'text-gray-500 dark:text-gray-400', bgColor: 'bg-gray-100 dark:bg-gray-800/20' },
};

const KEY_VOCAB_CATEGORIES = new Set<WordCategory>(['verb', 'noun', 'adj', 'adv']);

// 5 个词表：data/word-lists/*.json（scripts/migrate-word-lists.mjs 一次性搬过去）
// STOP_WORDS 外部 export 给 word-cache-preheat 等用；其它 4 个仅文件内部分级用
const STOP_WORDS = new Set(stopList as string[]);
const BASIC_WORDS = new Set(basicList as string[]);
const CET4_WORDS = new Set(cet4List as string[]);
const CET6_WORDS = new Set(cet6List as string[]);
const IELTS_WORDS = new Set(ieltsList as string[]);

function extractCategoryFromDefinition(definition: string): WordCategory {
  const d = definition.trim().toLowerCase();
  if (/^v\.|\/ v\.|\/v\./.test(d)) return 'verb';
  if (/^n\.|\/ n\.|\/n\./.test(d)) return 'noun';
  if (/^adj\.|\/ adj\.|\/adj\./.test(d)) return 'adj';
  if (/^adv\.|\/ adv\.|\/adv\./.test(d)) return 'adv';
  if (/^prep\.|\/ prep\.|\/prep\./.test(d)) return 'prep';
  if (/^pron\.|\/ pron\.|\/pron\./.test(d)) return 'pron';
  if (/^conj\.|\/ conj\.|\/conj\./.test(d)) return 'conj';
  if (/^det\.|\/ det\.|\/det\./.test(d)) return 'det';
  if (/^num\.|\/ num\.|\/num\./.test(d)) return 'num';
  if (/^int\.|\/ int\.|\/int\./.test(d)) return 'int';
  if (/^art\.|\/ art\.|\/art\./.test(d)) return 'art';
  return 'other';
}

function guessCategoryBySuffix(word: string): WordCategory {
  if (word.endsWith('ly')) return 'adv';
  if (/(?:tion|sion|ment|ness|ity|ance|ence|ism|ist|dom|ship|hood)$/.test(word)) return 'noun';
  if (/(?:ful|less|ous|ive|able|ible|al|ial|ical|ent|ant)$/.test(word)) return 'adj';
  if (/(?:ing|ed|ize|ify|ate|en)$/.test(word) && word.length > 4) return 'verb';
  return 'other';
}

function extractPosLabel(definition: string): string | null {
  const d = definition.trim();
  const match = d.match(/^(v\.|n\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.|int\.|art\.)/);
  return match ? match[1].replace('.', '') : null;
}

/**
 * Determine exam level for a word.
 */
function getExamLevel(word: string): ExamLevel | null {
  const w = word.toLowerCase();
  if (IELTS_WORDS.has(w)) return '雅思';
  if (CET6_WORDS.has(w)) return '六级';
  if (CET4_WORDS.has(w)) return '四级';
  // Words in local-dict but not in any exam list are likely basic
  if (getLocalDictEntry(w)) return null;
  // Unknown words are likely higher level
  return null;
}

/**
 * Check if a word is a valid English word (not a number, abbreviation, etc.)
 */
function isValidWord(word: string): boolean {
  const w = word.toLowerCase().trim();
  // Must be at least 2 chars
  if (w.length < 2) return false;
  // Must contain only letters (allow hyphen and apostrophe)
  if (!/^[a-z][a-z'-]*[a-z]$|^[a-z][a-z]$/i.test(w)) return false;
  // Must not be all same letter
  if (/^(.)\1+$/.test(w)) return false;
  // Must not be a number
  if (/^\d+$/.test(w)) return false;
  // Must not be a contraction fragment
  if (STOP_WORDS.has(w)) return false;
  return true;
}

export function classifyWord(rawWord: string): WordClassResult {
  const cleaned = rawWord.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();

  if (!cleaned || cleaned.length < 2) {
    return { ...CATEGORY_CONFIG.other, category: 'other', isKeyVocab: false };
  }

  const entry = getLocalDictEntry(cleaned);
  if (entry) {
    const category = extractCategoryFromDefinition(entry.definition);
    const config = CATEGORY_CONFIG[category];
    return {
      category,
      label: config.label,
      color: config.color,
      bgColor: config.bgColor,
      isKeyVocab: KEY_VOCAB_CATEGORIES.has(category) && !STOP_WORDS.has(cleaned),
    };
  }

  const category = guessCategoryBySuffix(cleaned);
  const config = CATEGORY_CONFIG[category];
  return {
    category,
    label: config.label,
    color: config.color,
    bgColor: config.bgColor,
    isKeyVocab: !STOP_WORDS.has(cleaned),
  };
}

/**
 * Extract vocab from subtitles grouped by learning priority.
 *
 * Priority rules:
 * - **core**: appears >= 2 times AND is a valid word → must-learn
 * - **advanced**: appears 1 time, NOT a basic/stop word, NOT in local-dict basic list → worth learning
 * - **basic**: in local-dict AND in BASIC_WORDS set → already known, skip
 */
export function getVideoVocab(subtitles: { text: string }[]): VideoVocabEntry[] {
  const wordMap = new Map<string, { count: number; firstIndex: number }>();

  for (let i = 0; i < subtitles.length; i++) {
    const words = subtitles[i].text.split(/\s+/);
    for (const w of words) {
      const cleaned = w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();
      if (!isValidWord(cleaned)) continue;

      const existing = wordMap.get(cleaned);
      if (existing) {
        existing.count++;
      } else {
        wordMap.set(cleaned, { count: 1, firstIndex: i });
      }
    }
  }

  const entries: VideoVocabEntry[] = [];

  wordMap.forEach((info, word) => {
    const localEntry = getLocalDictEntry(word);

    let definition: string | null = null;
    let pos: string | null = null;

    if (localEntry) {
      definition = `${localEntry.phonetic}\n${localEntry.definition}`;
      pos = extractPosLabel(localEntry.definition);
    }

    const examLevel = getExamLevel(word);

    let priority: LearningPriority;
    if (BASIC_WORDS.has(word)) {
      // Very common words → basic, even if they appear multiple times
      priority = info.count >= 3 ? 'core' : 'basic';
    } else if (info.count >= 2) {
      // Repeated words → core
      priority = 'core';
    } else if (localEntry && !BASIC_WORDS.has(word)) {
      // Has dict entry but not basic → advanced
      priority = 'advanced';
    } else {
      // No dict entry → likely advanced/uncommon
      priority = 'advanced';
    }

    entries.push({
      word,
      count: info.count,
      priority,
      firstIndex: info.firstIndex,
      definition,
      pos,
      examLevel,
    });
  });

  // Sort: core first (by count desc), then advanced (alpha), then basic (alpha)
  const priorityOrder: Record<LearningPriority, number> = { core: 0, advanced: 1, basic: 2 };
  entries.sort((a, b) => {
    if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    if (a.priority === 'core' && b.priority === 'core') {
      return b.count - a.count;
    }
    return a.word.localeCompare(b.word);
  });

  return entries;
}

/** Legacy function kept for backward compat — now delegates to getVideoVocab */
export function getKeyVocabFromSubtitles(subtitles: { text: string }[]): Map<string, WordClassResult & { count: number }> {
  const vocabMap = new Map<string, WordClassResult & { count: number }>();

  for (const sub of subtitles) {
    const words = sub.text.split(/\s+/);
    for (const w of words) {
      const cleaned = w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();
      if (!cleaned || cleaned.length < 3 || STOP_WORDS.has(cleaned)) continue;

      const existing = vocabMap.get(cleaned);
      if (existing) {
        existing.count++;
      } else {
        const result = classifyWord(cleaned);
        if (result.isKeyVocab) {
          vocabMap.set(cleaned, { ...result, count: 1 });
        }
      }
    }
  }

  return vocabMap;
}

export { CATEGORY_CONFIG, STOP_WORDS };
