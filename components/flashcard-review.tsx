'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Keyboard, Loader2, X, Volume2, ArrowLeft, Trash2,
} from 'lucide-react';
import FlashcardAudio, { FlashcardAudioHandle } from './flashcard-audio';
import { useAuth } from '@/lib/auth-context';

type Dimension = 'vocab' | 'listening' | 'sentence';
type CardType = 'recognition' | 'audio_fill' | 'cloze';
type Rating = 1 | 2 | 3 | 4;

interface CardWithState {
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
  owner?: string;
  source?: string;
  state: {
    nextReview?: string;
    due?: string;
    state: number | string;
    reps: number;
    stability?: number;
    difficulty?: number;
  } | null;
}

interface Props {
  cards: CardWithState[];
  onComplete?: () => void;
}

const DIMENSION_META: Record<Dimension, { label: string; chip: string }> = {
  vocab: {
    label: '🔤 词汇',
    chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
  },
  listening: {
    label: '🎧 听力',
    chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
  },
  sentence: {
    label: '🧱 句型',
    chip: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
  },
};

const RATING_META: { rating: Rating; emoji: string; label: string; cls: string }[] = [
  {
    rating: 1,
    emoji: '🔴',
    label: '不会',
    cls: 'bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20 border-red-500/30',
  },
  {
    rating: 2,
    emoji: '🟡',
    label: '模糊',
    cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border-amber-500/30',
  },
  {
    rating: 3,
    emoji: '🟢',
    label: '会',
    cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/30',
  },
  {
    rating: 4,
    emoji: '🔵',
    label: '太简单',
    cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 border-blue-500/30',
  },
];

// 简易 markdown bold parser: `**xxx**` -> <strong>xxx</strong>
function renderBold(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    if (m) {
      return <strong key={i} className="text-foreground font-semibold">{m[1]}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function FlashcardReview({ cards, onComplete }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shownAt, setShownAt] = useState<number>(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [finishedCount, setFinishedCount] = useState(0);

  const audioRef = useRef<FlashcardAudioHandle>(null);
  const completedRef = useRef(false);
  const { role } = useAuth();

  const total = cards.length;
  const card = currentIndex < total ? cards[currentIndex] : null;
  const isDone = total > 0 && currentIndex >= total;

  const canDelete = card && (
    (card.source === 'manual' || card.owner !== '__shared__') || role === 'admin'
  );

  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => { setDeleteConfirm(false); }, [currentIndex]);

  const handleDelete = useCallback(async () => {
    if (!card || !canDelete) return;
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    setDeleting(true);
    setDeleteConfirm(false);
    try {
      const token = localStorage.getItem('ve-session-token');
      const res = await fetch(`/api/flashcards?id=${card.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      cards.splice(currentIndex, 1);
      if (currentIndex >= cards.length) {
        setCurrentIndex(cards.length);
      } else {
        setFlipped(false);
        setShownAt(Date.now());
      }
    } catch (e) {
      setError((e as Error).message);
    }
    setDeleting(false);
  }, [card, canDelete, deleteConfirm, currentIndex, cards]);

  // 触发 onComplete（只一次）
  useEffect(() => {
    if (isDone && !completedRef.current) {
      completedRef.current = true;
      onComplete?.();
    }
  }, [isDone, onComplete]);

  // 翻面
  const flip = useCallback(() => {
    if (!card) return;
    setFlipped(true);
  }, [card]);

  // 提交评分
  const submitRating = useCallback(async (rating: Rating) => {
    if (!card || submitting) return;
    setSubmitting(true);
    setError(null);
    const durationMs = Date.now() - shownAt;
    try {
      const r = await fetch('/api/flashcards/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ cardId: card.id, rating, durationMs }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      // 推进
      setFinishedCount(n => n + 1);
      setCurrentIndex(i => i + 1);
      setFlipped(false);
      setShownAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }, [card, submitting, shownAt]);

  // 重放音频
  const replayAudio = useCallback(() => {
    audioRef.current?.replay();
  }, []);

  // 键盘
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 忽略输入框内的按键
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(s => !s);
        return;
      }
      if (showHelp && e.key === 'Escape') {
        e.preventDefault();
        setShowHelp(false);
        return;
      }
      if (!card) return;

      if (e.key === ' ' || e.code === 'Space') {
        if (!flipped) {
          e.preventDefault();
          flip();
        }
        return;
      }
      if (flipped && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        e.preventDefault();
        submitRating(Number(e.key) as Rating);
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && (card.dimension === 'listening' || (card.dimension === 'vocab' && card.audioStart !== undefined))) {
        e.preventDefault();
        replayAudio();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [card, flipped, flip, submitRating, replayAudio, showHelp]);

  // 切换卡片时重置 shownAt
  useEffect(() => {
    setShownAt(Date.now());
  }, [currentIndex]);

  // 空 cards
  if (total === 0) {
    return (
      <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-12 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-semibold mb-2">今日无到期闪卡</h2>
        <p className="text-sm text-muted-foreground mb-6">明天再来吧～继续看视频积累更多卡片</p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 rounded-md transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          回首页
        </Link>
      </div>
    );
  }

  // 完成
  if (isDone) {
    return (
      <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-12 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-semibold mb-2">今日复习完成 {finishedCount} 张</h2>
        <p className="text-sm text-muted-foreground mb-6">FSRS 调度器已更新明天的到期卡片</p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 rounded-md transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          回首页
        </Link>
      </div>
    );
  }

  if (!card) return null;

  const dimMeta = DIMENSION_META[card.dimension];
  const pct = total === 0 ? 0 : (currentIndex / total) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* 顶部进度 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-muted-foreground">{currentIndex} / {total}</span>
          <button
            type="button"
            onClick={() => setShowHelp(s => !s)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="键盘帮助 (?)"
          >
            <Keyboard className="h-3.5 w-3.5" />
            键盘 (?)
          </button>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* 卡片 */}
      <div className="bg-card border border-border rounded-xl p-6">
        {/* 维度 chip */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-medium ${dimMeta.chip}`}>
            {dimMeta.label}
          </span>
          {canDelete && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs transition-colors ${
                deleteConfirm
                  ? 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/40'
                  : 'text-muted-foreground/50 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10'
              }`}
              title={deleteConfirm ? '确认删除' : '删除此卡'}
            >
              <Trash2 className="h-3 w-3" />
              {deleting ? '...' : deleteConfirm ? '确认?' : ''}
            </button>
          )}
          {card.state && (
            <span className="text-xs text-muted-foreground">
              已复习 {card.state.reps} 次
            </span>
          )}
          {card.tags && card.tags.length > 0 && (
            <span className="text-xs text-muted-foreground truncate">
              · {card.tags.slice(0, 3).join(' · ')}
            </span>
          )}
        </div>

        {/* 正面：题干 */}
        <div className="transition-opacity duration-200">
          <div className="text-xl md:text-2xl font-medium leading-relaxed mb-4 min-h-[3rem]">
            {card.front.includes('\n') ? (
              <>
                <span className="block text-sm text-muted-foreground mb-1.5">
                  {card.front.split('\n')[0]}
                </span>
                <span>{card.front.split('\n').slice(1).join('\n')}</span>
              </>
            ) : (
              card.front
            )}
          </div>

          {card.dimension === 'listening'
            && card.audioStart !== undefined
            && card.audioEnd !== undefined && (
            <div className="mb-4">
              <FlashcardAudio
                ref={audioRef}
                videoId={card.videoId}
                startTime={card.audioStart}
                endTime={card.audioEnd}
                autoPlay={true}
              />
            </div>
          )}

          {card.dimension === 'vocab'
            && card.audioStart !== undefined
            && flipped && (
            <div className="mb-4">
              <FlashcardAudio
                ref={audioRef}
                videoId={card.videoId}
                startTime={card.audioStart}
                endTime={card.audioEnd ?? card.audioStart + 4}
                autoPlay={true}
              />
            </div>
          )}

          {card.context && card.dimension === 'vocab' && (
            <div className="text-xs text-muted-foreground leading-relaxed mb-2">
              {renderBold(card.context)}
            </div>
          )}

          {flipped && card.hint && !card.back.includes(card.hint) && (
            <div className="text-xs text-muted-foreground mb-2">
              <span className="opacity-70">提示：</span>{card.hint}
            </div>
          )}
        </div>

        {/* 背面：答案 */}
        {flipped && (
          <div className="mt-4 pt-4 border-t border-border transition-opacity duration-200">
            <div className="text-lg md:text-xl font-semibold text-foreground leading-relaxed whitespace-pre-wrap">
              {card.back}
            </div>
          </div>
        )}

        {/* 操作区 */}
        <div className="mt-6">
          {!flipped ? (
            <div className="flex items-center justify-center gap-3">
              {(card.dimension === 'listening' || (card.dimension === 'vocab' && card.audioStart !== undefined)) && (
                <button
                  type="button"
                  onClick={replayAudio}
                  title="重放音频 (A)"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 rounded-md transition-colors"
                >
                  <Volume2 className="h-4 w-4" />
                  重放 (A)
                </button>
              )}
              <button
                type="button"
                onClick={() => submitRating(4)}
                disabled={submitting}
                className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
                title="已学会，不再出现"
              >
                已学会
              </button>
              <button
                type="button"
                onClick={flip}
                className="px-6 py-2.5 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
              >
                显示答案 (Space)
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {RATING_META.map(r => (
                <button
                  key={r.rating}
                  type="button"
                  disabled={submitting}
                  onClick={() => submitRating(r.rating)}
                  className={`flex flex-col items-center justify-center gap-1 py-3 rounded-md border text-sm font-medium transition-colors ${r.cls} ${submitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <span className="text-lg">
                    {r.rating} {r.emoji}
                  </span>
                  <span className="text-xs opacity-90">{r.label}</span>
                </button>
              ))}
            </div>
          )}

          {submitting && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              提交中...
            </div>
          )}

          {error && (
            <div className="mt-3 bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-xs rounded-md px-3 py-2 flex items-start gap-2">
              <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="flex-1">
                <div>提交失败：{error}</div>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="underline opacity-80 hover:opacity-100 mt-0.5"
                >
                  关闭
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 键盘帮助弹层 */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-1.5">
                <Keyboard className="h-4 w-4" />
                键盘快捷键
              </h3>
              <button
                type="button"
                onClick={() => setShowHelp(false)}
                className="text-muted-foreground hover:text-foreground"
                title="关闭 (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">翻面</dt>
                <dd><kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">Space</kbd></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">评分 (翻面后)</dt>
                <dd className="flex gap-1">
                  <kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">1</kbd>
                  <kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">2</kbd>
                  <kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">3</kbd>
                  <kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">4</kbd>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">重放音频 (听力)</dt>
                <dd><kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">A</kbd></dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">显示 / 关闭帮助</dt>
                <dd><kbd className="px-2 py-0.5 text-xs bg-muted border border-border rounded">?</kbd></dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
