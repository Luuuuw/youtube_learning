'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import FlashcardReview from '@/components/flashcard-review';

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
    due: string;
    state: 0 | 1 | 2 | 3;
    reps: number;
  } | null;
}

interface Stats {
  total: number;
  due: number;
  new: number;
  mastered: number;
  dimensions: Record<Dimension, number>;
  reviewsLast7d: number;
  reviewsLast30d: number;
}

type DimFilter = 'all' | Dimension;

const DIM_CHIPS: { key: DimFilter; label: string; cls: string }[] = [
  {
    key: 'all',
    label: '全部',
    cls: 'bg-foreground/10 text-foreground border-foreground/20 hover:bg-foreground/15',
  },
  {
    key: 'vocab',
    label: '🔤 词汇',
    cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/20',
  },
  {
    key: 'listening',
    label: '🎧 听力',
    cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20',
  },
  {
    key: 'sentence',
    label: '🧱 句型',
    cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/20',
  },
];

const ACTIVE_CLS: Record<DimFilter, string> = {
  all: 'bg-foreground text-background border-foreground',
  vocab: 'bg-indigo-500 text-white border-indigo-500',
  listening: 'bg-blue-500 text-white border-blue-500',
  sentence: 'bg-purple-500 text-white border-purple-500',
};

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function FlashcardsClient() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [cards, setCards] = useState<CardWithState[]>([]);
  const [dim, setDim] = useState<DimFilter>('all');
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingCards, setLoadingCards] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const r = await fetch('/api/flashcards/stats', { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d: Stats = await r.json();
      setStats(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载统计失败');
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadCards = useCallback(async (d: DimFilter) => {
    setLoadingCards(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ due_only: '1' });
      if (d !== 'all') qs.set('dimension', d);
      const r = await fetch(`/api/flashcards?${qs.toString()}`, { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setCards(data.cards || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载卡片失败');
      setCards([]);
    } finally {
      setLoadingCards(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadCards(dim);
  }, [dim, loadCards]);

  const onComplete = useCallback(() => {
    // 复习完成后刷新统计 + 当前维度的到期卡（FSRS 已把它们推到未来）
    loadStats();
    loadCards(dim);
  }, [loadStats, loadCards, dim]);

  return (
    <>
      {/* Stats 区 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label="到期" value={stats?.due} loading={loadingStats} accent="text-blue-500" />
        <StatCard label="新卡" value={stats?.new} loading={loadingStats} accent="text-emerald-500" />
        <StatCard label="总卡" value={stats?.total} loading={loadingStats} accent="text-foreground" />
        <StatCard label="已掌握" value={stats?.mastered} loading={loadingStats} accent="text-amber-500" />
      </div>

      {/* 维度筛选 */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        {DIM_CHIPS.map(c => {
          const active = dim === c.key;
          const count = c.key === 'all'
            ? (stats?.total ?? 0)
            : (stats?.dimensions[c.key as Dimension] ?? 0);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setDim(c.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors ${active ? ACTIVE_CLS[c.key] : c.cls}`}
            >
              <span>{c.label}</span>
              <span className={`text-xs ${active ? 'opacity-90' : 'opacity-70'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* 错误 */}
      {err && (
        <div className="max-w-2xl mx-auto mb-4 bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 text-sm rounded-md px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>加载失败：{err}</div>
        </div>
      )}

      {/* 复习器 */}
      {loadingCards ? (
        <div className="max-w-2xl mx-auto bg-card border border-border rounded-xl p-12 text-center text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          加载卡片中...
        </div>
      ) : (
        <FlashcardReview
          key={dim}
          cards={cards}
          onComplete={onComplete}
        />
      )}
    </>
  );
}

function StatCard({
  label, value, loading, accent,
}: { label: string; value: number | undefined; loading: boolean; accent: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {loading ? (
        <div className="h-7 w-12 bg-muted rounded animate-pulse" />
      ) : (
        <div className={`text-2xl font-bold ${accent}`}>{value ?? 0}</div>
      )}
    </div>
  );
}
