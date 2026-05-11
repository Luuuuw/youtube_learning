export interface VocabItem {
  word: string;
  definition: string;
  context: string;
  videoId: string;
  videoTitle: string;
  timestamp: number;
  addedAt: string;
  proficiency?: number;
}

const STORAGE_KEY = 'vibe-english-vocab';

export function getVocabList(): VocabItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addVocab(item: Omit<VocabItem, 'addedAt'>): VocabItem {
  const list = getVocabList();
  const existing = list.find((v) => v.word.toLowerCase() === item.word.toLowerCase());
  if (existing) {
    return existing;
  }
  const newItem: VocabItem = { ...item, addedAt: new Date().toISOString() };
  list.unshift(newItem);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return newItem;
}

export function removeVocab(word: string): void {
  const list = getVocabList();
  const filtered = list.filter((v) => v.word.toLowerCase() !== word.toLowerCase());
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

export function updateVocabDefinition(word: string, definition: string): void {
  const list = getVocabList();
  const item = list.find((v) => v.word.toLowerCase() === word.toLowerCase());
  if (item) {
    item.definition = definition;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
}

export function isInVocab(word: string): boolean {
  const list = getVocabList();
  return list.some((v) => v.word.toLowerCase() === word.toLowerCase());
}
