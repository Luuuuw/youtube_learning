// 闪卡数据层：3 个文件 + 内存缓存 + 防抖 atomic write，模式参考 vocab-db.ts
//
//   data/flashcards.json       ← 卡片库（含 owner='__shared__' 共享卡 + 用户自建/AI 审核过的卡）
//   data/flashcard-state.json  ← FSRS 复习状态 per (cardId, owner)
//   data/flashcard-logs.json   ← 复习评分日志
//
// 词汇维度融合策略（方案 C）：
//   - 用户标生词 → 在这里 addCard({dimension:'vocab', source:'user', owner:用户名})
//   - 同 (owner, videoId, word) 已存在则返回 existing，不会重复
//   - 查询词汇卡：返回 owner=用户 的卡 + owner='__shared__' 的卡
//     去重规则：同 (videoId, word.toLowerCase()) 优先 user 自己的
//
// 注意：vocab-db.ts 的双写联动在 vocab-db.ts 内调用 flashcard-db.addCard / deleteCardByWord。

import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { DATA_DIR } from '@/lib/data-dir';
import {
  FlashcardState,
  FlashcardRating,
  initialState,
  scheduleNext,
  isDue,
  normalizeState,
} from '@/lib/flashcard-fsrs';

const FLASHCARDS_FILE = path.join(DATA_DIR, 'flashcards.json');
const STATE_FILE = path.join(DATA_DIR, 'flashcard-state.json');
const LOGS_FILE = path.join(DATA_DIR, 'flashcard-logs.json');

export const SHARED_OWNER = '__shared__';

export type Dimension = 'vocab' | 'listening' | 'sentence';
export type CardType = 'recognition' | 'audio_fill' | 'cloze';
export type CardSource = 'ai' | 'manual' | 'user';

export interface Flashcard {
  id: string;
  videoId: string;
  dimension: Dimension;
  type: CardType;

  front: string;
  back: string;
  context: string;
  audioStart?: number;
  audioEnd?: number;
  hint?: string;
  tags: string[];

  // 词汇卡专用：用来做"用户卡 vs shared 卡"去重
  word?: string;        // 小写形式存

  owner: string;        // username 或 SHARED_OWNER
  source: CardSource;
  reviewedByAdmin: boolean;
  createdAt: string;
}

export interface FlashcardLog {
  id: string;
  cardId: string;
  owner: string;
  rating: FlashcardRating;
  reviewedAt: string;
  durationMs: number;
}

function ensureDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const p of [FLASHCARDS_FILE, STATE_FILE, LOGS_FILE]) {
      if (!fs.existsSync(p)) fs.writeFileSync(p, '[]', 'utf-8');
    }
  } catch (err) {
    console.warn('[flashcard-db] ensureDb skipped:', (err as Error).message);
  }
}

function readJson<T>(file: string): T[] {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return [];
  }
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stateKey(cardId: string, owner: string): string {
  return `${cardId}::${owner}`;
}

class FlashcardCache {
  private cards: Flashcard[] = [];
  private states: FlashcardState[] = [];
  private logs: FlashcardLog[] = [];
  private cardIndex = new Map<string, number>();
  private stateIndex = new Map<string, number>();  // key = stateKey(cardId, owner)
  private cardsDirty = false;
  private statesDirty = false;
  private logsDirty = false;
  private cardsTimer: ReturnType<typeof setTimeout> | null = null;
  private statesTimer: ReturnType<typeof setTimeout> | null = null;
  private logsTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly WRITE_DELAY = 1000;

  constructor() {
    this.load();
  }

  private load() {
    this.cards = readJson<Flashcard>(FLASHCARDS_FILE);
    this.states = readJson<Record<string, unknown>>(STATE_FILE).map(normalizeState);
    this.logs = readJson<FlashcardLog>(LOGS_FILE);
    this.rebuildIndexes();
  }

  private rebuildIndexes() {
    this.cardIndex.clear();
    for (let i = 0; i < this.cards.length; i++) {
      this.cardIndex.set(this.cards[i].id, i);
    }
    this.stateIndex.clear();
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i];
      this.stateIndex.set(stateKey(s.cardId, s.owner), i);
    }
  }

  private scheduleCardsWrite() {
    this.cardsDirty = true;
    if (this.cardsTimer) clearTimeout(this.cardsTimer);
    this.cardsTimer = setTimeout(() => {
      if (this.cardsDirty) { atomicWriteJsonSync(FLASHCARDS_FILE, this.cards); this.cardsDirty = false; }
      this.cardsTimer = null;
    }, this.WRITE_DELAY);
  }

  private scheduleStatesWrite() {
    this.statesDirty = true;
    if (this.statesTimer) clearTimeout(this.statesTimer);
    this.statesTimer = setTimeout(() => {
      if (this.statesDirty) { atomicWriteJsonSync(STATE_FILE, this.states); this.statesDirty = false; }
      this.statesTimer = null;
    }, this.WRITE_DELAY);
  }

  private scheduleLogsWrite() {
    this.logsDirty = true;
    if (this.logsTimer) clearTimeout(this.logsTimer);
    this.logsTimer = setTimeout(() => {
      if (this.logsDirty) { atomicWriteJsonSync(LOGS_FILE, this.logs); this.logsDirty = false; }
      this.logsTimer = null;
    }, this.WRITE_DELAY);
  }

  flush() {
    [this.cardsTimer, this.statesTimer, this.logsTimer].forEach(t => t && clearTimeout(t));
    this.cardsTimer = this.statesTimer = this.logsTimer = null;
    if (this.cardsDirty) { atomicWriteJsonSync(FLASHCARDS_FILE, this.cards); this.cardsDirty = false; }
    if (this.statesDirty) { atomicWriteJsonSync(STATE_FILE, this.states); this.statesDirty = false; }
    if (this.logsDirty) { atomicWriteJsonSync(LOGS_FILE, this.logs); this.logsDirty = false; }
  }

  // ---------- 卡片 CRUD ----------

  addCard(data: Omit<Flashcard, 'id' | 'createdAt'>): Flashcard {
    // 词汇维度 + user 自建：同 (owner, videoId, word) 已存在则返回 existing
    if (data.dimension === 'vocab' && data.source === 'user' && data.word) {
      const lower = data.word.toLowerCase();
      const existing = this.cards.find(c =>
        c.dimension === 'vocab' &&
        c.owner === data.owner &&
        c.videoId === data.videoId &&
        c.word?.toLowerCase() === lower,
      );
      if (existing) return existing;
    }

    const card: Flashcard = {
      ...data,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    this.cards.unshift(card);
    this.rebuildIndexes();
    this.scheduleCardsWrite();
    return card;
  }

  // 批量加（AI 生成 / admin 审核通过批量导入用）
  addCards(items: Array<Omit<Flashcard, 'id' | 'createdAt'>>): Flashcard[] {
    const out: Flashcard[] = [];
    for (const data of items) out.push(this.addCard(data));
    return out;
  }

  getCard(id: string): Flashcard | null {
    const idx = this.cardIndex.get(id);
    return idx === undefined ? null : this.cards[idx];
  }

  deleteCard(id: string, owner?: string): boolean {
    const idx = this.cardIndex.get(id);
    if (idx === undefined) return false;
    if (owner && this.cards[idx].owner !== owner) return false;
    this.cards.splice(idx, 1);
    this.rebuildIndexes();
    // 同时清掉相关的复习状态和日志
    this.states = this.states.filter(s => s.cardId !== id);
    this.logs = this.logs.filter(l => l.cardId !== id);
    this.scheduleCardsWrite();
    this.scheduleStatesWrite();
    this.scheduleLogsWrite();
    return true;
  }

  // 词汇维度联动：用户删生词时调用，按 (owner, videoId, word) 删卡
  deleteCardByWord(owner: string, videoId: string, word: string): boolean {
    const lower = word.toLowerCase();
    const card = this.cards.find(c =>
      c.dimension === 'vocab' &&
      c.owner === owner &&
      c.videoId === videoId &&
      c.word?.toLowerCase() === lower,
    );
    if (!card) return false;
    return this.deleteCard(card.id, owner);
  }

  // ---------- 查询 ----------

  // 用户视角的卡片列表：自己的 + shared
  // 词汇维度去重：同 (videoId, word) 优先 user 自己的
  listForUser(owner: string, opts: { videoId?: string; dimension?: Dimension } = {}): Flashcard[] {
    let list = this.cards.filter(c => c.owner === owner || c.owner === SHARED_OWNER);
    if (opts.videoId) list = list.filter(c => c.videoId === opts.videoId);
    if (opts.dimension) list = list.filter(c => c.dimension === opts.dimension);

    // 词汇去重
    const userVocabKeys = new Set<string>();
    for (const c of list) {
      if (c.dimension === 'vocab' && c.owner === owner && c.word) {
        userVocabKeys.add(`${c.videoId}::${c.word.toLowerCase()}`);
      }
    }
    return list.filter(c => {
      if (c.dimension !== 'vocab' || c.owner !== SHARED_OWNER || !c.word) return true;
      return !userVocabKeys.has(`${c.videoId}::${c.word.toLowerCase()}`);
    });
  }

  // ---------- 复习状态 ----------

  getState(cardId: string, owner: string): FlashcardState | null {
    const idx = this.stateIndex.get(stateKey(cardId, owner));
    return idx === undefined ? null : this.states[idx];
  }

  // 复习一次：根据 prev state + rating 算下次 → 写状态 + 加日志
  reviewCard(cardId: string, owner: string, rating: FlashcardRating, durationMs: number): FlashcardState | null {
    const card = this.getCard(cardId);
    if (!card) return null;
    // 鉴权：用户只能复习自己的卡 或 shared 卡
    if (card.owner !== owner && card.owner !== SHARED_OWNER) return null;

    const prev = this.getState(cardId, owner);
    const { next } = scheduleNext(prev, cardId, owner, rating);

    const idx = this.stateIndex.get(stateKey(cardId, owner));
    if (idx === undefined) {
      this.states.push(next);
      this.stateIndex.set(stateKey(cardId, owner), this.states.length - 1);
    } else {
      this.states[idx] = next;
    }

    this.logs.push({
      id: generateId(),
      cardId,
      owner,
      rating,
      reviewedAt: new Date().toISOString(),
      durationMs,
    });

    this.scheduleStatesWrite();
    this.scheduleLogsWrite();
    return next;
  }

  // 给某用户拿一张卡的当前状态（没有则用 initialState 占位，但**不**落盘）
  getStateOrInitial(cardId: string, owner: string): FlashcardState {
    return this.getState(cardId, owner) ?? initialState(cardId, owner);
  }

  // ---------- 统计 ----------

  // 用户到期卡（混合所有视频/维度）
  getDueForUser(owner: string, opts: { videoId?: string; dimension?: Dimension } = {}): { card: Flashcard; state: FlashcardState | null }[] {
    const now = new Date();
    const cards = this.listForUser(owner, opts);
    const out: { card: Flashcard; state: FlashcardState | null }[] = [];
    for (const c of cards) {
      const s = this.getState(c.id, owner);
      if (!s) {
        // 新卡：用户自己的 + 共享 AI 卡都进入队列，日上限控制数量
        if (c.owner === owner || c.owner === SHARED_OWNER) out.push({ card: c, state: s });
      } else if (isDue(s, now)) {
        out.push({ card: c, state: s });
      }
    }
    return out;
  }

  // 看板用：每个用户的简单复习计数
  countReviewsForOwner(owner: string, sinceDays = 30): number {
    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    return this.logs.filter(l => l.owner === owner && new Date(l.reviewedAt).getTime() >= cutoff).length;
  }

  // 用户的复习统计（今日到期 / 新卡 / 已掌握 / 总卡 / 各维度计数）
  getUserStats(owner: string) {
    const cards = this.listForUser(owner);
    const now = new Date();
    const dimensions: Record<Dimension, number> = { vocab: 0, listening: 0, sentence: 0 };
    let due = 0;
    let newCount = 0;
    let mastered = 0;
    for (const c of cards) {
      dimensions[c.dimension]++;
      const s = this.getState(c.id, owner);
      if (!s) {
        // 新卡：用户自己的 + 共享 AI 卡都算入
        if (c.owner === owner || c.owner === SHARED_OWNER) { newCount++; due++; }
      } else {
        if (isDue(s, now)) due++;
        // 简单"已掌握"标准：稳定度 > 30 天
        if (s.stability > 30) mastered++;
      }
    }
    return {
      total: cards.length,
      due,
      new: newCount,
      mastered,
      dimensions,
      reviewsLast7d: this.countReviewsForOwner(owner, 7),
      reviewsLast30d: this.countReviewsForOwner(owner, 30),
    };
  }
}

// 全局单例（避免每个请求重新读盘）
const globalForFlashcardDb = globalThis as unknown as { __flashcardCache?: FlashcardCache };
export const flashcardDb: FlashcardCache = globalForFlashcardDb.__flashcardCache ?? new FlashcardCache();
if (!globalForFlashcardDb.__flashcardCache) globalForFlashcardDb.__flashcardCache = flashcardDb;
