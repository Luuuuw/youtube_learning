'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  X, Mic, MicOff, RotateCcw, ChevronRight, ChevronLeft,
  Check, XCircle, AlertTriangle, ChevronDown,
  Play, Pause, Gauge, Lightbulb, Loader2, Sparkles,
  Target, Wind, ListChecks, Search, Repeat, XSquare,
} from 'lucide-react';
import { Subtitle } from '@/lib/vtt-parser';
import { compareTranscript, getScoreLabel, ShadowResult } from '@/lib/shadow-speak';

type Phase = 'idle' | 'listening' | 'result';

interface ShadowAnalysis {
  level: string;
  levelLabel: string;
  speed: { wpm: number; label: string; tip: string };
  connectedSpeech: { words: string; type: string; description: string }[];
  stress: { word: string; reason: string }[];
  swallowed: { word: string; description: string }[];
  tips: string[];
}

interface AiScore {
  accuracy: number;
  fluency: number;
  completeness: number;
  tip: string;
}

interface ShadowSpeakProps {
  open: boolean;
  onClose: () => void;
  subtitles: Subtitle[];
  videoRef?: React.RefObject<HTMLVideoElement>;
  videoUrl: string;
  videoId?: string;
  isAdmin?: boolean;
}

function ClipPlayer({
  src,
  start,
  end,
  playbackRate,
  onTimeUpdate,
  onClipEnd,
  loopRange,
}: {
  src: string;
  start: number;
  end: number;
  playbackRate: number;
  onTimeUpdate?: (time: number) => void;
  onClipEnd?: () => void;
  loopRange?: { start: number; end: number } | null;
}) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const duration = Math.max(end - start, 0.1);
  const effectiveEnd = loopRange ? loopRange.end : end;
  const effectiveStart = loopRange ? loopRange.start : start;

  const togglePlay = useCallback(() => {
    const v = vidRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      setPlaying(false);
    } else {
      if (v.currentTime < effectiveStart || v.currentTime >= effectiveEnd) v.currentTime = effectiveStart;
      v.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [playing, effectiveStart, effectiveEnd]);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    v.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = start;
    setPlaying(false);
    setCurTime(0);
  }, [start, end]);

  useEffect(() => {
    const v = vidRef.current;
    if (!v) return;
    let rafId: number;
    const tick = () => {
      if (v && !v.paused) {
        const t = v.currentTime;
        setCurTime(t - start);
        onTimeUpdate?.(t);
        if (t >= effectiveEnd && playing) {
          if (loopRange) {
            v.currentTime = loopRange.start;
          } else {
            v.pause();
            setPlaying(false);
            onClipEnd?.();
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [start, end, playing, onTimeUpdate, onClipEnd, loopRange, effectiveEnd]);

  const seekTo = (ratio: number) => {
    const v = vidRef.current;
    if (!v) return;
    v.currentTime = start + ratio * (end - start);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(Math.max(s, 0) % 60).toFixed(0).padStart(2, '0')}`;

  return (
    <div className="rounded-xl overflow-hidden bg-black ring-1 ring-white/10">
      <div className="relative w-full aspect-video">
        <video
          ref={vidRef}
          src={src}
          className="absolute inset-0 w-full h-full object-cover"
          preload="metadata"
          playsInline
        />
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
          onClick={togglePlay}
        >
          {playing ? (
            <Pause className="h-10 w-10 text-white drop-shadow-lg" />
          ) : (
            <Play className="h-10 w-10 text-white ml-1 drop-shadow-lg" />
          )}
        </div>
      </div>
      <div className="px-3 py-2 flex items-center gap-2 bg-zinc-900">
        <button onClick={togglePlay} className="shrink-0 p-1 rounded hover:bg-white/10 transition-colors">
          {playing ? <Pause className="h-3.5 w-3.5 text-zinc-300" /> : <Play className="h-3.5 w-3.5 text-zinc-300" />}
        </button>
        <span className="text-[10px] text-zinc-400 tabular-nums shrink-0 min-w-[30px]">{fmt(curTime)}</span>
        <div
          className="flex-1 h-1 bg-zinc-700 rounded-full cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo((e.clientX - rect.left) / rect.width);
          }}
        >
          <div
            className="h-full bg-violet-500 rounded-full transition-all group-hover:bg-violet-400"
            style={{ width: `${Math.min(Math.max(curTime / duration, 0), 1) * 100}%` }}
          />
        </div>
        <span className="text-[10px] text-zinc-400 tabular-nums shrink-0 min-w-[30px]">{fmt(duration)}</span>
      </div>
    </div>
  );
}

function ScoreBar({ label, score, icon, color }: { label: string; score: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="text-sm font-bold tabular-nums">{score}</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${color}`}
            style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function SegmentTimeline({
  subtitles,
  currentIndex,
  onSelect,
  totalDuration,
}: {
  subtitles: Subtitle[];
  currentIndex: number;
  onSelect: (index: number) => void;
  totalDuration: number;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showList, setShowList] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return subtitles.map((s, i) => ({ ...s, index: i }));
    const q = searchQuery.toLowerCase();
    return subtitles
      .map((s, i) => ({ ...s, index: i }))
      .filter(s => s.text.toLowerCase().includes(q));
  }, [subtitles, searchQuery]);

  useEffect(() => {
    if (showList && listRef.current) {
      const active = listRef.current.querySelector('[data-active="true"]');
      if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [showList, currentIndex]);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const handleSelect = (index: number) => {
    onSelect(index);
    setShowList(false);
    setSearchQuery('');
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowList(true); }}
            onFocus={() => setShowList(true)}
            placeholder="搜索语段..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-muted/50 border border-border/60 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-500/50 placeholder:text-muted-foreground/60"
          />
        </div>
        <button
          onClick={() => setShowList(!showList)}
          className={`shrink-0 p-1.5 rounded-lg transition-colors ${showList ? 'bg-violet-500/10 text-violet-500' : 'hover:bg-muted text-muted-foreground'}`}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showList ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Mini timeline */}
      <div className="relative h-6 bg-muted/30 rounded-lg overflow-hidden mb-2 cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          const targetTime = ratio * totalDuration;
          let closestIdx = 0;
          let closestDist = Infinity;
          subtitles.forEach((s, i) => {
            const mid = (s.startTime + s.endTime) / 2;
            const dist = Math.abs(mid - targetTime);
            if (dist < closestDist) { closestDist = dist; closestIdx = i; }
          });
          handleSelect(closestIdx);
        }}
      >
        {subtitles.map((s, i) => {
          const left = (s.startTime / totalDuration) * 100;
          const width = Math.max(((s.endTime - s.startTime) / totalDuration) * 100, 0.3);
          const isCurrent = i === currentIndex;
          const hasResult = false;
          return (
            <div
              key={i}
              className={`absolute top-1 bottom-1 rounded-sm transition-all ${
                isCurrent
                  ? 'bg-violet-500 shadow-sm shadow-violet-500/50'
                  : 'bg-muted-foreground/20 hover:bg-muted-foreground/40'
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${fmtTime(s.startTime)} ${s.text}`}
            />
          );
        })}
        {subtitles[currentIndex] && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 -translate-x-1/2 pointer-events-none"
            style={{ left: `${((subtitles[currentIndex].startTime + subtitles[currentIndex].endTime) / 2 / totalDuration) * 100}%` }}
          />
        )}
      </div>

      {/* Segment list */}
      {showList && (
        <div
          ref={listRef}
          className="max-h-[180px] overflow-y-auto rounded-lg border border-border/60 bg-background"
        >
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground text-center">未找到匹配语段</div>
          )}
          {filtered.map((s) => (
            <button
              key={s.index}
              data-active={s.index === currentIndex}
              onClick={() => handleSelect(s.index)}
              className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                s.index === currentIndex
                  ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                  : 'hover:bg-muted/50'
              }`}
            >
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums mt-0.5 min-w-[32px]">
                {fmtTime(s.startTime)}
              </span>
              <span className={`text-xs leading-relaxed line-clamp-2 ${s.index === currentIndex ? 'font-medium' : ''}`}>
                {s.text}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ShadowSpeak({
  open,
  onClose,
  subtitles,
  videoRef,
  videoUrl,
  videoId = '',
  isAdmin = false,
}: ShadowSpeakProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<ShadowResult | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [resultMap, setResultMap] = useState<Map<number, ShadowResult>>(new Map());
  const [micError, setMicError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [autoPause, setAutoPause] = useState(true);
  const [analysis, setAnalysis] = useState<ShadowAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [clipCurrentTime, setClipCurrentTime] = useState(0);
  const [selectedWordRange, setSelectedWordRange] = useState<[number, number] | null>(null);
  const [loopPlaying, setLoopPlaying] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [aiScore, setAiScore] = useState<AiScore | null>(null);
  const [aiScoreLoading, setAiScoreLoading] = useState(false);

  const recognitionRef = useRef<null | {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: (event: unknown) => void;
    onerror: (event: unknown) => void;
    onend: () => void;
    start: () => void;
    stop: () => void;
  }>(null);
  const wasPlayingRef = useRef(false);
  const transcriptRef = useRef('');
  const finishRef = useRef<(text: string) => void>(() => {});
  const allAnalysisRef = useRef<Record<string, ShadowAnalysis>>({});
  const speakStartRef = useRef<number>(0);

  const currentSub = subtitles[currentIndex];
  const hasSubtitles = subtitles.length > 0;
  const totalDuration = hasSubtitles ? subtitles[subtitles.length - 1].endTime : 0;

  const wordTimeRange = useCallback((wordIdx: number): { start: number; end: number } | null => {
    if (!currentSub) return null;
    const words = currentSub.text.split(/\s+/).filter(Boolean);
    if (wordIdx < 0 || wordIdx >= words.length) return null;
    const segDuration = currentSub.endTime - currentSub.startTime;
    const perWord = segDuration / words.length;
    return {
      start: currentSub.startTime + wordIdx * perWord,
      end: currentSub.startTime + (wordIdx + 1) * perWord,
    };
  }, [currentSub]);

  const loopRange = useMemo<{ start: number; end: number } | null>(() => {
    if (!selectedWordRange || !currentSub || !loopPlaying) return null;
    const words = currentSub.text.split(/\s+/).filter(Boolean);
    const segDuration = currentSub.endTime - currentSub.startTime;
    const perWord = segDuration / words.length;
    const [from, to] = selectedWordRange;
    return {
      start: currentSub.startTime + from * perWord,
      end: currentSub.startTime + (to + 1) * perWord,
    };
  }, [selectedWordRange, currentSub, loopPlaying]);

  const handleWordClick = useCallback((wordIdx: number, e: React.MouseEvent) => {
    if (!currentSub) return;
    const words = currentSub.text.split(/\s+/).filter(Boolean);
    if (e.shiftKey && selectedWordRange) {
      const [from] = selectedWordRange;
      const newFrom = Math.min(from, wordIdx);
      const newTo = Math.max(from, wordIdx);
      setSelectedWordRange([newFrom, newTo]);
    } else {
      setSelectedWordRange([wordIdx, wordIdx]);
    }
    setLoopPlaying(false);
  }, [currentSub, selectedWordRange]);

  const toggleLoopPlay = useCallback(() => {
    if (!selectedWordRange) return;
    setLoopPlaying(prev => !prev);
  }, [selectedWordRange]);

  const clearWordSelection = useCallback(() => {
    setSelectedWordRange(null);
    setLoopPlaying(false);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = window as unknown as Record<string, unknown>;
      if (!w.SpeechRecognition && !w.webkitSpeechRecognition) {
        setSpeechSupported(false);
      }
    }
  }, []);

  useEffect(() => {
    if (open && videoRef?.current) {
      wasPlayingRef.current = !videoRef.current.paused;
      videoRef.current.pause();
    }
    if (!open && videoRef?.current && wasPlayingRef.current) {
      videoRef.current.play().catch(() => {});
      wasPlayingRef.current = false;
    }
  }, [open, videoRef]);

  useEffect(() => {
    if (!open) {
      setCurrentIndex(0);
      setPhase('idle');
      setTranscript('');
      setResult(null);
      setResultMap(new Map());
      setMicError(null);
      setPlaybackRate(1);
      setAutoPause(true);
      setAnalysis(null);
      setAnalysisError('');
      setActiveWordIndex(-1);
      setClipCurrentTime(0);
      setSelectedWordRange(null);
      setLoopPlaying(false);
      allAnalysisRef.current = {};
      setBatchProgress(null);
      setBatchRunning(false);
      setAiScore(null);
      setAiScoreLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !currentSub) return;
    const words = currentSub.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const duration = currentSub.endTime - currentSub.startTime;
    if (duration <= 0) return;
    const progress = Math.max(0, Math.min(1, (clipCurrentTime - currentSub.startTime) / duration));
    const idx = Math.min(Math.floor(progress * words.length), words.length - 1);
    setActiveWordIndex(clipCurrentTime >= currentSub.startTime && clipCurrentTime <= currentSub.endTime ? idx : -1);
  }, [clipCurrentTime, currentSub, open]);

  useEffect(() => {
    if (!open || !currentSub || !videoId) return;
    const cacheKey = `${currentSub.startTime.toFixed(2)}-${currentSub.endTime.toFixed(2)}`;
    if (allAnalysisRef.current[cacheKey]) {
      setAnalysis(allAnalysisRef.current[cacheKey]);
      setAnalysisError('');
      return;
    }
    const fetchLocal = async () => {
      try {
        const res = await fetch(`/content/${videoId}/shadow-tips.json`);
        if (!res.ok) {
          setAnalysis(null);
          return;
        }
        const data: Record<string, ShadowAnalysis> = await res.json();
        allAnalysisRef.current = data;
        if (data[cacheKey]) {
          setAnalysis(data[cacheKey]);
          setAnalysisError('');
        } else {
          setAnalysis(null);
        }
      } catch {
        setAnalysis(null);
      }
    };
    fetchLocal();
  }, [currentIndex, open, videoId, currentSub]);

  const runBatchAnalysis = useCallback(async () => {
    if (!videoId || batchRunning) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: subtitles.length });
    const token = localStorage.getItem('ve-session-token') || '';
    let done = 0;
    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];
      const cacheKey = `${sub.startTime.toFixed(2)}-${sub.endTime.toFixed(2)}`;
      if (allAnalysisRef.current[cacheKey]) {
        done++;
        setBatchProgress({ done, total: subtitles.length });
        continue;
      }
      try {
        const res = await fetch('/api/shadow-speak/analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            videoId,
            subtitle: { text: sub.text, startTime: sub.startTime, endTime: sub.endTime },
          }),
        });
        const data = await res.json();
        if (res.ok && data.analysis) {
          allAnalysisRef.current[cacheKey] = data.analysis;
          if (i === currentIndex) {
            setAnalysis(data.analysis);
          }
        }
      } catch {}
      done++;
      setBatchProgress({ done, total: subtitles.length });
    }
    try {
      const res = await fetch(`/content/${videoId}/shadow-tips.json`);
      if (res.ok) {
        const data = await res.json();
        allAnalysisRef.current = { ...data, ...allAnalysisRef.current };
      }
    } catch {}
    setBatchRunning(false);
  }, [videoId, subtitles, batchRunning, currentIndex]);

  const stopRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => { stopRecognition(); };
  }, [stopRecognition]);

  const finishListening = useCallback((text: string) => {
    stopRecognition();
    if (!currentSub || !text.trim()) {
      setPhase('idle');
      return;
    }
    const speakDuration = speakStartRef.current > 0 ? (Date.now() - speakStartRef.current) / 1000 : undefined;
    const expectedDuration = currentSub.endTime - currentSub.startTime;
    const r = compareTranscript(currentSub.text, text, speakDuration, expectedDuration);
    setResult(r);
    setPhase('result');
    setCurrentIndex(ci => {
      setResultMap(prev => {
        const next = new Map(prev);
        next.set(ci, r);
        return next;
      });
      return ci;
    });
  }, [currentSub, stopRecognition]);

  useEffect(() => {
    finishRef.current = finishListening;
  }, [finishListening]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  const startListening = useCallback(() => {
    if (!speechSupported) return;
    stopRecognition();
    setMicError(null);
    setAiScore(null);

    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (event: unknown) => void;
      onerror: (event: unknown) => void;
      onend: () => void;
      start(): void;
      stop(): void;
    };
    if (!SR) return;

    const rec = new SR();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;

    let finalText = '';
    rec.onresult = (event: unknown) => {
      const srEvent = event as { results: { isFinal: boolean; [0]: { transcript: string } }[] };
      let interim = '';
      for (let i = 0; i < srEvent.results.length; i++) {
        if (srEvent.results[i].isFinal) {
          finalText += srEvent.results[i][0].transcript + ' ';
        } else {
          interim += srEvent.results[i][0].transcript;
        }
      }
      setTranscript((finalText + interim).trim());
    };

    rec.onerror = (event: unknown) => {
      const srError = event as { error?: string };
      stopRecognition();
      if (srError.error === 'not-allowed' || srError.error === 'service-not-allowed') {
        setMicError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问');
        setPhase('idle');
        return;
      }
      const textToUse = finalText.trim() || transcriptRef.current.trim();
      if (textToUse) {
        finishRef.current(textToUse);
      } else {
        setPhase('idle');
      }
    };

    rec.onend = () => {
      const textToUse = finalText.trim() || transcriptRef.current.trim();
      if (textToUse) {
        finishRef.current(textToUse);
      } else {
        setPhase('idle');
      }
    };

    recognitionRef.current = rec;
    rec.start();
    speakStartRef.current = Date.now();
    setPhase('listening');
    setTranscript('');
    setResult(null);
  }, [speechSupported, stopRecognition]);

  const stopListening = useCallback(() => {
    stopRecognition();
    const textToUse = transcript.trim() || transcriptRef.current.trim();
    if (textToUse && currentSub) {
      finishRef.current(textToUse);
    } else {
      setPhase('idle');
    }
  }, [stopRecognition, transcript, currentSub]);

  const fetchAiScore = useCallback(async () => {
    if (!result || !currentSub || !transcript) return;
    setAiScoreLoading(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const speakDuration = speakStartRef.current > 0 ? (Date.now() - speakStartRef.current) / 1000 : undefined;
      const res = await fetch('/api/shadow-speak/score', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          originalText: currentSub.text,
          transcript,
          speakDuration,
          expectedDuration: currentSub.endTime - currentSub.startTime,
        }),
      });
      const data = await res.json();
      if (res.ok && data.score) {
        setAiScore(data.score);
      }
    } catch {}
    setAiScoreLoading(false);
  }, [result, currentSub, transcript]);

  const jumpToIndex = useCallback((index: number) => {
    setCurrentIndex(index);
    setPhase('idle');
    setTranscript('');
    setResult(null);
    setMicError(null);
    setActiveWordIndex(-1);
    setSelectedWordRange(null);
    setLoopPlaying(false);
    setAiScore(null);
    setAiScoreLoading(false);
  }, []);

  const goNext = useCallback(() => {
    if (currentIndex < subtitles.length - 1) {
      jumpToIndex(currentIndex + 1);
    }
  }, [currentIndex, subtitles.length, jumpToIndex]);

  const goPrev = useCallback(() => {
    if (currentIndex > 0) {
      jumpToIndex(currentIndex - 1);
    }
  }, [currentIndex, jumpToIndex]);

  const retry = useCallback(() => {
    setPhase('idle');
    setTranscript('');
    setResult(null);
    setMicError(null);
    setActiveWordIndex(-1);
    setSelectedWordRange(null);
    setLoopPlaying(false);
    setAiScore(null);
    setAiScoreLoading(false);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const LEVEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
    beginner: { label: '入门', color: 'text-green-500', bg: 'bg-green-500/15 border-green-500/30' },
    intermediate: { label: '中级', color: 'text-yellow-500', bg: 'bg-yellow-500/15 border-yellow-500/30' },
    advanced: { label: '进阶', color: 'text-red-500', bg: 'bg-red-500/15 border-red-500/30' },
  };

  const renderedSubtitleWords = useMemo(() => {
    if (!currentSub) return null;
    const words = currentSub.text.split(/(\s+)/);
    let wordCounter = 0;

    const linkedPairs = new Set<number>();
    if (analysis?.connectedSpeech) {
      for (const cs of analysis.connectedSpeech) {
        const csWords = cs.words.split(/\s+/).map(w => w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, ''));
        const textWords = currentSub.text.split(/\s+/).map(w => w.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, ''));
        for (let start = 0; start <= textWords.length - csWords.length; start++) {
          let match = true;
          for (let j = 0; j < csWords.length; j++) {
            if (textWords[start + j] !== csWords[j]) { match = false; break; }
          }
          if (match) {
            for (let j = 0; j < csWords.length; j++) linkedPairs.add(start + j);
          }
        }
      }
    }

    return words.map((part, i) => {
      if (!part.trim()) return <span key={i}>{part}</span>;
      const idx = wordCounter++;
      const isCurrentWord = idx === activeWordIndex;
      const isStress = analysis?.stress?.some(s => s.word.toLowerCase() === part.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, ''));
      const isSwallowed = analysis?.swallowed?.some(s => s.word.toLowerCase() === part.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, ''));
      const isLinked = linkedPairs.has(idx);
      const isSelected = selectedWordRange ? idx >= selectedWordRange[0] && idx <= selectedWordRange[1] : false;

      let className = 'px-0.5 rounded transition-all duration-75 cursor-pointer select-none ';
      const style: React.CSSProperties = {};

      if (isSelected) {
        className += 'bg-violet-400/25 ring-1 ring-violet-500/60 ';
      }
      if (isCurrentWord && !isSelected) {
        className += 'bg-green-400/25 text-green-700 dark:text-green-300 ring-2 ring-green-500/70 shadow-[0_0_6px_rgba(34,197,94,0.25)] ';
      }
      if (isStress) {
        className += 'font-bold ';
        style.color = '#f97316';
      }
      if (isSwallowed) {
        style.color = '#9ca3af';
        style.opacity = '0.55';
      }
      if (isLinked && !isCurrentWord && !isSelected) {
        className += 'underline decoration-blue-400 decoration-wavy decoration-2 underline-offset-4 ';
      }

      return (
        <span
          key={i}
          className={className}
          style={style}
          onClick={(e) => handleWordClick(idx, e)}
          title={isStress ? '重读' : isSwallowed ? '弱读/吞音' : isLinked ? '连读' : '点击选词循环播放'}
        >
          {part}
        </span>
      );
    });
  }, [currentSub, activeWordIndex, analysis, selectedWordRange, handleWordClick]);

  if (!open) return null;

  const avgScore = resultMap.size > 0
    ? Math.round(Array.from(resultMap.values()).reduce((s, r) => s + r.score, 0) / resultMap.size)
    : null;

  const wrongWords = result?.words.filter(w => w.status === 'wrong' && w.phonemeHint) || [];

  const displayAccuracy = aiScore?.accuracy ?? result?.accuracy ?? 0;
  const displayFluency = aiScore?.fluency ?? result?.fluency ?? 0;
  const displayCompleteness = aiScore?.completeness ?? result?.completeness ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-5xl max-h-[92vh] flex flex-col bg-card rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center">
              <Mic className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-base">影子跟读</h2>
              <p className="text-[11px] text-muted-foreground">
                {hasSubtitles ? `${currentIndex + 1} / ${subtitles.length} 句` : '暂无字幕'}
                {avgScore !== null && <span className="ml-1.5 text-violet-500">平均 {avgScore} 分</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && hasSubtitles && (
              <button
                onClick={runBatchAnalysis}
                disabled={batchRunning}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
              >
                {batchRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {batchRunning
                  ? `分析中 ${batchProgress ? `${batchProgress.done}/${batchProgress.total}` : ''}`
                  : '一键分析全部'}
              </button>
            )}
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {!speechSupported ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-4">
            <AlertTriangle className="h-10 w-10 text-yellow-400" />
            <p className="text-sm text-muted-foreground text-center px-8">
              你的浏览器不支持语音识别，请使用 Chrome 或 Edge 浏览器
            </p>
          </div>
        ) : !hasSubtitles ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-4">
            <AlertTriangle className="h-10 w-10 text-yellow-400" />
            <p className="text-sm text-muted-foreground">该视频暂无字幕，无法进行跟读练习</p>
          </div>
        ) : (
          <>
            {/* Progress bar */}
            <div className="px-5 shrink-0">
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full transition-all duration-300"
                  style={{ width: `${((currentIndex + 1) / subtitles.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="flex gap-5 min-h-0">
                {/* Left: Practice area */}
                <div className="flex-1 min-w-0 flex flex-col gap-3">

                  {micError && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{micError}</span>
                    </div>
                  )}

                  {/* Current segment */}
                  <div className="p-3 rounded-xl bg-muted/20 border border-border/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground font-medium">当前语段</span>
                        {analysis && LEVEL_CONFIG[analysis.level] && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${LEVEL_CONFIG[analysis.level].bg} ${LEVEL_CONFIG[analysis.level].color}`}>
                            {analysis.levelLabel}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {currentSub && `${currentSub.startTime.toFixed(1)}s - ${currentSub.endTime.toFixed(1)}s`}
                      </span>
                    </div>
                    <p className="text-[15px] leading-relaxed font-medium">
                      {renderedSubtitleWords || currentSub?.text}
                    </p>
                    {analysis && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className="text-[10px] flex items-center gap-1">
                          <span className="font-bold" style={{ color: '#f97316' }}>Aa</span>
                          <span className="text-muted-foreground">重读</span>
                        </span>
                        <span className="text-[10px] flex items-center gap-1">
                          <span className="italic opacity-55">Aa</span>
                          <span className="text-muted-foreground">弱读</span>
                        </span>
                        <span className="text-[10px] flex items-center gap-1">
                          <span className="underline decoration-blue-400 decoration-wavy decoration-2 underline-offset-2">Aa</span>
                          <span className="text-muted-foreground">连读</span>
                        </span>
                      </div>
                    )}
                    {!analysis && !analysisError && (
                      <p className="text-[11px] text-muted-foreground mt-2 italic">
                        暂无AI分析数据，{isAdmin ? '点击右上角「一键分析全部」生成' : '请联系管理员生成分析数据'}
                      </p>
                    )}
                    {selectedWordRange && currentSub && (
                      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/40">
                        <button
                          onClick={toggleLoopPlay}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            loopPlaying
                              ? 'bg-violet-500 text-white shadow-sm'
                              : 'bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20'
                          }`}
                        >
                          <Repeat className={`h-3 w-3 ${loopPlaying ? 'animate-spin' : ''}`} style={loopPlaying ? { animationDuration: '2s' } : {}} />
                          {loopPlaying ? '循环中' : '循环播放'}
                        </button>
                        <span className="text-[10px] text-muted-foreground">
                          {currentSub.text.split(/\s+/).filter(Boolean).slice(selectedWordRange[0], selectedWordRange[1] + 1).join(' ')}
                        </span>
                        <button
                          onClick={clearWordSelection}
                          className="ml-auto p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                        >
                          <XSquare className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Idle state */}
                  {phase === 'idle' && (
                    <div className="flex flex-col items-center gap-5 py-8">
                      <button
                        onClick={startListening}
                        className="w-24 h-24 rounded-full bg-gradient-to-br from-violet-500 to-pink-500 flex items-center justify-center shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all"
                      >
                        <Mic className="h-10 w-10 text-white" />
                      </button>
                      <div className="text-center">
                        <p className="text-sm font-medium">点击开始跟读</p>
                        <p className="text-xs text-muted-foreground mt-1">先听视频播放，然后模仿跟读</p>
                      </div>
                    </div>
                  )}

                  {/* Listening state */}
                  {phase === 'listening' && (
                    <div className="flex flex-col items-center gap-5 py-6">
                      <button
                        onClick={stopListening}
                        className="w-24 h-24 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/25 hover:shadow-red-500/40 hover:scale-105 active:scale-95 transition-all animate-pulse"
                      >
                        <MicOff className="h-10 w-10 text-white" />
                      </button>
                      <p className="text-sm text-muted-foreground">正在听你说话...</p>
                      {transcript && (
                        <div className="w-full p-4 rounded-xl bg-muted/30 border border-border">
                          <p className="text-xs text-muted-foreground mb-1.5">实时识别</p>
                          <p className="text-base leading-relaxed">{transcript}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Result state */}
                  {phase === 'result' && result && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-5 p-5 rounded-xl bg-gradient-to-br from-violet-500/5 to-pink-500/5 border border-violet-500/10">
                        <div className="text-center shrink-0">
                          <div className={`text-5xl font-black tabular-nums ${getScoreLabel(result.score).color}`}>
                            {result.score}
                          </div>
                          <div className={`text-xs font-medium mt-1 ${getScoreLabel(result.score).color}`}>
                            {getScoreLabel(result.score).emoji} {getScoreLabel(result.score).label}
                          </div>
                        </div>
                        <div className="flex-1 space-y-2.5">
                          <ScoreBar label="准确度" score={displayAccuracy} icon={<Target className="h-3.5 w-3.5 text-white" />} color="bg-blue-500" />
                          <ScoreBar label="流利度" score={displayFluency} icon={<Wind className="h-3.5 w-3.5 text-white" />} color="bg-emerald-500" />
                          <ScoreBar label="完整度" score={displayCompleteness} icon={<ListChecks className="h-3.5 w-3.5 text-white" />} color="bg-amber-500" />
                        </div>
                      </div>

                      {!aiScore && !aiScoreLoading && (
                        <button
                          onClick={fetchAiScore}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 transition-colors border border-violet-500/20"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          AI 深度评分
                        </button>
                      )}
                      {aiScoreLoading && (
                        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          AI 评分中...
                        </div>
                      )}
                      {aiScore?.tip && (
                        <div className="p-3 rounded-xl bg-violet-500/5 border border-violet-500/15 text-sm">
                          <span className="text-violet-500 font-medium">AI 建议：</span>
                          <span className="text-muted-foreground ml-1">{aiScore.tip}</span>
                        </div>
                      )}

                      <div className="p-4 rounded-xl bg-muted/30 border border-border">
                        <p className="text-xs text-muted-foreground font-medium mb-3">逐词对比</p>
                        <div className="flex flex-wrap gap-1.5">
                          {result.words.map((w, i) => {
                            let cls = 'px-2 py-1 rounded-md text-sm font-medium ';
                            let icon = null;
                            if (w.status === 'correct') {
                              cls += 'bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25';
                              icon = <Check className="h-3 w-3 inline ml-0.5" />;
                            } else if (w.status === 'wrong') {
                              cls += 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25';
                              icon = <XCircle className="h-3 w-3 inline ml-0.5" />;
                            } else if (w.status === 'missing') {
                              cls += 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border border-yellow-500/25 line-through';
                              icon = <AlertTriangle className="h-3 w-3 inline ml-0.5" />;
                            } else {
                              cls += 'bg-muted text-muted-foreground border border-border';
                            }
                            return (
                              <span key={i} className={cls} title={w.status === 'wrong' ? `你说了: ${w.spoken}` : ''}>
                                {w.original || `(${w.spoken})`}
                                {icon}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {wrongWords.length > 0 && (
                        <div className="rounded-xl border border-border bg-violet-500/[0.02] px-4 py-3 space-y-2">
                          <span className="text-sm font-medium text-violet-600 dark:text-violet-400">
                            发音诊断（{wrongWords.length} 个问题）
                          </span>
                          {wrongWords.map((w, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="shrink-0 mt-0.5">
                                <span className="text-red-500 font-medium">{w.original}</span>
                                <span className="text-muted-foreground mx-1">→</span>
                                <span className="text-orange-500">{w.spoken}</span>
                              </span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-muted-foreground">{w.phonemeHint}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={retry}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border rounded-xl text-sm hover:bg-muted transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" /> 重试
                        </button>
                        {currentIndex < subtitles.length - 1 && (
                          <button
                            onClick={goNext}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-500 to-pink-500 text-white rounded-xl text-sm hover:opacity-90 transition-opacity"
                          >
                            下一句 <ChevronRight className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Tips - always fully visible */}
                  {analysis && (
                    <div className="rounded-xl border border-violet-500/15 bg-violet-500/[0.03] px-4 py-3 space-y-3">
                      <div className="flex items-center gap-2">
                        <Lightbulb className="h-4 w-4 text-violet-400" />
                        <span className="text-sm font-medium text-violet-600 dark:text-violet-400">跟读 Tips</span>
                      </div>
                      {analysis.speed?.tip && (
                        <div className="text-sm">
                          <span className="text-blue-500 font-medium">语速：</span>
                          <span className="text-muted-foreground ml-1">{analysis.speed.tip}</span>
                        </div>
                      )}
                      {analysis.connectedSpeech?.length > 0 && (
                        <div className="text-sm">
                          <span className="text-purple-500 font-medium">连读：</span>
                          <div className="mt-1 space-y-1 ml-4">
                            {analysis.connectedSpeech.map((c, i) => (
                              <div key={i} className="text-muted-foreground">
                                <span className="text-foreground font-medium">{c.words}</span>
                                <span className="text-purple-400 text-xs ml-1">[{c.type}]</span>
                                <span className="ml-1">{c.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.stress?.length > 0 && (
                        <div className="text-sm">
                          <span className="text-orange-500 font-medium">重读：</span>
                          <div className="mt-1 space-y-1 ml-4">
                            {analysis.stress.map((s, i) => (
                              <div key={i} className="text-muted-foreground">
                                <span className="text-foreground font-bold" style={{ color: '#f97316' }}>{s.word}</span>
                                <span className="ml-1">— {s.reason}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.swallowed?.length > 0 && (
                        <div className="text-sm">
                          <span className="text-gray-500 font-medium">弱读/吞音：</span>
                          <div className="mt-1 space-y-1 ml-4">
                            {analysis.swallowed.map((s, i) => (
                              <div key={i} className="text-muted-foreground">
                                <span className="text-foreground italic opacity-55">{s.word}</span>
                                <span className="ml-1">— {s.description}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {analysis.tips?.length > 0 && (
                        <div className="text-sm">
                          <span className="text-green-500 font-medium">建议：</span>
                          <ul className="mt-1 space-y-1 ml-4">
                            {analysis.tips.map((tip, i) => (
                              <li key={i} className="text-muted-foreground">• {tip}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Right: Video + Timeline */}
                <div className="w-[40%] shrink-0 flex flex-col gap-3">
                  {currentSub && (
                    <ClipPlayer
                      src={videoUrl}
                      start={currentSub.startTime}
                      end={currentSub.endTime}
                      playbackRate={playbackRate}
                      onTimeUpdate={setClipCurrentTime}
                      onClipEnd={() => {
                        if (autoPause) {
                          // clip auto-paused
                        }
                      }}
                      loopRange={loopRange}
                    />
                  )}

                  {/* Speed + auto-pause controls */}
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-1.5">
                      <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] text-muted-foreground">语速</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      {[0.5, 0.7, 0.8, 1.0, 1.2, 1.5].map(rate => (
                        <button
                          key={rate}
                          onClick={() => setPlaybackRate(rate)}
                          className={`px-1.5 py-0.5 text-[10px] rounded-md transition-colors ${
                            playbackRate === rate
                              ? 'bg-violet-500 text-white font-medium shadow-sm'
                              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between px-1">
                    <span className="text-[11px] text-muted-foreground">播完自动暂停</span>
                    <button
                      onClick={() => setAutoPause(!autoPause)}
                      className={`text-[11px] px-2 py-0.5 rounded-md transition-colors ${
                        autoPause
                          ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                          : 'bg-muted text-muted-foreground border border-transparent'
                      }`}
                    >
                      {autoPause ? '开' : '关'}
                    </button>
                  </div>

                  {/* Timeline search + jump */}
                  <SegmentTimeline
                    subtitles={subtitles}
                    currentIndex={currentIndex}
                    onSelect={jumpToIndex}
                    totalDuration={totalDuration}
                  />
                </div>
              </div>
            </div>

            {/* Bottom navigation */}
            <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
              <button
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-4 w-4" /> 上一句
              </button>
              <div className="flex items-center gap-1.5">
                {subtitles.slice(Math.max(0, currentIndex - 2), Math.min(subtitles.length, currentIndex + 3)).map((_, i) => {
                  const realIdx = Math.max(0, currentIndex - 2) + i;
                  const isCurrent = realIdx === currentIndex;
                  const hasResult = resultMap.has(realIdx);
                  return (
                    <div
                      key={realIdx}
                      className={`rounded-full transition-all ${
                        isCurrent
                          ? 'w-6 h-2 bg-violet-500'
                          : hasResult
                            ? 'w-2 h-2 bg-green-500/50'
                            : 'w-2 h-2 bg-muted-foreground/25'
                      }`}
                    />
                  );
                })}
              </div>
              <button
                onClick={goNext}
                disabled={currentIndex >= subtitles.length - 1}
                className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                下一句 <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
