import { getLocalDictEntry, hasLocalDictEntry } from './local-dict';

export interface VocabBankEntry {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
  pos: string;
  frequency: number;
  videoIds: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  relatedWords: string[];
}

export interface LookupResult {
  word: string;
  definition: string;
  source: 'local' | 'bank' | 'cache' | 'free' | 'ai';
  bankEntry?: VocabBankEntry;
}

const FREE_API = 'https://api.dictionaryapi.dev/api/v2/entries/en';

async function lookupFreeApi(word: string): Promise<string | null> {
  try {
    const res = await fetch(`${FREE_API}/${encodeURIComponent(word)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const entry = data[0];
    const phonetic = entry.phonetic || entry.phonetics?.find((p: { text?: string }) => p.text)?.text || '';
    const meaning = entry.meanings?.[0];
    if (!meaning) return null;

    const pos = meaning.partOfSpeech || '';
    const def = meaning.definitions?.[0];
    if (!def) return null;

    let result = '';
    if (phonetic) result += `音标: ${phonetic}\n`;
    result += `释义: ${pos ? pos + '. ' : ''}${def.definition}`;
    if (def.example) result += `\n\n例句: ${def.example}`;

    return result;
  } catch {
    return null;
  }
}

const memoryCache = new Map<string, LookupResult>();
const CACHE_MAX_SIZE = 5000;

function getCache(word: string): LookupResult | undefined {
  return memoryCache.get(word.toLowerCase().trim());
}

function setCache(word: string, result: LookupResult): void {
  const key = word.toLowerCase().trim();
  if (memoryCache.size >= CACHE_MAX_SIZE) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, result);
}

function cleanWord(word: string): string {
  return word
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/^\W+|\W+$/g, '')
    .replace(/[^a-zA-Z'-]/g, '');
}

async function lookupVocabBank(word: string): Promise<VocabBankEntry | null> {
  try {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    const res = await fetch(`/api/vocab/lookup?word=${encodeURIComponent(word)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.found && data.word) {
      return data as VocabBankEntry;
    }
    return null;
  } catch {
    return null;
  }
}

export async function lookupWord(word: string, context?: string): Promise<LookupResult> {
  const cleaned = cleanWord(word);

  if (!cleaned) {
    throw new Error('无效的单词');
  }

  if (hasLocalDictEntry(cleaned)) {
    const entry = getLocalDictEntry(cleaned)!;
    const result: LookupResult = {
      word: entry.word,
      definition: `${entry.phonetic}\n${entry.definition}\n\n例句: ${entry.example}`,
      source: 'local',
    };
    return result;
  }

  const cached = getCache(cleaned);
  if (cached) {
    return cached;
  }

  const bankEntry = await lookupVocabBank(cleaned);
  if (bankEntry) {
    let def = '';
    if (bankEntry.phonetic) def += `音标: ${bankEntry.phonetic}\n`;
    def += `释义: ${bankEntry.definition}`;
    if (bankEntry.example) def += `\n\n例句: ${bankEntry.example}`;

    const result: LookupResult = {
      word: bankEntry.word,
      definition: def,
      source: 'bank',
      bankEntry,
    };
    setCache(cleaned, result);
    return result;
  }

  const freeDef = await lookupFreeApi(cleaned);
  if (freeDef) {
    const result: LookupResult = {
      word: cleaned,
      definition: freeDef,
      source: 'free',
    };
    setCache(cleaned, result);
    return result;
  }

  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  const res = await fetch('/api/lookup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ word: cleaned, promptType: 'dictionary', context: context || '' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `查询失败: ${res.status}`);
  }

  const data = await res.json();
  const result: LookupResult = {
    word: data.word || cleaned,
    definition: data.definition || '暂无结果',
    source: 'ai',
  };

  setCache(cleaned, result);
  return result;
}
