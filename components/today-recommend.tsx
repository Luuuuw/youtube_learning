'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Play, BookOpen, Brain, Flame, ChevronRight, Clock, ArrowRight } from 'lucide-react';
import { VideoMeta, DIFFICULTY_LABELS } from '@/types/video';

interface TodayRecommendProps {
  videos: VideoMeta[];
  userCode: string | null;
}

interface RecommendData {
  video: VideoMeta | null;
  lastPosition?: number;
  dueWordsCount: number;
  totalWords: number;
  streakDays: number;
  todayVideosWatched: number;
}

export default function TodayRecommend({ videos, userCode }: TodayRecommendProps) {
  const [data, setData] = useState<RecommendData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchRecommendData = useCallback(async () => {
    if (!userCode) {
      setLoading(false);
      return;
    }

    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

      const [vocabRes, calendarRes] = await Promise.all([
        fetch('/api/vocab?type=stats', { headers }).then(r => r.json()).catch(() => ({})),
        fetch('/api/activity/calendar', { headers }).then(r => r.json()).catch(() => []),
      ]);

      const vocabStats = vocabRes.stats || {};
      const dueWordsCount = vocabStats.due || 0;
      const totalWords = vocabStats.total || 0;

      let streakDays = 0;
      let todayVideosWatched = 0;

      if (Array.isArray(calendarRes)) {
        const todayKey = new Date().toISOString().slice(0, 10);
        const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        for (let i = 0; i < 365; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          const dayData = calendarRes.find((c: { date: string }) => c.date === key);
          if (dayData?.videoIds?.length > 0) streakDays++;
          else break;
        }

        const todayData = calendarRes.find((c: { date: string }) => c.date === todayKey);
        todayVideosWatched = todayData?.videoIds?.length || 0;
      }

      let recommendedVideo: VideoMeta | null = null;

      const clickDataStr = localStorage.getItem('vibe-click-counts');
      const clickData: Record<string, number> = clickDataStr ? JSON.parse(clickDataStr) : {};
      const sortedByClicks = [...videos].sort((a, b) => (clickData[b.id] || 0) - (clickData[a.id] || 0));

      if (sortedByClicks.length > 0 && (clickData[sortedByClicks[0].id] || 0) > 0) {
        recommendedVideo = sortedByClicks[0];
      } else if (videos.length > 0) {
        const intermediateVideos = videos.filter(v => v.difficulty === 'intermediate');
        recommendedVideo = intermediateVideos.length > 0
          ? intermediateVideos[Math.floor(Math.random() * intermediateVideos.length)]
          : videos[Math.floor(Math.random() * videos.length)];
      }

      setData({
        video: recommendedVideo,
        dueWordsCount,
        totalWords,
        streakDays,
        todayVideosWatched,
      });
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [userCode, videos]);

  useEffect(() => {
    fetchRecommendData();
  }, [fetchRecommendData]);

  if (!userCode) return null;

  if (loading) {
    return (
      <div className="mb-8 bg-gradient-to-r from-primary/5 via-card to-primary/5 border border-primary/15 rounded-2xl p-5 sm:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-muted rounded w-32" />
          <div className="flex gap-4">
            <div className="h-24 bg-muted rounded-xl flex-1 max-w-[160px]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
              <div className="h-7 bg-muted rounded w-28 mt-3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { video, dueWordsCount, totalWords, streakDays, todayVideosWatched } = data;

  const progressPct = Math.min(todayVideosWatched * 33, 100);

  return (
    <div className="mb-8 bg-gradient-to-br from-primary/[0.06] via-card to-orange-500/[0.04] border border-primary/12 rounded-2xl overflow-hidden">
      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20">
              <Flame className="h-4 w-4 text-orange-400" />
            </div>
            <h2 className="text-base font-bold">今日推荐</h2>
          </div>
          <div className="flex items-center gap-3">
            {streakDays > 0 && (
              <span className="flex items-center gap-1 text-xs font-medium text-orange-400 bg-orange-500/10 px-2 py-1 rounded-full">
                <Flame className="h-3 w-3" /> {streakDays}天
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          {video ? (
            <>
              <Link href={`/${video.id}`} className="group shrink-0 block">
                <div className="w-full sm:w-[180px] aspect-video bg-muted rounded-xl overflow-hidden relative">
                  {video.thumbnail ? (
                    <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Play className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors duration-300 flex items-center justify-center">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 p-2.5 bg-white/25 rounded-full backdrop-blur-sm">
                      <Play className="h-5 w-5 text-white ml-0.5" />
                    </div>
                  </div>
                  {video.difficulty && (
                    <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ color: DIFFICULTY_LABELS[video.difficulty].color, backgroundColor: DIFFICULTY_LABELS[video.difficulty].bg }}
                    >
                      {DIFFICULTY_LABELS[video.difficulty].label}
                    </span>
                  )}
                </div>
              </Link>

              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div>
                  <h3 className="font-semibold text-sm sm:text-base line-clamp-2 leading-snug mb-1">
                    {video.title}
                  </h3>
                  {video.category && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {video.accent === 'british' ? '🇬🇧 英音' : video.accent === 'american' ? '🇺🇸 美音' : ''}
                      {video.difficulty ? ` · ${DIFFICULTY_LABELS[video.difficulty].label}` : ''}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <Link
                    href={`/${video.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                  >
                    <Play className="h-3.5 w-3.5" /> 继续学习
                  </Link>
                  {dueWordsCount > 0 && (
                    <Link
                      href="/vocab?tab=review"
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-purple-500/25 text-purple-400 text-xs font-medium hover:bg-purple-500/5 transition-colors"
                    >
                      <Brain className="h-3.5 w-3.5" /> 复习{dueWordsCount}词
                    </Link>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 text-center py-4">
              <p className="text-muted-foreground text-sm">还没有视频，先添加一些学习资源吧</p>
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>今日进度</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-green-500 via-emerald-400 to-teal-400 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between mt-3 text-xs">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-muted-foreground">
                <BookOpen className="h-3 w-3" /> {totalWords}词
              </span>
              {dueWordsCount > 0 && (
                <span className="flex items-center gap-1 text-purple-400">
                  <Brain className="h-3 w-3" /> {dueWordsCount}待复习
                </span>
              )}
              {todayVideosWatched > 0 && (
                <span className="flex items-center gap-1 text-green-400">
                  <Play className="h-3 w-3" /> {todayVideosWatched}视频
                </span>
              )}
            </div>
            <Link href="/vocab" className="flex items-center gap-1 text-primary hover:underline">
              生词本 <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
