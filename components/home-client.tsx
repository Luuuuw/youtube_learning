'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BookOpen, NotebookPen, Download, BarChart3, X, Tags, Loader2, Check, ChevronDown, RefreshCw, Search, TrendingUp, Play, Flame, Trash2, Zap, FileText, Users, Languages, MessageSquareText, BookMarked } from 'lucide-react';
import VideoCardClient from '@/components/video-card-client';
import Sidebar from '@/components/sidebar';
import LearningCalendar from '@/components/learning-calendar';
import AnnouncementModal from '@/components/announcement-modal';
import TodayRecommend from '@/components/today-recommend';
import DailySummary, { shouldShowDailySummary } from '@/components/daily-summary';
import { useAuth } from '@/lib/auth-context';
import { UserNav } from '@/components/user-nav';
import AdminUserPanel from '@/components/admin-user-panel';
import { VideoMeta, VideoCategory, DifficultyLevel, CATEGORY_LABELS, DIFFICULTY_LABELS, ALL_CATEGORIES, ALL_DIFFICULTIES } from '@/types/video';

interface HomeClientProps {
  videos: VideoMeta[];
}

export default function HomeClient({ videos: initialVideos }: HomeClientProps) {
  const [videos, setVideos] = useState(initialVideos);
  const [activeCategory, setActiveCategory] = useState<VideoCategory | null>(null);
  const [activeDifficulty, setActiveDifficulty] = useState<DifficultyLevel | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const { role, userCode } = useAuth();
  const router = useRouter();

  const [showTagDialog, setShowTagDialog] = useState(false);
  const [tagVideos, setTagVideos] = useState<VideoMeta[]>([]);
  const [taggingInProgress, setTaggingInProgress] = useState(false);
  const [taggingProgress, setTaggingProgress] = useState({ current: 0, total: 0 });
  const [taggingResults, setTaggingResults] = useState<Record<string, { category: string; difficulty: string; reason?: string }>>({});
  const [editingVideoId, setEditingVideoId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<VideoCategory | ''>('');
  const [editDifficulty, setEditDifficulty] = useState<DifficultyLevel | ''>('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [retagAll, setRetagAll] = useState(false);
  const [editError, setEditError] = useState('');
  const [popularVideos, setPopularVideos] = useState<Array<{
    id: string; title: string; thumbnail?: string;
    category?: string; difficulty?: string; viewCount: number;
  } | null>>([]);
  const [popularLoaded, setPopularLoaded] = useState(false);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [showProcessDialog, setShowProcessDialog] = useState(false);
  const [showUserPanel, setShowUserPanel] = useState(false);
  const [showAnnouncement, setShowAnnouncement] = useState(false);
  const [showDailySummary, setShowDailySummary] = useState(false);
  const [processRunning, setProcessRunning] = useState(false);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [processProgress, setProcessProgress] = useState<{
    status: string;
    total: number;
    current: number;
    currentVideoId: string;
    currentStep: string;
    results: Record<string, { step: string; status: string; message?: string }[]>;
    logs: string[];
  } | null>(null);

  const availableCategories = useMemo(() => {
    return Array.from(new Set(videos.map(v => v.category).filter(Boolean))) as VideoCategory[];
  }, [videos]);

  const availableDifficulties = useMemo(() => {
    return Array.from(new Set(videos.map(v => v.difficulty).filter(Boolean))) as DifficultyLevel[];
  }, [videos]);

  const filteredVideos = useMemo(() => {
    let result = videos;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(v =>
        v.title.toLowerCase().includes(q) ||
        (v.description && v.description.toLowerCase().includes(q)) ||
        (v.category && CATEGORY_LABELS[v.category].label.includes(q)) ||
        (v.difficulty && DIFFICULTY_LABELS[v.difficulty].label.includes(q))
      );
    }
    if (activeCategory) {
      result = result.filter(v => v.category === activeCategory);
    }
    if (activeDifficulty) {
      result = result.filter(v => v.difficulty === activeDifficulty);
    }
    return result;
  }, [videos, searchQuery, activeCategory, activeDifficulty]);

  const getAuthToken = useCallback(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('ve-session-token') || '';
  }, []);

  const handleDeleteVideo = useCallback(async () => {
    if (!deletingVideoId) return;
    setDeleting(true);
    const token = getAuthToken();
    try {
      const res = await fetch(`/api/videos/${deletingVideoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        setVideos(prev => prev.filter(v => v.id !== deletingVideoId));
        setShowDeleteConfirm(false);
        setDeletingVideoId(null);
      } else {
        const data = await res.json();
        alert(data.error || '删除失败');
      }
    } catch {
      alert('网络错误，请重试');
    }
    setDeleting(false);
  }, [deletingVideoId, getAuthToken]);

  const startProcessAll = useCallback(async (force = false, videoIds?: string[], step?: string) => {
    setProcessRunning(true);
    setShowProcessDialog(true);
    const token = getAuthToken();
    try {
      const res = await fetch('/api/process-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ force, videoIds, step }),
      });
      if (!res.ok) {
        const data = await res.json();
        alert(data.error || '启动处理失败');
        setProcessRunning(false);
        return;
      }
      pollProcessProgress();
    } catch {
      alert('网络错误，请重试');
      setProcessRunning(false);
    }
  }, [getAuthToken]);

  const pollProcessProgress = useCallback(() => {
    let elapsed = 0;
    const MAX_POLL_SECONDS = 3 * 60 * 60; // 最多轮询 3 小时
    const interval = setInterval(async () => {
      elapsed += 2;
      try {
        const token = getAuthToken();
        const res = await fetch('/api/process-all', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json();
        setProcessProgress({
          ...data,
          results: data.results || {},
          logs: data.logs || [],
        });
        if (data.status === 'completed' || data.status === 'error' || elapsed >= MAX_POLL_SECONDS) {
          setProcessRunning(false);
          clearInterval(interval);
          if (elapsed >= MAX_POLL_SECONDS) {
            setProcessProgress(prev => prev ? { ...prev, status: 'error', logs: [...(prev.logs || []), '[超时] 轮询超时，已自动停止'] } : prev);
          }
          router.refresh();
        }
      } catch {
        // 网络错误时继续轮询，除非超时
        if (elapsed >= MAX_POLL_SECONDS) {
          setProcessRunning(false);
          clearInterval(interval);
        }
      }
    }, 2000);
  }, [router, getAuthToken]);

  useEffect(() => {
    const token = getAuthToken();
    fetch('/api/videos/popular', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.json())
      .then(data => {
        if (data.videos?.length > 0) {
          setPopularVideos(data.videos.slice(0, 3));
        }
      })
      .catch(() => {})
      .finally(() => setPopularLoaded(true));
  }, []);

  useEffect(() => {
    if (!userCode) return;
    const hasSeenOnboarding = localStorage.getItem('ve-seen-onboarding');
    const dontShowToday = localStorage.getItem('ve-dont-show-announcement');
    if (dontShowToday === new Date().toISOString().slice(0, 10)) return;
    const timer = setTimeout(() => setShowAnnouncement(true), 800);
    return () => clearTimeout(timer);
  }, [userCode]);

  const openTagDialog = useCallback(() => {
    setTagVideos(videos.map(v => ({ ...v })));
    setTaggingResults({});
    setTaggingProgress({ current: 0, total: 0 });
    setTaggingInProgress(false);
    setEditingVideoId(null);
    setRetagAll(false);
    setShowTagDialog(true);
  }, [videos]);

  const handleBatchTag = useCallback(async () => {
    const targets = retagAll
      ? tagVideos
      : tagVideos.filter(v => !v.category || !v.difficulty);
    if (targets.length === 0) return;

    setTaggingInProgress(true);
    setTaggingProgress({ current: 0, total: targets.length });

    const token = getAuthToken();
    const newResults = { ...taggingResults };

    for (let i = 0; i < targets.length; i++) {
      const video = targets[i];
      try {
        const res = await fetch('/api/tag-video', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ videoId: video.id }),
        });
        if (res.status === 403) {
          newResults[video.id] = { category: '', difficulty: '', reason: '管理员验证失败，请刷新页面重新登录后重试' };
          setTaggingResults({ ...newResults });
          setTaggingInProgress(false);
          return;
        }
        const data = await res.json();
        if (res.ok) {
          newResults[video.id] = { category: data.category, difficulty: data.difficulty, reason: data.reason };
          setTagVideos(prev => prev.map(v =>
            v.id === video.id ? { ...v, category: data.category, difficulty: data.difficulty } : v
          ));
        } else {
          newResults[video.id] = { category: '', difficulty: '', reason: `标签失败: ${data.error}` };
        }
      } catch {
        newResults[video.id] = { category: '', difficulty: '', reason: '网络错误' };
      }
      setTaggingResults({ ...newResults });
      setTaggingProgress({ current: i + 1, total: targets.length });
    }

    setTaggingInProgress(false);
    setRetagAll(false);
  }, [tagVideos, taggingResults, getAuthToken, retagAll]);

  const startEditTag = useCallback((video: VideoMeta) => {
    setEditingVideoId(video.id);
    setEditCategory(video.category || '');
    setEditDifficulty(video.difficulty || '');
  }, []);

  const saveEditTag = useCallback(async () => {
    if (!editingVideoId || !editCategory || !editDifficulty) return;
    setSavingEdit(true);
    setEditError('');

    const token = getAuthToken();
    try {
      const res = await fetch('/api/update-tags', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ videoId: editingVideoId, category: editCategory, difficulty: editDifficulty }),
      });

      if (res.ok) {
        setTagVideos(prev => prev.map(v =>
          v.id === editingVideoId ? { ...v, category: editCategory, difficulty: editDifficulty } : v
        ));
        setEditingVideoId(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setEditError(data.error || '保存失败');
      }
    } catch {
      setEditError('网络错误，请重试');
    }

    setSavingEdit(false);
  }, [editingVideoId, editCategory, editDifficulty, getAuthToken]);

  return (
    <>
      <Sidebar
        categories={availableCategories}
        difficulties={availableDifficulties}
        activeCategory={activeCategory}
        activeDifficulty={activeDifficulty}
        onCategoryChange={setActiveCategory}
        onDifficultyChange={setActiveDifficulty}
      />

      <div className="pl-0 lg:pl-[240px] transition-all duration-300 overflow-x-hidden">
        <div className="min-h-screen bg-background text-foreground">
          <header className="py-6 sm:py-8 px-4 sm:px-6 border-b border-border">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="flex items-center gap-3 mb-1 sm:mb-2">
                  <BookOpen className="h-6 w-6 sm:h-8 sm:w-8" />
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">VibeEnglish</h1>
                </div>
                <p className="text-muted-foreground text-sm sm:text-lg">
                  通过 YouTube 视频沉浸式学习英语
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {userCode && role !== 'admin' && (
                  <button
                    onClick={() => setShowDailySummary(true)}
                    className="flex items-center justify-center h-9 px-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="今日学习总结"
                  >
                    📋 总结
                  </button>
                )}
                <LearningCalendar userCode={userCode} role={role} />
                <UserNav />
              </div>
            </div>
          </header>

          {userCode && role !== 'admin' && (
            <TodayRecommend videos={videos} userCode={userCode} />
          )}

          <main className="max-w-6xl mx-auto py-8 px-4 sm:px-6">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <div>
                <h2 className="text-xl font-semibold">学习资源</h2>
                {(searchQuery.trim() || activeCategory || activeDifficulty) && (
                  <p className="text-sm text-muted-foreground mt-1">
                    共 {filteredVideos.length} 个结果
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                {role === 'admin' && (
                  <>
                    <Link href="/dashboard" className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">数据</span>看板
                    </Link>
                    <Link href="/download" className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                      <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">批量</span>下载
                    </Link>
                    <button
                      onClick={openTagDialog}
                      className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Tags className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">批量</span>标签
                    </button>
                    <button
                      onClick={() => startProcessAll(false)}
                      className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">一键</span>处理
                    </button>
                    <button
                      onClick={() => setShowUserPanel(true)}
                      className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">用户</span>管理
                    </button>
                    <button
                      onClick={() => setShowAnnouncement(true)}
                      className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">修改</span>公告
                    </button>
                  </>
                )}
                <Link href="/vocab" className="flex items-center gap-1 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors">
                  <NotebookPen className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> 生词本
                </Link>
              </div>
            </div>

            <div className="relative mb-6">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="搜索视频标题、描述、分类..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 bg-muted border border-border rounded-xl text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-muted-foreground/10 transition-colors"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            <div className="mb-6">
              {(searchQuery.trim() || activeCategory || activeDifficulty) && (
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <span className="text-sm text-muted-foreground">当前筛选：</span>
                {searchQuery.trim() && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
                    <Search className="h-3 w-3" />
                    {searchQuery.trim()}
                    <button
                      onClick={() => setSearchQuery('')}
                      className="ml-1 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {activeCategory && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      color: CATEGORY_LABELS[activeCategory].color,
                      backgroundColor: `${CATEGORY_LABELS[activeCategory].color}15`,
                    }}
                  >
                    {CATEGORY_LABELS[activeCategory].icon} {CATEGORY_LABELS[activeCategory].label}
                    <button
                      onClick={() => setActiveCategory(null)}
                      className="ml-1 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                {activeDifficulty && (
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                    style={{
                      color: DIFFICULTY_LABELS[activeDifficulty].color,
                      backgroundColor: `${DIFFICULTY_LABELS[activeDifficulty].color}15`,
                    }}
                  >
                    {DIFFICULTY_LABELS[activeDifficulty].label}
                    <button
                      onClick={() => setActiveDifficulty(null)}
                      className="ml-1 hover:opacity-70"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                )}
                <button
                  onClick={() => { setSearchQuery(''); setActiveCategory(null); setActiveDifficulty(null); }}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors ml-1"
                >
                  清除全部
                </button>
              </div>
                )}
            </div>

            {popularLoaded && popularVideos.length > 0 && !searchQuery.trim() && !activeCategory && !activeDifficulty && (
              <section className="mb-8">
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/20">
                    <Flame className="h-4 w-4 text-orange-400" />
                  </div>
                  <h2 className="text-lg font-bold tracking-tight">热门推荐</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">基于观看数据</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {popularVideos.map((v) => v ? (
                    <div key={v.id} className="relative group/card">
                      <Link
                        href={`/${v.id}`}
                        className="block group"
                      >
                        <div className="bg-card rounded-xl overflow-hidden border border-border hover:border-white/20 transition-colors duration-300">
                          <div className="aspect-video bg-muted relative flex items-center justify-center overflow-hidden">
                            {v.thumbnail ? (
                              <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            ) : (
                              <Play className="h-10 w-10 text-muted-foreground/30" />
                            )}
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                                  <Play className="h-6 w-6 text-white ml-0.5" />
                                </div>
                              </div>
                            </div>
                            {v.difficulty && (
                              <div className="absolute top-2 right-2">
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                                  style={{ color: DIFFICULTY_LABELS[v.difficulty as DifficultyLevel].color, backgroundColor: `${DIFFICULTY_LABELS[v.difficulty as DifficultyLevel].bg}` }}
                                >{DIFFICULTY_LABELS[v.difficulty as DifficultyLevel].label}</span>
                              </div>
                            )}
                          </div>
                          <div className="p-4 pb-5 flex flex-col h-[96px]">
                            <h3 className="font-medium text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2 min-h-[2.8em]">{v.title}</h3>
                            <div className="mt-3 flex items-center gap-2 flex-wrap">
                              {v.category && (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                                  style={{
                                    color: CATEGORY_LABELS[v.category as VideoCategory]?.color,
                                    backgroundColor: `${CATEGORY_LABELS[v.category as VideoCategory]?.color}15`,
                                  }}
                                >
                                  {CATEGORY_LABELS[v.category as VideoCategory]?.icon || ''} {CATEGORY_LABELS[v.category as VideoCategory]?.label || v.category}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                      {role === 'admin' && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setDeletingVideoId(v.id);
                            setShowDeleteConfirm(true);
                          }}
                          className="absolute top-2 left-2 p-1.5 rounded-lg bg-red-500/80 text-white opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-red-600 z-10"
                          title="删除视频"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ) : null)}
                </div>
              </section>
            )}

            {filteredVideos.length === 0 ? (
              <div className="text-center py-24 border border-dashed border-border rounded-xl">
                <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground text-lg">
                  {videos.length === 0 ? '暂无学习资源' : '没有匹配的素材'}
                </p>
                {videos.length > 0 && (searchQuery.trim() || activeCategory || activeDifficulty) && (
                  <button
                    onClick={() => { setSearchQuery(''); setActiveCategory(null); setActiveDifficulty(null); }}
                    className="mt-3 text-sm text-primary hover:underline"
                  >
                    清除所有筛选
                  </button>
                )}
                {videos.length === 0 && role === 'admin' && (
                  <p className="text-muted-foreground/70 mt-2 text-sm">
                    运行 <code className="bg-muted px-2 py-0.5 rounded text-xs">python downloader.py</code> 下载 YouTube 视频开始学习
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2.5 mb-5">
                  <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/20">
                    <BookOpen className="h-4 w-4 text-blue-400" />
                  </div>
                  <h2 className="text-lg font-bold tracking-tight">全部视频</h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{filteredVideos.length} 个</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {filteredVideos.map((video) => (
                    <div key={video.id} className="relative group/card">
                      <VideoCardClient video={video} />
                      {role === 'admin' && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            setDeletingVideoId(video.id);
                            setShowDeleteConfirm(true);
                          }}
                          className="absolute top-2 left-2 p-1.5 rounded-lg bg-red-500/80 text-white opacity-0 group-hover/card:opacity-100 transition-opacity hover:bg-red-600 z-10"
                          title="删除视频"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </main>

          <footer className="py-6 px-4 border-t border-border mt-12">
            <div className="max-w-6xl mx-auto text-center text-muted-foreground text-sm">
              VibeEnglish — 让英语学习更沉浸
            </div>
          </footer>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-2">确认删除</h3>
            <p className="text-sm text-muted-foreground mb-6">
              确定要删除该视频吗？此操作将永久删除视频文件、字幕及相关数据，不可恢复。
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowDeleteConfirm(false); setDeletingVideoId(null); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                disabled={deleting}
              >
                取消
              </button>
              <button
                onClick={handleDeleteVideo}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleting ? '删除中...' : '确认删除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTagDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Tags className="h-5 w-5" /> 视频标签管理
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  {tagVideos.filter(v => v.category && v.difficulty).length}/{tagVideos.length} 个视频已标注
                </p>
              </div>
              <button
                onClick={() => { setShowTagDialog(false); router.refresh(); }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 border-b border-border flex items-center gap-4 flex-wrap">
              <button
                onClick={() => { setRetagAll(false); handleBatchTag(); }}
                disabled={taggingInProgress || tagVideos.filter(v => !v.category || !v.difficulty).length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {taggingInProgress && !retagAll ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> 标注中 {taggingProgress.current}/{taggingProgress.total}</>
                ) : (
                  <><Tags className="h-4 w-4" /> 一键标注未标签视频</>
                )}
              </button>
              <button
                onClick={() => { setRetagAll(true); handleBatchTag(); }}
                disabled={taggingInProgress}
                className="flex items-center gap-2 px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {taggingInProgress && retagAll ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> 重新标注中 {taggingProgress.current}/{taggingProgress.total}</>
                ) : (
                  <><RefreshCw className="h-4 w-4" /> 重新标注所有</>
                )}
              </button>
              {taggingInProgress && (
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${taggingProgress.total > 0 ? (taggingProgress.current / taggingProgress.total) * 100 : 0}%` }}
                  />
                </div>
              )}
              {!taggingInProgress && tagVideos.filter(v => !v.category || !v.difficulty).length === 0 && (
                <span className="text-sm text-green-500 flex items-center gap-1">
                  <Check className="h-4 w-4" /> 所有视频已标注
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-3">
                {tagVideos.map((video) => {
                  const result = taggingResults[video.id];
                  const isEditing = editingVideoId === video.id;

                  return (
                    <div
                      key={video.id}
                      className="flex items-center gap-4 p-4 rounded-xl border border-border hover:border-white/10 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{video.title}</p>
                        {result?.reason && (
                          <p className="text-xs text-muted-foreground mt-1">{result.reason}</p>
                        )}
                      </div>

                      {isEditing ? (
                        <>
                          <div className="flex items-center gap-2">
                            <div className="relative">
                              <select
                                value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value as VideoCategory)}
                                className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                              >
                                <option value="">分类</option>
                                {ALL_CATEGORIES.map(c => (
                                  <option key={c} value={c}>{CATEGORY_LABELS[c].icon} {CATEGORY_LABELS[c].label}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                            </div>
                            <div className="relative">
                              <select
                                value={editDifficulty}
                                onChange={(e) => setEditDifficulty(e.target.value as DifficultyLevel)}
                                className="appearance-none pl-3 pr-8 py-1.5 rounded-lg border border-border bg-background text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
                              >
                                <option value="">难度</option>
                                {ALL_DIFFICULTIES.map(d => (
                                  <option key={d} value={d}>{DIFFICULTY_LABELS[d].label}</option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                            </div>
                            <button
                              onClick={saveEditTag}
                              disabled={savingEdit || !editCategory || !editDifficulty}
                              className="p-1.5 text-green-500 hover:bg-green-500/10 rounded-lg disabled:opacity-50 transition-colors"
                            >
                              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => { setEditingVideoId(null); setEditError(''); }}
                              className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg transition-colors"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          {editError && (
                            <p className="text-xs text-red-500 mt-1">{editError}</p>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          {video.category ? (
                            <span
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                              style={{
                                color: CATEGORY_LABELS[video.category].color,
                                backgroundColor: `${CATEGORY_LABELS[video.category].color}15`,
                              }}
                            >
                              {CATEGORY_LABELS[video.category].icon} {CATEGORY_LABELS[video.category].label}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                              未分类
                            </span>
                          )}
                          {video.difficulty ? (
                            <span
                              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                              style={{
                                color: DIFFICULTY_LABELS[video.difficulty].color,
                                backgroundColor: DIFFICULTY_LABELS[video.difficulty].bg,
                              }}
                            >
                              {DIFFICULTY_LABELS[video.difficulty].label}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                              未评级
                            </span>
                          )}
                          <button
                            onClick={() => startEditTag(video)}
                            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors text-xs"
                          >
                            编辑
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {showProcessDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-500" /> 一键处理
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  自动为视频执行：标签分类 → 字幕翻译 → 题库生成
                </p>
              </div>
              <button
                onClick={() => { setShowProcessDialog(false); router.refresh(); }}
                className="p-2 hover:bg-muted rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 border-b border-border space-y-4">
              <p className="text-sm text-muted-foreground">选择要执行的 AI 处理功能：</p>
              <div className="grid grid-cols-2 gap-3">
                {/* 标签分类 */}
                <button
                  onClick={() => startProcessAll(false, undefined, 'tag')}
                  disabled={processRunning}
                  className="flex items-center gap-3 px-4 py-3 border border-border rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                >
                  <Tags className="h-5 w-5 text-indigo-500 shrink-0" />
                  <div>
                    <div>标签分类</div>
                    <div className="text-xs text-muted-foreground font-normal">场景分类 + 难度等级</div>
                  </div>
                </button>
                {/* 字幕翻译 */}
                <button
                  onClick={() => startProcessAll(false, undefined, 'translate')}
                  disabled={processRunning}
                  className="flex items-center gap-3 px-4 py-3 border border-border rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                >
                  <Languages className="h-5 w-5 text-blue-500 shrink-0" />
                  <div>
                    <div>字幕翻译</div>
                    <div className="text-xs text-muted-foreground font-normal">英文字幕 → 中文字幕</div>
                  </div>
                </button>
                {/* 题库生成 */}
                <button
                  onClick={() => startProcessAll(false, undefined, 'quiz')}
                  disabled={processRunning}
                  className="flex items-center gap-3 px-4 py-3 border border-border rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                >
                  <MessageSquareText className="h-5 w-5 text-amber-500 shrink-0" />
                  <div>
                    <div>题库生成</div>
                    <div className="text-xs text-muted-foreground font-normal">选择题 + 口语题</div>
                  </div>
                </button>
                {/* 单词分类 */}
                <button
                  onClick={async () => {
                    setProcessRunning(true);
                    setShowProcessDialog(true);
                    const token = getAuthToken();
                    try {
                      const res = await fetch('/api/vocab/bank/build', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                          'Authorization': `Bearer ${token}`,
                        },
                        body: JSON.stringify({ force: true }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        alert(data.error || '构建失败');
                      } else {
                        setProcessProgress({
                          status: 'completed',
                          total: data.totalWords || 0,
                          current: data.totalWords || 0,
                          currentVideoId: '',
                          currentStep: '单词分类',
                          results: {},
                          logs: [`词汇库构建完成：${data.totalWords} 个单词`],
                        });
                      }
                    } catch {
                      alert('网络错误');
                    }
                    setProcessRunning(false);
                  }}
                  disabled={processRunning}
                  className="flex items-center gap-3 px-4 py-3 border border-border rounded-xl text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-left"
                >
                  <BookMarked className="h-5 w-5 text-green-500 shrink-0" />
                  <div>
                    <div>单词分类</div>
                    <div className="text-xs text-muted-foreground font-normal">全局词汇库构建</div>
                  </div>
                </button>
              </div>

              {/* 强制重做 + 选中视频翻译 */}
              <div className="flex items-center gap-3 flex-wrap pt-2 border-t border-border">
                <button
                  onClick={() => startProcessAll(true, undefined, 'all')}
                  disabled={processRunning}
                  className="flex items-center gap-2 px-3 py-1.5 border border-border text-foreground rounded-lg text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> 强制重做全部
                </button>
                <button
                  onClick={() => {
                    if (selectedVideoIds.size === 0) return;
                    startProcessAll(true, Array.from(selectedVideoIds), 'translate');
                  }}
                  disabled={processRunning || selectedVideoIds.size === 0}
                  className="flex items-center gap-2 px-3 py-1.5 border border-blue-500/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Languages className="h-3.5 w-3.5" />
                  重新翻译选中 ({selectedVideoIds.size})
                </button>
                {processProgress && processProgress.status === 'running' && (
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${processProgress.total > 0 ? (processProgress.current / processProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="border border-border rounded-lg max-h-32 overflow-y-auto">
                <div className="sticky top-0 bg-card px-3 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">选择视频重新翻译</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedVideoIds(new Set(videos.map(v => v.id)))}
                      className="text-xs text-primary hover:underline"
                    >全选</button>
                    <button
                      onClick={() => setSelectedVideoIds(new Set())}
                      className="text-xs text-muted-foreground hover:underline"
                    >清空</button>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {videos.map(v => {
                    const checked = selectedVideoIds.has(v.id);
                    return (
                      <label
                        key={v.id}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors ${checked ? 'bg-blue-500/5' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = new Set(selectedVideoIds);
                            if (checked) { next.delete(v.id); } else { next.add(v.id); }
                            setSelectedVideoIds(next);
                          }}
                          className="rounded border-border"
                        />
                        <span className="text-sm truncate flex-1">{v.title || v.id}</span>
                        {v.category && (
                          <span className="text-xs text-muted-foreground shrink-0">{CATEGORY_LABELS[v.category as VideoCategory]?.label || v.category}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {processProgress && processProgress.status !== 'idle' ? (
                <div className="space-y-4">
                  {processProgress.status === 'running' && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20">
                      <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          正在处理 {processProgress.current}/{processProgress.total}：{processProgress.currentStep}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          视频：{processProgress.currentVideoId}
                        </p>
                      </div>
                      <button
                        onClick={() => { setProcessRunning(false); setProcessProgress(prev => prev ? { ...prev, status: 'error' } : prev); }}
                        className="shrink-0 px-2 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  )}

                  {processProgress.status === 'completed' && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/20">
                      <Check className="h-5 w-5 text-green-500" />
                      <p className="text-sm font-medium text-green-600 dark:text-green-400">
                        全部处理完成！共处理 {processProgress.total} 个视频
                      </p>
                    </div>
                  )}

                  {processProgress.status === 'error' && (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20">
                      <X className="h-5 w-5 text-red-500" />
                      <p className="text-sm font-medium text-red-500">处理出错，请查看日志</p>
                    </div>
                  )}

                  {processProgress.results && Object.entries(processProgress.results).length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">处理结果</h3>
                      {Object.entries(processProgress.results).map(([videoId, steps]) => (
                        <div key={videoId} className="p-3 rounded-lg border border-border">
                          <p className="text-sm font-medium mb-2">{videoId}</p>
                          <div className="flex flex-wrap gap-2">
                            {steps.map((step, idx) => (
                              <span
                                key={idx}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                                  step.status === 'done'
                                    ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                                    : step.status === 'skipped'
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-red-500/15 text-red-500'
                                }`}
                              >
                                {step.status === 'done' && <Check className="h-3 w-3" />}
                                {step.status === 'skipped' && '—'}
                                {step.status === 'error' && <X className="h-3 w-3" />}
                                {step.step}
                                {step.message && <span className="opacity-70">· {step.message}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {processProgress.logs && processProgress.logs.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-xs text-muted-foreground font-semibold">处理日志 ({processProgress.logs.length})</h3>
                      <div className="bg-muted rounded-lg p-3 max-h-[500px] overflow-y-auto text-xs font-mono space-y-1">
                        {processProgress.logs.slice(-100).map((log, i) => (
                          <div key={i} className={`whitespace-pre-wrap break-all ${
                            log.includes('错误') ? 'text-red-500' :
                            log.includes('完成') || log.includes('done') ? 'text-green-600 dark:text-green-400' :
                            'text-muted-foreground'
                          }`}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Zap className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">点击上方按钮选择要执行的功能</p>
                  <p className="text-xs mt-1">标签分类、字幕翻译、题库生成、单词分类</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AdminUserPanel open={showUserPanel} onClose={() => setShowUserPanel(false)} />

      <AnnouncementModal
        isOpen={showAnnouncement}
        onClose={() => setShowAnnouncement(false)}
        isAdmin={role === 'admin'}
        adminEdit={role === 'admin'}
      />

      {userCode && role !== 'admin' && (
        <DailySummary
          open={showDailySummary}
          onClose={() => setShowDailySummary(false)}
          userCode={userCode}
        />
      )}
    </>
  );
}
