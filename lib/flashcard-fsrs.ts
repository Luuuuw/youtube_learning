// FSRS (Free Spaced Repetition Scheduler) — simplified v4 implementation
// Ratings: 1=Again, 2=Hard, 3=Good, 4=Easy

export type FlashcardRating = 1 | 2 | 3 | 4;

export interface FlashcardState {
  cardId: string;
  owner: string;
  stability: number;       // days — memory stability
  difficulty: number;      // 0-1 — intrinsic difficulty
  elapsedDays: number;     // days since last review
  scheduledDays: number;   // days until next review
  reps: number;            // total review count
  lapses: number;          // times the card was forgotten (rating=1)
  lastReview: string;      // ISO date
  nextReview: string;      // ISO date
  state: 'new' | 'learning' | 'review' | 'relearning';
}

const DEFAULT_STABILITY = 0.5;
const DEFAULT_DIFFICULTY = 0.3;
const MIN_STABILITY = 0.1;
const MAX_STABILITY = 36500; // 100 years cap

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

function nextStability(s: number, d: number, r: FlashcardRating): number {
  if (r === 1) {
    // Again: reset stability
    return Math.max(MIN_STABILITY, s * 0.1 * Math.pow(d, 0.2));
  }
  // Hard / Good / Easy
  const factor = r === 2 ? 1.2 : r === 3 ? 2.5 : 4.5;
  const difficultyFactor = 1 + (1 - d) * 0.5;
  return clamp(s * factor * difficultyFactor, MIN_STABILITY, MAX_STABILITY);
}

function nextDifficulty(d: number, r: FlashcardRating): number {
  const delta = r === 1 ? 0.15 : r === 2 ? 0.05 : r === 3 ? -0.05 : -0.15;
  return clamp(d + delta, 0, 1);
}

function isoDate(d: Date = new Date()): string {
  return d.toISOString().split('T')[0];
}

export function initialState(cardId: string, owner: string): FlashcardState {
  return {
    cardId,
    owner,
    stability: DEFAULT_STABILITY,
    difficulty: DEFAULT_DIFFICULTY,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0,
    lastReview: isoDate(),
    nextReview: isoDate(),
    state: 'new',
  };
}

// Normalize old state format (snake_case + numeric state + different difficulty scale)
// to the current FlashcardState shape. Safe to call on already-normalized data.
const STATE_NUMERIC_MAP = ['new', 'learning', 'review', 'relearning'] as const;

export function normalizeState(raw: Record<string, unknown>): FlashcardState {
  const cardId = String(raw.cardId ?? '');
  const owner = String(raw.owner ?? '');
  const stability = Number(raw.stability ?? DEFAULT_STABILITY);
  const reps = Number(raw.reps ?? 0);
  const lapses = Number(raw.lapses ?? 0);

  // difficulty: old format may be on a 0-10 scale; normalize to 0-1
  let difficulty = Number(raw.difficulty ?? DEFAULT_DIFFICULTY);
  if (difficulty > 1) difficulty = clamp(difficulty / 10, 0, 1);

  // elapsed / scheduled days: handle both camelCase and snake_case
  const elapsedDays = Number(raw.elapsedDays ?? raw.elapsed_days ?? 0);
  const scheduledDays = Number(raw.scheduledDays ?? raw.scheduled_days ?? 0);

  // lastReview: handle both keys; truncate to date-only
  const lastReviewRaw = String(raw.lastReview ?? raw.last_review ?? isoDate());
  const lastReview = lastReviewRaw.slice(0, 10);

  // nextReview: use nextReview key, or due field, or compute from lastReview + scheduledDays
  let nextReview: string;
  if (raw.nextReview ?? raw.next_review) {
    nextReview = String(raw.nextReview ?? raw.next_review).slice(0, 10);
  } else if (raw.due) {
    nextReview = String(raw.due).slice(0, 10);
  } else {
    const d = new Date(lastReview + 'T00:00:00');
    d.setDate(d.getDate() + scheduledDays);
    nextReview = isoDate(d);
  }

  // state: numeric (0-3) or string
  let state: FlashcardState['state'];
  const rawState = raw.state;
  if (typeof rawState === 'number') {
    state = STATE_NUMERIC_MAP[rawState] ?? 'new';
  } else if (typeof rawState === 'string' && ['new', 'learning', 'review', 'relearning'].includes(rawState)) {
    state = rawState as FlashcardState['state'];
  } else {
    state = 'new';
  }

  return { cardId, owner, stability, difficulty, elapsedDays, scheduledDays, reps, lapses, lastReview, nextReview, state };
}

export function isDue(state: FlashcardState, now: Date = new Date()): boolean {
  const next = new Date(state.nextReview + 'T00:00:00');
  return now >= next;
}

export function scheduleNext(
  prev: FlashcardState | null,
  cardId: string,
  owner: string,
  rating: FlashcardRating,
): { next: FlashcardState } {
  const base = prev ?? initialState(cardId, owner);
  const now = new Date();

  // Compute elapsed days since last review
  const lastDate = new Date(base.lastReview + 'T00:00:00');
  const elapsedDays = Math.max(0, Math.round((now.getTime() - lastDate.getTime()) / 86400000));

  const newStability = nextStability(base.stability, base.difficulty, rating);
  const newDifficulty = nextDifficulty(base.difficulty, rating);
  const scheduledDays = Math.round(newStability);

  const daysToAdd = rating === 1 ? 1 : scheduledDays;
  const nextReview = new Date(now);
  nextReview.setDate(nextReview.getDate() + daysToAdd);

  const next: FlashcardState = {
    cardId,
    owner,
    stability: newStability,
    difficulty: newDifficulty,
    elapsedDays,
    scheduledDays: daysToAdd,
    reps: base.reps + 1,
    lapses: rating === 1 ? base.lapses + 1 : base.lapses,
    lastReview: isoDate(now),
    nextReview: isoDate(nextReview),
    state: rating === 1 ? 'relearning' : base.state === 'new' ? 'learning' : 'review',
  };

  return { next };
}
