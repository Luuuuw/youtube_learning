'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, ArrowLeft, Sparkles } from 'lucide-react';
import FlashcardReview from '@/components/flashcard-review';
import { useAuth } from '@/lib/auth-context';

type Dimension = 'vocab' | 'listening' | 'sentence';
type CardType = 'recognition' | 'audio_fill' | 'cloze';

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
  word?: string;
  state: {
    nextReview?: string;
    due?: string;
    state: number | string;
    reps: number;
    stability?: number;
    difficulty?: number;
  } | null;
}

type DimChoice = 'all' | Dimension;

interface DimMeta {
  key: Dimension;
  label: string;
  emoji: string;
  cardBg: string;
  cardBorder: string;
  accent: string;
}

const DIM_META: DimMeta[] = [
  {
    key: 'vocab',
    label: '词汇',
    emoji: '🔤',
    cardBg: 'bg-indigo-500/5 hover:bg-indigo-500/10',
    cardBorder: 'border-indigo-500/30',
    accent: 'text-indigo-600 dark:text-indigo-400',
  },
  {
    key: 'listening',
    label: '听力',
    emoji: '🎧',
    cardBg: 'bg-blue-500/5 hover:bg-blue-500/10',
    cardBorder: 'border-blue-500/30',
    accent: 'text-blue-600 dark:text-blue-400',
  },
  {
    key: 'sentence',
    label: '句型',
    emoji: '🧱',
    cardBg: 'bg-purple-500/5 hover:bg-purple-500/10',
    cardBorder: 'border-purple-500/30',
    accent: 'text-purple-600 dark:text-purple-400',
  },
];

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function isDue(state: CardWithState['state']): boolean {
  if (!state) return true; // 新卡也算到期
  const dueDate = state.nextReview || state.due;
  if (!dueDate) return true;
  return new Date(dueDate).getTime() <= Date.now();
}

interface Props {
  videoId: string;
}

export default function VideoFlashcardsClient({ videoId }: Props) {
  const [cards, setCards] = useState<CardWithState[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // 当前进入复习的维度：null = 显示统计面板；'all' = 全维度混合复习；'vocab'/'listening'/'sentence' = 单维度复习
  const [reviewing, setReviewing] = useState<DimChoice | null>(null);

  const loadCards = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ videoId });
      const r = await fetch(`/api/flashcards?${qs.toString()}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCards(data.cards || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载卡片失败');
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    loadCards();
  }, [loadCards]);

  // 3 维度统计
  const stats = useMemo(() => {
    const s: Record<Dimension, { total: number; due: number }> = {
      vocab: { total: 0, due: 0 },
      listening: { total: 0, due: 0 },
      sentence: { total: 0, due: 0 },
    };
    for (const c of cards) {
      s[c.dimension].total++;
      if (isDue(c.state)) s[c.dimension].due++;
    }
    return s;
  }, [cards]);

  const totalCount = cards.length;
  const totalDue = stats.vocab.due + stats.listening.due + stats.sentence.due;

  // 选定维度的"到期"卡片用于 FlashcardReview
  const reviewCards = useMemo(() => {
    if (reviewing === null) return [];
    const dueCards = cards.filter(c => isDue(c.state));
    if (reviewing === 'all') return dueCards;
    return dueCards.filter(c => c.dimension === reviewing);
  }, [cards, reviewing]);

  const onComplete = useCallback(() => {
    // 复习完成后回到统计面板并刷新数据（让用户看到新的到期数）
    setReviewing(null);
    loadCards();
  }, [loadCards]);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
        加载卡片中...
      </div>
    );
  }

  if (err) {
    return (
      <div className="max-w-2xl mx-auto bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-sm rounded-md px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>加载失败：{err}</div>
      </div>
    );
  }

  // 复习模式
  if (reviewing !== null) {
    const label = reviewing === 'all'
      ? '全部维度'
      : `${DIM_META.find(d => d.key === reviewing)?.emoji ?? ''} ${DIM_META.find(d => d.key === reviewing)?.label ?? ''}`;
    return (
      <>
        <div className="max-w-2xl mx-auto mb-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={() => setReviewing(null)}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            返回统计
          </button>
          <span className="text-muted-foreground">
            正在复习：<span className="text-foreground font-medium">{label}</span>
          </span>
        </div>
        <FlashcardReview
          key={reviewing}
          cards={reviewCards}
          onComplete={onComplete}
        />
      </>
    );
  }

  // 统计面板
  return (
    <>
      {totalCount === 0 ? (
        <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">📇</div>
          <h2 className="text-xl font-semibold mb-2">这个视频还没有闪卡</h2>
          <p className="text-sm text-muted-foreground">在视频学习页加入生词或等管理员生成闪卡后再来</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {DIM_META.map(d => {
              const s = stats[d.key];
              const disabled = s.due === 0;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={disabled}
                  onClick={() => setReviewing(d.key)}
                  className={`text-left border rounded-xl p-5 transition-colors ${d.cardBorder} ${disabled ? 'bg-muted/30 cursor-not-allowed opacity-60' : `${d.cardBg} cursor-pointer`}`}
                >
                  <div className="text-2xl mb-2">{d.emoji}</div>
                  <div className={`text-sm font-semibold mb-1 ${d.accent}`}>{d.label}</div>
                  <div className="text-2xl font-bold">{s.total} <span className="text-xs text-muted-foreground font-normal">张</span></div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {s.due > 0
                      ? <><span className={d.accent}>{s.due}</span> 张到期</>
                      : '暂无到期'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-6 text-center">
            <div className="text-sm text-muted-foreground mb-3">
              共 <b className="text-foreground">{totalCount}</b> 张卡片，今日到期 <b className="text-blue-500">{totalDue}</b> 张
            </div>
            <button
              type="button"
              disabled={totalDue === 0}
              onClick={() => setReviewing('all')}
              className={`px-6 py-2.5 text-sm font-medium rounded-md transition-opacity ${totalDue === 0 ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:opacity-90'}`}
            >
              开始复习（混合所有维度）
            </button>
            {totalDue === 0 && (
              <div className="text-xs text-muted-foreground mt-3">今日所有卡片都已复习，明天再来</div>
            )}
            <div className="text-xs text-muted-foreground mt-3">或点上方维度卡只复习该维度</div>
          </div>
        </>
      )}
    </>
  );
}
