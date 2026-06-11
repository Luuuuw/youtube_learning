'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ChevronLeft, Settings, HelpCircle, Ear, EarOff, X, Keyboard, Zap, BookOpen, MessageSquare, Lightbulb, User, Brain, Mic } from 'lucide-react';
import VideoPlayer from './video-player';
import SubtitlePanel from './subtitle-panel';
import ThemeToggle from './theme-toggle';
import VideoQuiz from './video-quiz';
import ShadowSpeak from './shadow-speak';
import { Subtitle } from '@/lib/vtt-parser';
import { useAuth } from '@/lib/auth-context';
import { binarySearchSubtitleIndex, getSubtitleAtTime, buildSubtitleTranslationMap, getActiveWordIndex } from '@/lib/subtitle-sync';
import { classifyWord } from '@/lib/word-classify';

interface VideoLearningPageProps {
  id: string;
  title: string;
  description?: string;
  videoUrl: string;
  subtitles: Subtitle[];
  zhSubtitles: Subtitle[];
  zhNeedsRetranslate?: boolean;
}

export default function VideoLearningPage({
  id,
  title,
  description,
  videoUrl,
  subtitles,
  zhSubtitles: initialZhSubtitles,
  zhNeedsRetranslate,
}: VideoLearningPageProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [blindMode, setBlindMode] = useState(false);
  const [zhSubtitles, setZhSubtitles] = useState(initialZhSubtitles);

  // Build zh translation map (same logic as SubtitlePanel)
  const subtitleZhMap = useMemo(() => buildSubtitleTranslationMap(subtitles, zhSubtitles), [subtitles, zhSubtitles]);

  const getZhText = useCallback((sub: Subtitle): string | null => {
    if (sub.translation) return sub.translation;
    return subtitleZhMap.get(sub.id) ?? null;
  }, [subtitleZhMap]);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightWords, setHighlightWords] = useState(true);
  const [defaultSpeed, setDefaultSpeed] = useState(1);
  const [quizOpen, setQuizOpen] = useState(false);
  const [shadowSpeakOpen, setShadowSpeakOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const lastSubtitleSyncAtRef = useRef(0);
  const activeSubtitleIndexRef = useRef(-1);
  const wasPlayingBeforeHelpRef = useRef(false);
  const { role, userCode } = useAuth();
  const isAdmin = role === 'admin';

  useEffect(() => {
    if (userCode && id) {
      const token = localStorage.getItem('ve-session-token');
      if (token) {
        fetch('/api/activity/record', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ videoId: id }),
        })
          .then(() => {
            window.dispatchEvent(new CustomEvent('ve-activity-recorded'));
          })
          .catch(() => {});
      }
    }
  }, [userCode, id]);

  // 后台翻译轮询：每隔 10s 拉一次翻译状态，翻译完成自动刷新
  const [translating, setTranslating] = useState(
    initialZhSubtitles.length === 0 || !!zhNeedsRetranslate
  );
  useEffect(() => {
    if (initialZhSubtitles.length > 0 && !zhNeedsRetranslate) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/translate-subtitles?videoId=${encodeURIComponent(id)}&check=1`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('ve-session-token') || ''}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.done) {
            // 拉取最新字幕
            const r2 = await fetch(`/api/videos/${id}`, {
              headers: { Authorization: `Bearer ${localStorage.getItem('ve-session-token') || ''}` },
            });
            if (r2.ok) {
              const v = await r2.json();
              if (Array.isArray(v.zhSubtitles) && v.zhSubtitles.length > 0) {
                setZhSubtitles(v.zhSubtitles);
                setTranslating(false);
                return;
              }
            }
          }
        }
      } catch {}
      if (!cancelled) setTimeout(poll, 10000);
    };
    const t = setTimeout(poll, 10000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [id, initialZhSubtitles.length, zhNeedsRetranslate]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('vibe-settings');
      if (saved) {
        const s = JSON.parse(saved);
        if (s.autoScroll !== undefined) setAutoScroll(s.autoScroll);
        if (s.highlightWords !== undefined) setHighlightWords(s.highlightWords);
        if (s.defaultSpeed !== undefined) setDefaultSpeed(s.defaultSpeed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('vibe-settings', JSON.stringify({ autoScroll, highlightWords, defaultSpeed }));
    } catch {}
  }, [autoScroll, highlightWords, defaultSpeed]);

  useEffect(() => {
    if (defaultSpeed !== 1 && videoRef.current) {
      videoRef.current.playbackRate = defaultSpeed;
    }
  }, [defaultSpeed]);

  useEffect(() => {
    if (showHelp && videoRef.current) {
      wasPlayingBeforeHelpRef.current = !videoRef.current.paused;
      videoRef.current.pause();
    }
    if (!showHelp && videoRef.current && wasPlayingBeforeHelpRef.current) {
      videoRef.current.play().catch(() => {});
      wasPlayingBeforeHelpRef.current = false;
    }
  }, [showHelp]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false);
      }
    };
    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSettings]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (quizOpen || showHelp || shadowSpeakOpen) return;
      const video = videoRef.current;
      if (!video) return;

      switch (e.key) {
        case 'Escape':
          setShowHelp(false);
          setShowSettings(false);
          break;
        case ' ':
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
          break;
        case 'm':
        case 'M':
          video.muted = !video.muted;
          break;
        case 'f':
        case 'F': {
          const container = video.parentElement?.parentElement;
          if (container) {
            if (document.fullscreenElement) document.exitFullscreen();
            else container.requestFullscreen();
          }
          break;
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [videoRef, quizOpen, showHelp, shadowSpeakOpen]);

  const handleTimeUpdate = useCallback((t: number) => {
    const nextActiveIndex = binarySearchSubtitleIndex(subtitles, t);
    const indexChanged = nextActiveIndex !== activeSubtitleIndexRef.current;

    if (indexChanged) {
      activeSubtitleIndexRef.current = nextActiveIndex;
      lastSubtitleSyncAtRef.current = Date.now();
      setCurrentTime(t);
      return;
    }

    const now = Date.now();
    if (now - lastSubtitleSyncAtRef.current >= 200) {
      lastSubtitleSyncAtRef.current = now;
      setCurrentTime(t);
    }
  }, [subtitles]);

  const handleSeek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    activeSubtitleIndexRef.current = binarySearchSubtitleIndex(subtitles, time);
    lastSubtitleSyncAtRef.current = Date.now();
    setCurrentTime(time);
  }, [subtitles]);

  return (
    <div className="h-[100dvh] flex flex-col bg-background text-foreground overflow-hidden">
      <header className="py-2 px-3 sm:px-4 border-b border-border bg-background/95 backdrop-blur-sm z-40 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ChevronLeft className="h-5 w-5" />
            <span className="font-bold text-foreground hidden sm:inline">VibeEnglish</span>
          </Link>
          <h1 className="text-xs sm:text-sm font-medium text-muted-foreground truncate flex-1 text-center min-w-0 px-2">
            {title}
          </h1>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setBlindMode(!blindMode)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                blindMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title={blindMode ? '退出盲听模式' : '进入盲听模式'}
            >
              {blindMode ? <EarOff className="h-3.5 w-3.5" /> : <Ear className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{blindMode ? '盲听中' : '盲听'}</span>
            </button>
            <button
              onClick={() => setQuizOpen(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                quizOpen
                  ? 'bg-blue-500 text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="视频测试"
            >
              <Brain className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">测试</span>
            </button>
            <button
              onClick={() => setShadowSpeakOpen(true)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                shadowSpeakOpen
                  ? 'bg-violet-500 text-white'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="影子跟读"
            >
              <Mic className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">跟读</span>
            </button>
            {role !== 'admin' && (
              <Link href="/profile" className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors" title="个人主页">
                <User className="h-3.5 w-3.5" />
              </Link>
            )}
            <ThemeToggle />
            <div ref={settingsRef} className="relative hidden sm:block">
              <button
                onClick={() => { setShowSettings(!showSettings); setShowHelp(false); }}
                className={`text-muted-foreground hover:text-foreground transition-colors ${showSettings ? 'text-foreground' : ''}`}
                title="设置"
              >
                <Settings className="h-4 w-4" />
              </button>
              {showSettings && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-popover border border-border rounded-lg shadow-xl z-50 py-2">
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">播放设置</div>
                  <div className="px-3 py-2 flex items-center justify-between">
                    <span className="text-sm">默认倍速</span>
                    <div className="flex items-center gap-0.5">
                      {[0.8, 1.0, 1.25, 1.5, 2.0].map(r => (
                        <button
                          key={r}
                          onClick={() => setDefaultSpeed(r)}
                          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                            defaultSpeed === r ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          {r}x
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border-t border-border my-1" />
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">字幕设置</div>
                  <button
                    onClick={() => setAutoScroll(!autoScroll)}
                    className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-muted transition-colors"
                  >
                    <span>自动滚动</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${autoScroll ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                      {autoScroll ? '开' : '关'}
                    </span>
                  </button>
                  <button
                    onClick={() => setHighlightWords(!highlightWords)}
                    className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-muted transition-colors"
                  >
                    <span>词性高亮</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${highlightWords ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'}`}>
                      {highlightWords ? '开' : '关'}
                    </span>
                  </button>
                  <div className="border-t border-border my-1" />
                  <Link
                    href="/vocab"
                    className="w-full px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    生词本
                  </Link>
                </div>
              )}
            </div>
            <button
              onClick={() => { setShowHelp(!showHelp); setShowSettings(false); }}
              className={`text-muted-foreground hover:text-foreground transition-colors hidden sm:block ${showHelp ? 'text-foreground' : ''}`}
              title="帮助"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {showHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowHelp(false)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-lg font-semibold">使用帮助</h2>
              <button onClick={() => setShowHelp(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-5">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Keyboard className="h-4 w-4 text-primary" />
                  <h3 className="font-medium text-sm">快捷键</h3>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <div className="flex justify-between"><span>播放 / 暂停</span><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Space</kbd></div>
                  <div className="flex justify-between"><span>后退 10 秒</span><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">←</kbd></div>
                  <div className="flex justify-between"><span>前进 10 秒</span><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">→</kbd></div>
                  <div className="flex justify-between"><span>静音切换</span><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">M</kbd></div>
                  <div className="flex justify-between"><span>全屏</span><kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">F</kbd></div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-amber-500" />
                  <h3 className="font-medium text-sm">查词与生词本</h3>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p>• 悬停或点击字幕中的<strong className="text-foreground">单词</strong>即可查看释义</p>
                  <p>• 点击「加入生词本」将单词保存，方便后续复习</p>
                  <p>• 高亮颜色的单词为重点词汇：🟢动词 🔵名词 🟡形容词 🟣副词</p>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MessageSquare className="h-4 w-4 text-blue-500" />
                  <h3 className="font-medium text-sm">字幕功能</h3>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p>• 点击「中文」按钮切换中文翻译显示</p>
                  <p>• 点击「翻译字幕」使用 AI 翻译英文字幕</p>
                  <p>• 点击任意字幕行可跳转到对应时间点</p>
                  <p>• 点击「回到当前」恢复自动滚动到当前播放位置</p>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Lightbulb className="h-4 w-4 text-yellow-500" />
                  <h3 className="font-medium text-sm">学习技巧</h3>
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  <p>• 开启「盲听模式」锻炼听力，不看字幕理解内容</p>
                  <p>• 调整播放倍速，0.8x 适合精听，1.5x 适合泛听</p>
                  <p>• 在生词本中使用「今日复习」巩固记忆</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-0 lg:gap-4 overflow-hidden px-2 sm:px-4 py-2 sm:py-4">
        <div className={`shrink-0 transition-all duration-500 ${blindMode ? 'lg:flex-none lg:max-w-[1200px] mx-auto' : 'lg:flex-[3]'}`}>
          <VideoPlayer
            videoUrl={videoUrl}
            subtitles={subtitles}
            onTimeUpdate={handleTimeUpdate}
            onSeek={handleSeek}
            videoRef={videoRef}
            blindMode={blindMode}
          />
          <div className="mt-1 sm:mt-3 px-1 hidden sm:block">
            {(() => {
              const currentSub = getSubtitleAtTime(subtitles, currentTime);
              if (!currentSub) {
                return <p className="text-sm text-muted-foreground italic">等待播放...</p>;
              }
              const zhText = getZhText(currentSub);
              const activeWordIdx = getActiveWordIndex(
                currentSub.text, currentTime, currentSub.startTime, currentSub.endTime, currentSub.wordTimings
              );
              // Render words with green-follow effect
              const parts = currentSub.text.split(/(\s+)/);
              let wordCounter = 0;
              const wordElements = parts.map((part, i) => {
                if (!part.trim()) return <span key={i}>{part}</span>;
                const cls = classifyWord(part);
                const currentWordIdx = wordCounter++;
                const isCurrentWord = currentWordIdx === activeWordIdx;
                const className = isCurrentWord
                  ? 'bg-green-400/25 text-green-700 dark:text-green-300 rounded px-0.5 ring-2 ring-green-500/70 shadow-[0_0_6px_rgba(34,197,94,0.25)] transition-all duration-75'
                  : cls.isKeyVocab
                    ? `${cls.bgColor} ${cls.color} rounded px-0.5 transition-colors`
                    : 'px-0.5 rounded transition-colors';
                return <span key={i} className={className}>{part}</span>;
              });
              return (
                <div className="bg-muted/50 rounded-lg px-4 py-3 space-y-1.5">
                  <p className="text-base font-medium leading-relaxed">{wordElements}</p>
                  {zhText && (
                    <p className="text-sm text-muted-foreground">{zhText}</p>
                  )}
                  {!zhText && translating && (
                    <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      中文字幕后台翻译中，完成后自动出现
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {!blindMode && (
          <div className="lg:flex-[2] min-w-0 flex-1 min-h-0 overflow-hidden">
            <SubtitlePanel
              subtitles={subtitles}
              zhSubtitles={zhSubtitles}
              currentTime={currentTime}
              onSeek={handleSeek}
              videoId={id}
              videoTitle={title}
              onZhSubtitlesUpdate={setZhSubtitles}
              autoScroll={autoScroll}
              highlightWords={highlightWords}
              isAdmin={isAdmin}
              videoRef={videoRef}
            />
          </div>
        )}
      </div>

      <VideoQuiz
        open={quizOpen}
        onClose={() => setQuizOpen(false)}
        videoId={id}
        videoTitle={title}
        videoUrl={videoUrl}
        subtitles={subtitles.map(s => ({ id: s.id, text: s.text, startTime: s.startTime, endTime: s.endTime }))}
        videoRef={videoRef}
      />

      <ShadowSpeak
        open={shadowSpeakOpen}
        onClose={() => setShadowSpeakOpen(false)}
        subtitles={subtitles}
        videoRef={videoRef}
        videoUrl={videoUrl}
        videoId={id}
        isAdmin={isAdmin}
      />
    </div>
  );
}
