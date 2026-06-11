'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Trophy, Flame, BookOpen, Brain, Play, Mic, Target, CheckCircle2, Sparkles, PartyPopper, ArrowRight, RefreshCw } from 'lucide-react';
import Link from 'next/link';

interface DailySummaryProps {
  open: boolean;
  onClose: () => void;
  userCode: string | null;
}

interface SummaryData {
  todayVideosWatched: number;
  totalWatchTime: number;
  newWordsAdded: number;
  wordsReviewed: number;
  wordsRemembered: number;
  wordsForgotten: number;
  streakDays: number;
  streakChange: 'new' | 'continued' | 'broken' | 'none';
}

export default function DailySummary({ open, onClose, userCode }: DailySummaryProps) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    if (!userCode) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const [vocabStatsRes, weeklyRes, calendarRes] = await Promise.all([
        fetch('/api/vocab?type=stats', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/vocab?type=weekly', { headers }).then(r => r.json()).catch(() => ({ weekly: [] })),
        fetch('/api/activity/calendar', { headers }).then(r => r.json()).catch(() => []),
      ]);

      const stats = vocabStatsRes.stats || {};
      const weekly = weeklyRes.weekly || [];

      const todayRecorded = weekly.find((w: { date: string }) => w.date === new Date().toISOString().slice(0, 10));
      const newWordsAdded = todayRecorded?.added || stats.newToday || 0;

      let wordsReviewed = 0;
      let wordsRemembered = 0;
      let wordsForgotten = 0;
      weekly.forEach((w: { date: string; remembered?: number; forgotten?: number; reviewed?: number }) => {
        if (w.date === new Date().toISOString().slice(0, 10)) {
          wordsReviewed = w.reviewed || (w.remembered ?? 0) + (w.forgotten ?? 0) || 0;
          wordsRemembered = w.remembered || 0;
          wordsForgotten = w.forgotten || 0;
        }
      });

      let todayVideosWatched = 0;
      let streakDays = 0;
      let streakChange: SummaryData['streakChange'] = 'none';

      if (Array.isArray(calendarRes)) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        const todayData = calendarRes.find((c: { date: string }) => c.date === todayKey);
        const yesterdayData = calendarRes.find((c: { date: string }) => c.date === yesterdayKey);
        todayVideosWatched = todayData?.videoIds?.length || 0;

        for (let i = 0; i < 365; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          const dayData = calendarRes.find((c: { date: string }) => c.date === key);
          if (dayData?.videoIds?.length > 0) streakDays++;
          else break;
        }

        if (todayVideosWatched > 0) {
          if (yesterdayData?.videoIds?.length > 0) streakChange = 'continued';
          else if (streakDays === 1) streakChange = 'new';
          else streakChange = 'continued';
        } else {
          if (yesterdayData?.videoIds?.length > 0 && streakDays >= 1) streakChange = 'broken';
        }
      }

      const clickDataStr = localStorage.getItem('vibe-click-counts');
      const clickData: Record<string, number> = clickDataStr ? JSON.parse(clickDataStr) : {};
      const totalClicks = Object.values(clickData).reduce((a, b) => a + b, 0);

      setData({
        todayVideosWatched,
        totalWatchTime: Math.round(totalClicks * 1.5),
        newWordsAdded,
        wordsReviewed,
        wordsRemembered,
        wordsForgotten,
        streakDays,
        streakChange,
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userCode]);

  useEffect(() => {
    if (open) fetchSummary();
  }, [open, fetchSummary]);

  if (!open) return null;

  const isEmptyDay = data && data.todayVideosWatched === 0 && data.newWordsAdded === 0 && data.wordsReviewed === 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded-lg hover:bg-muted transition-colors z-10">
          <X className="h-4 w-4 text-muted-foreground" />
        </button>

        {loading ? (
          <div className="p-8 text-center">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">正在统计今日数据...</p>
          </div>
        ) : isEmptyDay ? (
          <EmptyState onClose={onClose} />
        ) : data ? (
          <SummaryContent data={data} onClose={onClose} onRefresh={fetchSummary} />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="p-8 text-center">
      <div className="text-5xl mb-4">📚</div>
      <h2 className="text-lg font-bold mb-2">今天还没开始学习哦</h2>
      <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
        选一个视频开始今天的英语之旅吧！<br />只需 15 分钟，就能看到进步
      </p>
      <Link
        href="/"
        onClick={onClose}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
      >
        去选视频 <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function SummaryContent({ data, onClose, onRefresh }: { data: SummaryData; onClose: () => void; onRefresh: () => void }) {
  const hasActivity = data.todayVideosWatched > 0 || data.wordsReviewed > 0 || data.newWordsAdded > 0;
  const reviewAccuracy = data.wordsReviewed > 0 ? Math.round((data.wordsRemembered / data.wordsReviewed) * 100) : 0;

  const achievements: { icon: React.ReactNode; label: string; value: string; color: string }[] = [];

  if (data.todayVideosWatched > 0) {
    achievements.push({
      icon: <Play className="h-4 w-4" />,
      label: '观看视频',
      value: `${data.todayVideosWatched} 个`,
      color: 'text-blue-400',
    });
  }
  if (data.newWordsAdded > 0) {
    achievements.push({
      icon: <BookOpen className="h-4 w-4" />,
      label: '新增生词',
      value: `${data.newWordsAdded} 词`,
      color: 'text-emerald-400',
    });
  }
  if (data.wordsReviewed > 0) {
    achievements.push({
      icon: <Brain className="h-4 w-4" />,
      label: '复习生词',
      value: `${data.wordsRemembered}/${data.wordsReviewed}`,
      color: 'text-purple-400',
    });
  }

  return (
    <div className="p-6 sm:p-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 mb-3">
          {hasActivity ? <PartyPopper className="h-7 w-7 text-orange-400" /> : <Sparkles className="h-7 w-7 text-amber-400" />}
        </div>

        {data.streakChange !== 'none' && data.streakDays > 0 && (
          <div className="mb-3">
            {data.streakChange === 'new' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-green-500/15 text-green-400">
                <Flame className="h-3 w-3" /> 开始连续打卡！
              </span>
            )}
            {data.streakChange === 'continued' && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-orange-500/15 text-orange-400">
                <Flame className="h-3 w-3" /> 连续 {data.streakDays} 天
              </span>
            )}
            {data.streakDays >= 7 && (
              <p className="text-xs text-orange-400 mt-1 font-medium">🔥 一周不间断，太强了！</p>
            )}
            {data.streakDays >= 30 && (
              <p className="text-xs text-amber-400 mt-1 font-medium">🏆 一个月坚持，习惯已养成！</p>
            )}
          </div>
        )}

        <h2 className="text-xl font-bold">
          {hasActivity ? '今日学习完成！' : '今日小结'}
        </h2>
        {!hasActivity && (
          <p className="text-sm text-muted-foreground mt-1">继续努力，明天会更好</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        {achievements.map((a, i) => (
          <div key={i} className="bg-muted/50 border border-border rounded-xl p-3 text-center">
            <div className={`flex justify-center mb-1 ${a.color}`}>{a.icon}</div>
            <div className="text-base font-bold">{a.value}</div>
            <div className="text-[11px] text-muted-foreground">{a.label}</div>
          </div>
        ))}
        {achievements.length === 0 && (
          <>
            <div className="bg-muted/50 border border-border rounded-xl p-3 text-center col-span-3">
              <p className="text-sm text-muted-foreground">今天还没有学习记录</p>
            </div>
          </>
        )}
      </div>

      {data.wordsReviewed > 0 && (
        <div className="bg-purple-500/5 border border-purple-500/12 rounded-xl p-3.5 mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Target className="h-3 w-3" /> 复习正确率
            </span>
            <span className={`text-sm font-bold ${reviewAccuracy >= 80 ? 'text-green-400' : reviewAccuracy >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
              {reviewAccuracy}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${reviewAccuracy >= 80 ? 'bg-green-500' : reviewAccuracy >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${reviewAccuracy}%` }}
            />
          </div>
          {reviewAccuracy >= 80 && <p className="text-[11px] text-green-400 mt-1.5">记忆效果很好，继续保持！</p>}
          {reviewAccuracy >= 60 && reviewAccuracy < 80 && <p className="text-[11px] text-amber-400 mt-1.5">还不错，多复习几遍会更牢固</p>}
          {reviewAccuracy < 60 && reviewAccuracy > 0 && <p className="text-[11px] text-red-400 mt-1.5">需要加强复习，建议降低新词量</p>}
        </div>
      )}

      <div className="bg-gradient-to-r from-primary/[0.04] to-orange-500/[0.04] border border-primary/10 rounded-xl p-4 mb-5">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {data.streakDays === 0
              ? '今天迈出第一步，明天继续保持！每天 15 分钟，一个月后你会感谢自己。'
              : data.streakDays < 7
              ? `已经连续 ${data.streakDays} 天了！再坚持几天就能养成稳定的学习习惯。`
              : data.streakDays < 30
              ? `连续 ${data.streakDays} 天，你的毅力令人敬佩！英语能力正在稳步提升。`
              : `整整 ${data.streakDays} 天！你已经超越了 90% 的学习者。`}
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => { onRefresh(); }}
          className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
        >
          刷新数据
        </button>
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          继续学习
        </button>
      </div>
    </div>
  );
}

const summaryTriggerKey = 've-daily-summary-shown';

export function shouldShowDailySummary(): boolean {
  if (typeof window === 'undefined') return false;
  const lastShown = localStorage.getItem(summaryTriggerKey);
  const today = new Date().toISOString().slice(0, 10);
  return lastShown !== today;
}

export function markDailySummaryShown(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(summaryTriggerKey, new Date().toISOString().slice(0, 10));
}
