import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';

const DB_DIR = path.join(process.cwd(), 'data');
const VOCAB_FILE = path.join(DB_DIR, 'vocab.json');
const REVIEW_LOG_FILE = path.join(DB_DIR, 'review-log.json');

export interface VocabWord {
  id: string;
  word: string;
  phonetic?: string;
  definition: string;
  example?: string;
  context: string;
  videoId: string;
  videoTitle: string;
  timestamp: number;
  category?: string;
  owner: string;
  proficiency: number;
  reviewCount: number;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewLog {
  id: string;
  wordId: string;
  word: string;
  result: 'remember' | 'forget';
  reviewedAt: string;
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(VOCAB_FILE)) {
    fs.writeFileSync(VOCAB_FILE, '[]', 'utf-8');
  }
  if (!fs.existsSync(REVIEW_LOG_FILE)) {
    fs.writeFileSync(REVIEW_LOG_FILE, '[]', 'utf-8');
  }
}

function readVocabFile(): VocabWord[] {
  ensureDb();
  try {
    const raw = fs.readFileSync(VOCAB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeVocabFile(words: VocabWord[]) {
  ensureDb();
  atomicWriteJsonSync(VOCAB_FILE, words);
}

function readReviewLogFile(): ReviewLog[] {
  ensureDb();
  try {
    const raw = fs.readFileSync(REVIEW_LOG_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeReviewLogFile(logs: ReviewLog[]) {
  ensureDb();
  atomicWriteJsonSync(REVIEW_LOG_FILE, logs);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function calcNextReview(proficiency: number): string {
  const now = new Date();
  const intervals = [1, 1, 3, 7, 15, 30];
  const days = intervals[Math.min(proficiency, 5)] || 1;
  now.setDate(now.getDate() + days);
  return now.toISOString();
}

class VocabCache {
  private words: VocabWord[] = [];
  private reviewLogs: ReviewLog[] = [];
  private wordsIndex: Map<string, number> = new Map();
  private wordNameIndex: Map<string, number> = new Map();
  private vocabDirty = false;
  private reviewLogDirty = false;
  private vocabWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private reviewLogWriteTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WRITE_DELAY = 1000;

  constructor() {
    this.load();
  }

  private load() {
    this.words = readVocabFile();
    this.reviewLogs = readReviewLogFile();
    this.rebuildIndexes();
  }

  private rebuildIndexes() {
    this.wordsIndex.clear();
    this.wordNameIndex.clear();
    for (let i = 0; i < this.words.length; i++) {
      this.wordsIndex.set(this.words[i].id, i);
      this.wordNameIndex.set(this.words[i].word.toLowerCase(), i);
    }
  }

  private updateIndexAfterInsert(insertedWord: VocabWord, insertedAt: number) {
    for (let i = this.words.length - 1; i > insertedAt; i--) {
      const w = this.words[i];
      this.wordsIndex.set(w.id, i);
      this.wordNameIndex.set(w.word.toLowerCase(), i);
    }
    this.wordsIndex.set(insertedWord.id, insertedAt);
    this.wordNameIndex.set(insertedWord.word.toLowerCase(), insertedAt);
  }

  private scheduleVocabWrite() {
    if (this.vocabWriteTimer) {
      clearTimeout(this.vocabWriteTimer);
    }
    this.vocabDirty = true;
    this.vocabWriteTimer = setTimeout(() => {
      this.flushVocab();
    }, this.WRITE_DELAY);
  }

  private scheduleReviewLogWrite() {
    if (this.reviewLogWriteTimer) {
      clearTimeout(this.reviewLogWriteTimer);
    }
    this.reviewLogDirty = true;
    this.reviewLogWriteTimer = setTimeout(() => {
      this.flushReviewLog();
    }, this.WRITE_DELAY);
  }

  private flushVocab() {
    if (this.vocabDirty) {
      writeVocabFile(this.words);
      this.vocabDirty = false;
    }
    this.vocabWriteTimer = null;
  }

  private flushReviewLog() {
    if (this.reviewLogDirty) {
      writeReviewLogFile(this.reviewLogs);
      this.reviewLogDirty = false;
    }
    this.reviewLogWriteTimer = null;
  }

  flush() {
    if (this.vocabWriteTimer) {
      clearTimeout(this.vocabWriteTimer);
      this.vocabWriteTimer = null;
    }
    if (this.reviewLogWriteTimer) {
      clearTimeout(this.reviewLogWriteTimer);
      this.reviewLogWriteTimer = null;
    }
    this.flushVocab();
    this.flushReviewLog();
  }

  getAllWords(owner?: string): VocabWord[] {
    if (owner) return this.words.filter(w => w.owner === owner);
    return [...this.words];
  }

  getWordById(id: string, owner?: string): VocabWord | null {
    const index = this.wordsIndex.get(id);
    if (index === undefined) return null;
    const word = this.words[index];
    if (owner && word.owner !== owner) return null;
    return word;
  }

  getWordByName(name: string, owner?: string): VocabWord | null {
    const index = this.wordNameIndex.get(name.toLowerCase());
    if (index === undefined) return null;
    const word = this.words[index];
    if (owner && word.owner !== owner) return null;
    return word;
  }

  addWord(data: Omit<VocabWord, 'id' | 'proficiency' | 'reviewCount' | 'nextReviewAt' | 'createdAt' | 'updatedAt'>): VocabWord {
    if (data.owner) {
      const existing = this.words.find(w => w.word.toLowerCase() === data.word.toLowerCase() && w.owner === data.owner);
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const word: VocabWord = {
      ...data,
      id: generateId(),
      proficiency: 0,
      reviewCount: 0,
      nextReviewAt: calcNextReview(0),
      createdAt: now,
      updatedAt: now,
    };

    this.words.unshift(word);
    this.updateIndexAfterInsert(word, 0);
    this.scheduleVocabWrite();
    return word;
  }

  updateWord(id: string, updates: Partial<VocabWord>, owner?: string): VocabWord | null {
    const index = this.wordsIndex.get(id);
    if (index === undefined) return null;
    if (owner && this.words[index].owner !== owner) return null;

    const oldWord = this.words[index];
    const updatedWord: VocabWord = {
      ...oldWord,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.words[index] = updatedWord;

    if (updates.word && updates.word.toLowerCase() !== oldWord.word.toLowerCase()) {
      this.wordNameIndex.delete(oldWord.word.toLowerCase());
      this.wordNameIndex.set(updatedWord.word.toLowerCase(), index);
    }

    this.scheduleVocabWrite();
    return updatedWord;
  }

  deleteWord(id: string, owner?: string): boolean {
    const index = this.wordsIndex.get(id);
    if (index === undefined) return false;
    if (owner && this.words[index].owner !== owner) return false;

    const word = this.words[index];
    this.words.splice(index, 1);
    this.wordsIndex.delete(id);
    this.wordNameIndex.delete(word.word.toLowerCase());
    this.rebuildIndexes();

    this.scheduleVocabWrite();
    return true;
  }

  getDueWords(owner?: string): VocabWord[] {
    const now = new Date().toISOString();
    return this.words
      .filter(w => (owner ? w.owner === owner : true) && w.nextReviewAt && w.nextReviewAt <= now)
      .sort((a, b) => (a.nextReviewAt || '').localeCompare(b.nextReviewAt || ''));
  }

  getTodayStats(owner?: string): { due: number; new: number; mastered: number; total: number } {
    const now = new Date().toISOString();
    const list = owner ? this.words.filter(w => w.owner === owner) : this.words;
    return {
      due: list.filter(w => w.nextReviewAt && w.nextReviewAt <= now).length,
      new: list.filter(w => w.reviewCount === 0).length,
      mastered: list.filter(w => w.proficiency >= 5).length,
      total: list.length,
    };
  }

  reviewWord(id: string, result: 'remember' | 'forget', owner?: string): VocabWord | null {
    const index = this.wordsIndex.get(id);
    if (index === undefined) return null;
    if (owner && this.words[index].owner !== owner) return null;

    const word = this.words[index];
    let newProficiency = word.proficiency;

    if (result === 'remember') {
      newProficiency = Math.min(word.proficiency + 1, 5);
    } else {
      newProficiency = Math.max(word.proficiency - 2, 0);
    }

    word.proficiency = newProficiency;
    word.reviewCount += 1;
    word.nextReviewAt = calcNextReview(newProficiency);
    word.updatedAt = new Date().toISOString();

    this.reviewLogs.push({
      id: generateId(),
      wordId: id,
      word: word.word,
      result,
      reviewedAt: new Date().toISOString(),
    });

    this.scheduleVocabWrite();
    this.scheduleReviewLogWrite();
    return word;
  }

  getReviewHistory(wordId: string): ReviewLog[] {
    return this.reviewLogs
      .filter(l => l.wordId === wordId)
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());
  }

  getAllReviewLogs(): ReviewLog[] {
    return this.reviewLogs
      .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime());
  }

  getWeeklyStats(): { date: string; remembered: number; forgotten: number }[] {
    const stats: Record<string, { remembered: number; forgotten: number }> = {};

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      stats[key] = { remembered: 0, forgotten: 0 };
    }

    this.reviewLogs.forEach(l => {
      const key = l.reviewedAt.slice(0, 10);
      if (stats[key]) {
        const field = l.result === 'remember' ? 'remembered' : 'forgotten';
        stats[key][field] += 1;
      }
    });

    return Object.entries(stats).map(([date, s]) => ({ date, ...s }));
  }

  getLearningCurve(days: number = 30): { date: string; total: number; newWords: number; reviewed: number }[] {
    const result: { date: string; total: number; newWords: number; reviewed: number }[] = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const newWords = this.words.filter(w => {
        const t = new Date(w.createdAt);
        return t >= dayStart && t < dayEnd;
      }).length;

      const reviewed = this.reviewLogs.filter(l => {
        const t = new Date(l.reviewedAt);
        return t >= dayStart && t < dayEnd;
      }).length;

      const total = this.words.filter(w => new Date(w.createdAt) <= dayEnd).length;

      result.push({
        date: dayStart.toISOString().slice(5),
        total,
        newWords,
        reviewed,
      });
    }

    return result;
  }

  reload() {
    this.load();
  }
}

const cache = new VocabCache();

process.on('exit', () => {
  cache.flush();
});

export function getAllWords(owner?: string): VocabWord[] {
  return cache.getAllWords(owner);
}

export function getWordById(id: string, owner?: string): VocabWord | null {
  return cache.getWordById(id, owner);
}

export function getWordByName(name: string, owner?: string): VocabWord | null {
  return cache.getWordByName(name, owner);
}

export function addWord(data: Omit<VocabWord, 'id' | 'proficiency' | 'reviewCount' | 'nextReviewAt' | 'createdAt' | 'updatedAt'>): VocabWord {
  return cache.addWord(data);
}

export function updateWord(id: string, updates: Partial<VocabWord>, owner?: string): VocabWord | null {
  return cache.updateWord(id, updates, owner);
}

export function deleteWord(id: string, owner?: string): boolean {
  return cache.deleteWord(id, owner);
}

export function getDueWords(owner?: string): VocabWord[] {
  return cache.getDueWords(owner);
}

export function getTodayStats(owner?: string): { due: number; new: number; mastered: number; total: number } {
  return cache.getTodayStats(owner);
}

export function reviewWord(id: string, result: 'remember' | 'forget', owner?: string): VocabWord | null {
  return cache.reviewWord(id, result, owner);
}

export function getReviewHistory(wordId: string): ReviewLog[] {
  return cache.getReviewHistory(wordId);
}

export function getAllReviewLogs(): ReviewLog[] {
  return cache.getAllReviewLogs();
}

export function getWeeklyStats(): { date: string; remembered: number; forgotten: number }[] {
  return cache.getWeeklyStats();
}

export function getLearningCurve(days?: number): { date: string; total: number; newWords: number; reviewed: number }[] {
  return cache.getLearningCurve(days);
}
