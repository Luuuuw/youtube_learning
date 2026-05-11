'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TrendingUp, Sparkles, MousePointerClick, Brain, Eye } from 'lucide-react';

import { VideoMeta } from '@/types/video';

export default function DashboardClient({ videosJson }: { videosJson: string }) {
  const videos: VideoMeta[] = JSON.parse(videosJson);
  const [clickCounts, setClickCounts] = useState<Record<string, number>>({});
  const [vocabCount, setVocabCount] = useState(0);
  const [aiAdvice, setAiAdvice] = useState('');
  const [loadingAdvice, setLoadingAdvice] = useState(false);

  useEffect(() => {
    let clickData: Record<string, number> = {};

    try {
      const raw = localStorage.getItem('vibe-click-counts');
      if (raw) clickData = JSON.parse(raw);
    } catch { /* ignore */ }

    setClickCounts(clickData);

    if (videos.length === 0) {
      setAiAdvice('暂无视频数据，请先下载一些学习视频。');
      return;
    }

    const totalClicks = Object.values(clickData).reduce((a, b) => a + b, 0);

    const ac = new AbortController();

    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    fetch('/api/vocab?type=stats', { headers: authHeaders })
      .then(r => r.json())
      .then(s => {
        const count = s.total || 0;
        setVocabCount(count);

        const prompt = `学习数据：视频${videos.length}个，总点击${totalClicks}次，生词${count}个。英音${videos.filter((v) => v.accent === 'british').length}个，美音${videos.filter((v) => v.accent === 'american').length}个。请给出3-5条简洁的英语学习建议，每条不超过30字。`;

        setLoadingAdvice(true);

        const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
        fetch('/api/lookup', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ word: prompt, promptType: 'dashboard' }),
          signal: ac.signal,
        })
          .then((res) => res.json())
          .then((res) => {
            if (ac.signal.aborted) return;
            if (res.error) {
              setAiAdvice(`AI 建议获取失败: ${res.error}`);
            } else {
              setAiAdvice(res.definition || '暂无建议');
            }
          })
          .catch((err) => {
            if (ac.signal.aborted) return;
            setAiAdvice(`AI 建议获取失败: ${err.message || '网络错误'}`);
          })
          .finally(() => {
            if (!ac.signal.aborted) setLoadingAdvice(false);
          });
      })
      .catch(() => {
        setVocabCount(0);
      });

    return () => ac.abort();
  }, []);

  const totalClicks = Object.values(clickCounts).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* 点击量和生词数 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="总点击量"
          value={totalClicks}
          icon={MousePointerClick}
          color="text-amber-500"
          bg="bg-amber-500/10"
        />
        <StatCard
          label="生词数量"
          value={vocabCount}
          icon={Brain}
          color="text-purple-500"
          bg="bg-purple-500/10"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 视频分布 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            视频分布
          </h2>
          <div className="space-y-4">
            <DistributionBar
              label="英音"
              count={videos.filter((v) => v.accent === 'british').length}
              total={videos.length}
              color="bg-indigo-500"
            />
            <DistributionBar
              label="美音"
              count={videos.filter((v) => v.accent === 'american').length}
              total={videos.length}
              color="bg-red-500"
            />
            <DistributionBar
              label="未分类"
              count={videos.filter((v) => !v.accent || v.accent === 'other').length}
              total={videos.length}
              color="bg-muted-foreground/30"
            />
          </div>
        </div>

        {/* 点击排行 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Eye className="h-5 w-5 text-muted-foreground" />
            点击排行
          </h2>
          <div className="space-y-3">
            {videos
              .sort((a, b) => (clickCounts[b.id] || 0) - (clickCounts[a.id] || 0))
              .slice(0, 5)
              .map((video, idx) => (
                <Link
                  key={video.id}
                  href={`/${video.id}`}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-muted-foreground w-4">
                      {idx + 1}
                    </span>
                    <span className="text-sm truncate">{video.title}</span>
                  </div>
                  <span className="text-sm font-medium shrink-0 ml-4">
                    {clickCounts[video.id] || 0} 次
                  </span>
                </Link>
              ))}
          </div>
        </div>
      </div>

      {/* AI 学习建议 */}
      <div className="bg-card border border-border rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-amber-500" />
          AI 学习建议
        </h2>
        {loadingAdvice ? (
          <div className="text-sm text-muted-foreground">正在分析数据...</div>
        ) : (
          <div className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
            {aiAdvice}
          </div>
        )}
      </div>

      {/* 最近添加 */}
      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">最近添加</h2>
        <div className="space-y-3">
          {videos
            .sort((a, b) => {
              const da = a.downloadedAt ? new Date(a.downloadedAt).getTime() : 0;
              const db = b.downloadedAt ? new Date(b.downloadedAt).getTime() : 0;
              return db - da;
            })
            .slice(0, 5)
            .map((video) => (
              <Link
                key={video.id}
                href={`/${video.id}`}
                className="flex items-center justify-between py-2 border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
                  <span className="text-sm truncate">{video.title}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-4">
                  {video.accent && video.accent !== 'other' && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                        video.accent === 'british'
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20'
                          : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                      }`}
                    >
                      {video.accent === 'british' ? '英音' : '美音'}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {video.downloadedAt
                      ? new Date(video.downloadedAt).toLocaleDateString('zh-CN')
                      : ''}
                  </span>
                </div>
              </Link>
            ))}
        </div>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`inline-flex p-2 rounded-lg ${bg} ${color} mb-3`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function DistributionBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {count} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
