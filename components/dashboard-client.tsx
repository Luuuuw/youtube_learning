'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  BookOpen, Clock, Languages, HelpCircle, HardDrive, AlertTriangle,
  ArrowUpDown, Search, ChevronRight, Wrench, Loader2, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

interface VideoHealth {
  videoId: string;
  title: string;
  duration: number;
  accent?: string;
  category?: string;
  difficulty?: string;
  downloadedAt?: string;
  thumbnailUrl?: string;
  zhCueTotal: number;
  zhCueFilled: number;
  zhCoverage: number;
  quizTotal: number;
  quizEasy: number;
  quizMedium: number;
  quizHard: number;
  hasMp4: boolean;
  hasThumbnail: boolean;
  hasEnVtt: boolean;
  hasZhVtt: boolean;
  hasMeta: boolean;
  hasQuiz: boolean;
  metaComplete: boolean;
  fileSizeMB: number;
  healthScore: number;
  issues: string[];
}

interface Summary {
  totalVideos: number;
  totalDurationMin: number;
  totalStorageMB: number;
  totalQuiz: number;
  avgCoverage: number;
  incompleteCount: number;
}

type SortKey = 'health' | 'coverage' | 'quiz' | 'duration' | 'downloadedAt';

type FixKind = 'translate' | 'quiz' | 'tag';

interface FixAction {
  kind: FixKind;
  label: string;          // 显示在 badge 上
  tooltip: string;        // hover 解释
  destructive?: boolean;  // true = 触发前要确认
}

interface ProgressState {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  current: number;
  currentVideoId: string;
  currentStep: string;
  logs?: string[];
  updatedAt?: string;
}

// 根据 VideoHealth 字段推导可执行的 AI 修复（不解析人话 issues 字符串）
function buildActions(v: VideoHealth): FixAction[] {
  const out: FixAction[] = [];
  if (v.zhCueTotal > 0 && v.zhCoverage < 1) {
    const missing = v.zhCueTotal - v.zhCueFilled;
    out.push({
      kind: 'translate',
      label: `翻译缺 ${missing} 条`,
      tooltip: 'MiniMax 初翻 + DeepSeek 审校（会覆盖现有 zh 文件）',
      destructive: true,
    });
  } else if (v.zhCueTotal === 0 && v.hasEnVtt) {
    out.push({
      kind: 'translate',
      label: '无中文字幕',
      tooltip: 'MiniMax 初翻 + DeepSeek 审校',
      destructive: false,
    });
  }
  if (v.quizTotal === 0 && v.hasEnVtt) {
    out.push({
      kind: 'quiz',
      label: '无 quiz',
      tooltip: 'MiniMax 基于字幕生成 20-25 道题',
    });
  }
  if (!v.metaComplete && v.hasEnVtt) {
    const miss: string[] = [];
    if (!v.accent) miss.push('口音');
    if (!v.category) miss.push('分类');
    if (!v.difficulty) miss.push('难度');
    if (miss.length) {
      out.push({
        kind: 'tag',
        label: `meta 缺：${miss.join('/')}`,
        tooltip: 'MiniMax 自动打标签（重写 meta.json）',
      });
    }
  }
  return out;
}

// 不能用 AI 修的问题（缺缩略图/MP4/英文字幕、quiz < 10）
// 注意：本地无 mp4 不算问题（CDN 模式预期）；只有 backend issues 里出现"无 MP4"才显示
function buildNonAiIssues(v: VideoHealth): string[] {
  const out: string[] = [];
  if (!v.hasEnVtt) out.push('无英文字幕（需 yt-dlp）');
  if (v.issues.includes('无 MP4')) out.push('无 MP4（本地+CDN 都没）');
  if (!v.hasThumbnail) out.push('无缩略图（需 ffmpeg）');
  if (v.quizTotal > 0 && v.quizTotal < 10) out.push(`quiz 仅 ${v.quizTotal} 题`);
  return out;
}

const FIX_KIND_LABEL: Record<FixKind, string> = {
  translate: '字幕翻译',
  quiz: '生成 Quiz',
  tag: '自动打标',
};

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function DashboardClient() {
  const [videos, setVideos] = useState<VideoHealth[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'noQuiz' | 'lowCoverage'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('health');
  const [sortAsc, setSortAsc] = useState(true);

  // 修复任务状态
  const [fixing, setFixing] = useState<{ videoId: string; kind: FixKind } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ video: VideoHealth; action: FixAction } | null>(null);
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/dashboard', { headers: getAuthHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setVideos(d.videos || []);
      setSummary(d.summary || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    loadDashboard().finally(() => setLoading(false));
  }, [loadDashboard]);

  // 启动时检查是否有在跑的任务（页面刷新场景）
  useEffect(() => {
    let cancelled = false;
    fetch('/api/process-all', { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(p => {
        if (cancelled || !p) return;
        if (p.status === 'running') {
          setProgress(p);
          // 恢复轮询；fixing 状态此时未知（页面刷新后），不阻止 UI
          startPolling();
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    const tick = async () => {
      try {
        const r = await fetch('/api/process-all', { headers: getAuthHeaders() });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const p: ProgressState = await r.json();
        setProgress(p);
        if (p.status === 'completed') {
          setFixing(null);
          await loadDashboard();
          // 2 秒后隐藏 toast
          pollTimerRef.current = setTimeout(() => {
            setProgress(null);
          }, 2000);
          return;
        }
        if (p.status === 'error') {
          setFixing(null);
          // 错误留住直到用户关
          return;
        }
        pollTimerRef.current = setTimeout(tick, 2000);
      } catch {
        pollTimerRef.current = setTimeout(tick, 4000);
      }
    };
    pollTimerRef.current = setTimeout(tick, 1500);
  }, [loadDashboard, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const startFix = useCallback(async (video: VideoHealth, action: FixAction) => {
    setFixError(null);

    // 互斥检查
    try {
      const r = await fetch('/api/process-all', { headers: getAuthHeaders() });
      if (r.ok) {
        const p: ProgressState = await r.json();
        if (p.status === 'running') {
          setFixError('已有任务在跑：' + (p.currentStep || '...'));
          return;
        }
      }
    } catch { /* ignore */ }

    const body: { step: FixKind; videoIds: string[]; force?: boolean } = {
      step: action.kind,
      videoIds: [video.videoId],
    };
    if (action.kind === 'tag' || action.kind === 'translate') body.force = true;

    try {
      const r = await fetch('/api/process-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setFixing({ videoId: video.videoId, kind: action.kind });
      setProgress({
        status: 'running',
        total: 1,
        current: 0,
        currentVideoId: video.videoId,
        currentStep: FIX_KIND_LABEL[action.kind],
      });
      startPolling();
    } catch (e) {
      setFixError(e instanceof Error ? e.message : '触发失败');
    }
  }, [startPolling]);

  const onBadgeClick = useCallback((video: VideoHealth, action: FixAction) => {
    if (fixing) return;
    if (action.destructive) {
      setConfirmDialog({ video, action });
    } else {
      startFix(video, action);
    }
  }, [fixing, startFix]);

  const confirmAndFix = useCallback(() => {
    if (!confirmDialog) return;
    const { video, action } = confirmDialog;
    setConfirmDialog(null);
    startFix(video, action);
  }, [confirmDialog, startFix]);

  // 翻译完整度直方图数据
  const coverageBuckets = useMemo(() => {
    const buckets = [
      { label: '0-20%', count: 0, min: 0, max: 0.2 },
      { label: '20-40%', count: 0, min: 0.2, max: 0.4 },
      { label: '40-60%', count: 0, min: 0.4, max: 0.6 },
      { label: '60-80%', count: 0, min: 0.6, max: 0.8 },
      { label: '80-99%', count: 0, min: 0.8, max: 0.999999 },
      { label: '100%', count: 0, min: 1, max: 1.000001 },
    ];
    for (const v of videos) {
      if (v.zhCueTotal === 0) continue;
      for (const b of buckets) {
        if (v.zhCoverage >= b.min && v.zhCoverage < b.max) {
          b.count++;
          break;
        }
      }
    }
    return buckets;
  }, [videos]);

  // 健康度 bottom 10
  const bottom10 = useMemo(() => {
    return [...videos].sort((a, b) => a.healthScore - b.healthScore).slice(0, 10).map(v => ({
      name: v.title.length > 24 ? v.title.slice(0, 22) + '…' : v.title,
      score: v.healthScore,
      id: v.videoId,
    }));
  }, [videos]);

  // 排序 + 过滤
  const filteredSorted = useMemo(() => {
    let list = videos.slice();
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(v => v.title.toLowerCase().includes(s) || v.videoId.toLowerCase().includes(s));
    }
    if (filter === 'low') list = list.filter(v => v.healthScore < 80);
    else if (filter === 'noQuiz') list = list.filter(v => v.quizTotal === 0);
    else if (filter === 'lowCoverage') list = list.filter(v => v.zhCueTotal > 0 && v.zhCoverage < 1);

    list.sort((a, b) => {
      let av = 0, bv = 0;
      if (sortKey === 'health') { av = a.healthScore; bv = b.healthScore; }
      else if (sortKey === 'coverage') { av = a.zhCoverage; bv = b.zhCoverage; }
      else if (sortKey === 'quiz') { av = a.quizTotal; bv = b.quizTotal; }
      else if (sortKey === 'duration') { av = a.duration; bv = b.duration; }
      else if (sortKey === 'downloadedAt') {
        av = a.downloadedAt ? new Date(a.downloadedAt).getTime() : 0;
        bv = b.downloadedAt ? new Date(b.downloadedAt).getTime() : 0;
      }
      return sortAsc ? av - bv : bv - av;
    });
    return list;
  }, [videos, search, filter, sortKey, sortAsc]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(s => !s);
    else { setSortKey(k); setSortAsc(k === 'health' || k === 'coverage' || k === 'quiz'); }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (err) {
    return <div className="text-sm text-red-500">加载失败：{err}</div>;
  }

  if (!summary) return null;

  return (
    <>
      {/* 顶部 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={BookOpen}
          color="text-blue-500"
          bg="bg-blue-500/10"
          label="视频总数"
          value={String(summary.totalVideos)}
          sub={`${summary.totalDurationMin} 分钟`}
        />
        <KpiCard
          icon={Languages}
          color="text-emerald-500"
          bg="bg-emerald-500/10"
          label="翻译完整度"
          value={`${(summary.avgCoverage * 100).toFixed(1)}%`}
          sub={`${videos.filter(v => v.zhCueTotal > 0 && v.zhCoverage < 1).length} 个未译完`}
        />
        <KpiCard
          icon={HelpCircle}
          color="text-purple-500"
          bg="bg-purple-500/10"
          label="Quiz 总题数"
          value={String(summary.totalQuiz)}
          sub={`${videos.filter(v => v.quizTotal === 0).length} 个无 quiz`}
        />
        <KpiCard
          icon={HardDrive}
          color="text-amber-500"
          bg="bg-amber-500/10"
          label="本地存储"
          value={`${(summary.totalStorageMB / 1024).toFixed(2)} GB`}
          sub={`${videos.filter(v => !v.hasMp4).length} 个走 CDN`}
        />
      </div>

      {/* 警告条 */}
      {summary.incompleteCount > 0 && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-8 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span><b>{summary.incompleteCount}</b> 个视频健康度低于 80 分，需要补充字幕 / quiz / meta</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* 直方图：翻译完整度分布 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold mb-1">翻译完整度分布</h2>
          <p className="text-xs text-muted-foreground mb-4">每个区间内的视频数量。100% 越多越好</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={coverageBuckets} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                formatter={(value) => [Number(value), '视频数']}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {coverageBuckets.map((b, i) => (
                  <Cell key={i} fill={b.label === '100%' ? '#22c55e' : i < 3 ? '#ef4444' : '#eab308'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 健康度 bottom 10 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold mb-1">健康度最低 10 个</h2>
          <p className="text-xs text-muted-foreground mb-4">优先修复的视频。点条可跳转</p>
          {bottom10.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={bottom10} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  formatter={(value) => [`${Number(value)} 分`, '健康度']}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                  {bottom10.map((b, i) => (
                    <Cell key={i} fill={b.score < 50 ? '#ef4444' : b.score < 80 ? '#eab308' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 健康度表格 */}
      <div className="bg-card border border-border rounded-xl">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3 sm:items-center">
          <h2 className="text-base font-semibold mr-auto">视频健康度（{filteredSorted.length}）</h2>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜标题或 ID"
                className="pl-8 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-md w-44 outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as typeof filter)}
              className="py-1.5 px-2 text-sm bg-muted/50 border border-border rounded-md outline-none"
            >
              <option value="all">全部</option>
              <option value="low">健康度 &lt; 80</option>
              <option value="noQuiz">缺 Quiz</option>
              <option value="lowCoverage">翻译未完</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="text-left font-medium px-4 py-3">视频</th>
                <Th label="时长" k="duration" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="翻译" k="coverage" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="Quiz" k="quiz" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <th className="text-left font-medium px-3 py-3">文件</th>
                <Th label="健康度" k="health" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <th className="text-left font-medium px-3 py-3">问题</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map(v => (
                <tr key={v.videoId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 max-w-[260px]">
                    <Link href={`/${v.videoId}`} className="block">
                      <div className="text-sm font-medium truncate">{v.title}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{v.videoId}</div>
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    <Clock className="inline h-3 w-3 mr-1 -mt-0.5" />
                    {formatDuration(v.duration)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <CoverageBar coverage={v.zhCoverage} filled={v.zhCueFilled} total={v.zhCueTotal} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium">{v.quizTotal}</div>
                    <div className="text-[10px] text-muted-foreground">{v.quizEasy}/{v.quizMedium}/{v.quizHard}</div>
                  </td>
                  <td className="px-3 py-3">
                    <FileIcons v={v} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <ScoreBadge score={v.healthScore} />
                  </td>
                  <td className="px-3 py-3">
                    <IssueCell
                      v={v}
                      fixingThis={fixing?.videoId === v.videoId ? fixing.kind : null}
                      disabled={!!fixing}
                      onClick={onBadgeClick}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Link href={`/${v.videoId}`} className="text-muted-foreground hover:text-foreground">
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))}
              {filteredSorted.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">没有匹配的视频</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmDialog && (
        <ConfirmDialog
          video={confirmDialog.video}
          action={confirmDialog.action}
          onCancel={() => setConfirmDialog(null)}
          onConfirm={confirmAndFix}
        />
      )}

      {(progress || fixError) && (
        <ProgressToast
          progress={progress}
          error={fixError}
          onClose={() => { setProgress(null); setFixError(null); }}
        />
      )}
    </>
  );
}

function IssueCell({
  v, fixingThis, disabled, onClick,
}: {
  v: VideoHealth;
  fixingThis: FixKind | null;
  disabled: boolean;
  onClick: (v: VideoHealth, a: FixAction) => void;
}) {
  const actions = buildActions(v);
  const nonAi = buildNonAiIssues(v);

  if (actions.length === 0 && nonAi.length === 0) {
    return <span className="text-xs text-emerald-600">—</span>;
  }

  const kindStyles: Record<FixKind, string> = {
    translate: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/20',
    quiz: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/20',
    tag: 'bg-pink-500/10 text-pink-700 dark:text-pink-400 border-pink-500/30 hover:bg-pink-500/20',
  };

  return (
    <div className="flex flex-wrap gap-1 max-w-[260px]">
      {actions.map((a, i) => {
        const isFixing = fixingThis === a.kind;
        return (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onClick(v, a)}
            title={a.tooltip}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${kindStyles[a.kind]} ${disabled && !isFixing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {a.label}
            {isFixing
              ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
              : <Wrench className="h-2.5 w-2.5" />}
          </button>
        );
      })}
      {nonAi.slice(0, 2).map((s, i) => (
        <span
          key={`na-${i}`}
          title="非 AI 任务（需 ffmpeg / yt-dlp 等）"
          className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded cursor-not-allowed"
        >
          {s}
        </span>
      ))}
      {nonAi.length > 2 && (
        <span className="text-[10px] text-muted-foreground">+{nonAi.length - 2}</span>
      )}
    </div>
  );
}

function ConfirmDialog({
  video, action, onCancel, onConfirm,
}: {
  video: VideoHealth;
  action: FixAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // 翻译 token 粗估：每条 cue 平均 50 in + 30 out tokens，MiniMax + DeepSeek 各跑一次
  const cues = video.zhCueTotal || 0;
  const estIn = cues * 50 * 2;
  const estOut = cues * 30 * 2;
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="bg-amber-500/15 p-2 rounded-lg shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold mb-1">确认重新翻译</h3>
            <p className="text-sm text-muted-foreground truncate">{video.title}</p>
          </div>
        </div>
        <div className="bg-muted/50 rounded-lg p-3 text-xs space-y-1 mb-4">
          <div>· 现有 <b>video.zh-Hans.{`{vtt,json}`}</b> 会被删除并重写</div>
          <div>· 已存在 <code>.translate-state.json</code> 的视频会跳过已译 cue</div>
          <div>· 粗估调用量：input ≈ {(estIn / 1000).toFixed(1)}K / output ≈ {(estOut / 1000).toFixed(1)}K tokens</div>
          <div>· 预计耗时：{Math.max(1, Math.ceil(cues / 60))} 分钟</div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-border rounded-md hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-md transition-colors"
          >
            确认重译
          </button>
        </div>
      </div>
    </div>
  );
}

function ProgressToast({
  progress, error, onClose,
}: {
  progress: ProgressState | null;
  error: string | null;
  onClose: () => void;
}) {
  const isError = !!error || progress?.status === 'error';
  const isDone = progress?.status === 'completed';
  const pct = progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  return (
    <div className={`fixed bottom-4 right-4 z-50 w-80 rounded-xl border shadow-lg p-4 text-sm ${
      isError ? 'bg-red-500/10 border-red-500/40' : isDone ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-card border-border'
    }`}>
      <div className="flex items-start gap-2 mb-2">
        {isError ? (
          <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
        ) : isDone ? (
          <Wrench className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-foreground mt-0.5 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">
            {isError ? '修复失败'
              : isDone ? '修复完成'
              : progress?.currentStep || '准备中...'}
          </div>
          {progress?.currentVideoId && (
            <div className="text-xs text-muted-foreground font-mono truncate">
              {progress.currentVideoId}
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {!isError && progress && (
        <>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden mb-2">
            <div
              className={`h-full transition-all duration-300 ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {progress.current}/{progress.total}
            {progress.logs && progress.logs.length > 0 && (
              <span className="block truncate mt-1">{progress.logs[progress.logs.length - 1]}</span>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</div>
      )}
    </div>
  );
}

function KpiCard({
  icon: Icon, color, bg, label, value, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`inline-flex p-2 rounded-lg ${bg} ${color} mb-3`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/70 mt-1">{sub}</div>}
    </div>
  );
}

function Th({
  label, k, sortKey, sortAsc, onClick,
}: { label: string; k: SortKey; sortKey: SortKey; sortAsc: boolean; onClick: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className="text-left font-medium px-3 py-3 whitespace-nowrap">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'} ${active && !sortAsc ? 'rotate-180' : ''}`} />
      </button>
    </th>
  );
}

function CoverageBar({ coverage, filled, total }: { coverage: number; filled: number; total: number }) {
  if (total === 0) {
    return <span className="text-xs text-red-500">—</span>;
  }
  const pct = coverage * 100;
  const color = coverage >= 1 ? 'bg-emerald-500' : coverage >= 0.8 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="min-w-[80px]">
      <div className="text-xs mb-1">{pct.toFixed(0)}% <span className="text-muted-foreground">({filled}/{total})</span></div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FileIcons({ v }: { v: VideoHealth }) {
  const items: { ok: boolean; label: string }[] = [
    { ok: v.hasMp4, label: 'MP4' },
    { ok: v.hasThumbnail, label: '缩略图' },
    { ok: v.hasEnVtt, label: 'EN' },
    { ok: v.hasZhVtt, label: 'ZH' },
    { ok: v.hasMeta, label: 'META' },
    { ok: v.hasQuiz, label: 'QUIZ' },
  ];
  return (
    <div className="flex gap-1">
      {items.map((it, i) => (
        <span
          key={i}
          title={`${it.label}${it.ok ? ' 存在' : ' 缺失'}`}
          className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${
            it.ok
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
          }`}
        >
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 90 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
    : score >= 80 ? 'bg-lime-500/15 text-lime-700 dark:text-lime-400 border-lime-500/30'
    : score >= 60 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
    : 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold ${cls}`}>
      {score}
    </span>
  );
}

function formatDuration(sec: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
