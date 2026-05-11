import { getLocalDictEntry } from './local-dict';

export type WordCategory = 'verb' | 'noun' | 'adj' | 'adv' | 'prep' | 'pron' | 'conj' | 'det' | 'num' | 'int' | 'art' | 'other';

export interface WordClassResult {
  category: WordCategory;
  label: string;
  color: string;
  bgColor: string;
  isKeyVocab: boolean;
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

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'am', 'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could', 'must',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
  'this', 'that', 'these', 'those', 'myself', 'yourself', 'himself', 'herself', 'itself',
  'and', 'but', 'or', 'nor', 'so', 'yet', 'if', 'than', 'too', 'very', 'just', 'also',
  'not', 'no', 'yes', 'ok', 'okay', 'oh', 'well', 'like', 'got', 'get', 'gets',
  'in', 'on', 'at', 'to', 'of', 'for', 'with', 'by', 'from', 'up', 'down',
  'out', 'off', 'over', 'under', 'into', 'about', 'after', 'before', 'through',
  'here', 'there', 'when', 'where', 'how', 'what', 'which', 'who', 'whom', 'whose',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any', 'no',
  'other', 'another', 'such', 'same', 'own', 'only', 'even', 'still', 'also',
  'now', 'then', 'again', 'once', 'back', 'much', 'many', 'lot', 'really',
]);

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
