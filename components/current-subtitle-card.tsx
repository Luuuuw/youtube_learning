'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { Repeat, Turtle, RotateCcw, X, BookOpen, PlusCircle, Ear, Quote, Loader2, Check } from 'lucide-react';
import { Subtitle, WordTiming } from '@/lib/vtt-parser';
import { getActiveWordIndex } from '@/lib/subtitle-sync';
import { classifyWord } from '@/lib/word-classify';

interface CurrentSubtitleCardProps {
  subtitle: Subtitle | null;
  zhText: string | null;
  currentTime: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  highlightWords: boolean;
  translating: boolean;
  videoId: string;
  // Sentence loop
  loopingSubId: number | null;
  onToggleSentenceLoop: () => void;
  // Segment loop
  segmentLoopRange: { startTime: number; endTime: number } | null;
  onSegmentLoopChange: (range: { startTime: number; endTime: number } | null) => void;
  // Actions
  onSlowReplay: () => void;
  onReplay: () => void;
}

function getWordTimingRange(
  wordTimings: WordTiming[] | undefined,
  wordCount: number,
  from: number,
  to: number,
  subtitleEnd: number,
): { startTime: number; endTime: number } | null {
  if (from < 0 || to >= wordCount) return null;

  if (wordTimings && wordTimings.length === wordCount) {
    const startTime = wordTimings[from].startTime;
    const endTime = to + 1 < wordTimings.length
      ? wordTimings[to + 1].startTime
      : subtitleEnd;
    return { startTime, endTime };
  }

  // Fallback: proportional estimation
  return null;
}

export default function CurrentSubtitleCard({
  subtitle,
  zhText,
  currentTime,
  videoRef,
  highlightWords,
  translating,
  videoId,
  loopingSubId,
  onToggleSentenceLoop,
  segmentLoopRange,
  onSegmentLoopChange,
  onSlowReplay,
  onReplay,
}: CurrentSubtitleCardProps) {
  const [selectedWordRange, setSelectedWordRange] = useState<[number, number] | null>(null);
  const [flashcardWords, setFlashcardWords] = useState<Set<string>>(new Set());
  const [flashcardPhrases, setFlashcardPhrases] = useState<string[]>([]);
  const [flashcardTotal, setFlashcardTotal] = useState(0);
  // Manual add flashcard
  const [addMode, setAddMode] = useState<'none' | 'vocab' | 'sentence'>('none');
  const [addLoading, setAddLoading] = useState(false);
  const [addMsg, setAddMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [vocabWord, setVocabWord] = useState('');
  const [vocabDef, setVocabDef] = useState('');
  const [vocabPos, setVocabPos] = useState('');
  const [vocabLookingUp, setVocabLookingUp] = useState(false);
  const [sentencePattern, setSentencePattern] = useState('');
  const prevSubIdRef = useRef<number | null>(null);

  // Fetch this video's flashcard vocab words
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = localStorage.getItem('ve-session-token');
        const res = await fetch(`/api/flashcards?videoId=${videoId}&dimension=vocab`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const cards = Array.isArray(data.cards) ? data.cards : [];
        const words = new Set<string>();
        const phrases: string[] = [];
        for (const c of cards) {
          if (c.word) {
            const w = c.word.toLowerCase();
            if (w.includes(' ')) {
              phrases.push(w);
            } else {
              words.add(w);
            }
          }
        }
        setFlashcardWords(words);
        setFlashcardPhrases(phrases);
        setFlashcardTotal(cards.length);
      } catch { /* ignore */ }
    }
    load();
    return () => { cancelled = true; };
  }, [videoId]);

  // Clear selection and segment loop when subtitle changes
  useEffect(() => {
    if (subtitle && subtitle.id !== prevSubIdRef.current) {
      setSelectedWordRange(null);
      onSegmentLoopChange(null);
    }
    prevSubIdRef.current = subtitle?.id ?? null;
  }, [subtitle, onSegmentLoopChange]);

  // Split text into words (preserving whitespace tokens for wrapping)
  const parts = useMemo(() => {
    if (!subtitle) return [];
    return subtitle.text.split(/(\s+)/);
  }, [subtitle]);

  const wordCount = useMemo(() => parts.filter(p => p.trim()).length, [parts]);

  // Active word index from playback time
  const activeWordIdx = useMemo(() => {
    if (!subtitle) return -1;
    return getActiveWordIndex(
      subtitle.text,
      currentTime,
      subtitle.startTime,
      subtitle.endTime,
      subtitle.wordTimings,
    );
  }, [subtitle, currentTime]);

  // Words in current subtitle that have flashcards
  const currentFlashcardWords = useMemo(() => {
    if (!subtitle) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    const lowerText = subtitle.text.toLowerCase();

    // Single word matches
    if (flashcardWords.size > 0) {
      for (const p of parts) {
        const w = p.trim().toLowerCase();
        if (!w) continue;
        const clean = w.replace(/[^a-zA-Z0-9'-]+$/, '');
        if (flashcardWords.has(clean) && !seen.has(clean)) {
          seen.add(clean);
          result.push(clean);
        }
      }
    }

    // Multi-word phrase matches
    if (flashcardPhrases.length > 0) {
      for (const phrase of flashcardPhrases) {
        if (lowerText.includes(phrase) && !seen.has(phrase)) {
          seen.add(phrase);
          result.push(phrase);
        }
      }
    }

    return result;
  }, [subtitle, parts, flashcardWords, flashcardPhrases]);

  const handleWordClick = useCallback((wordIdx: number) => {
    if (!subtitle) return;

    if (selectedWordRange === null) {
      setSelectedWordRange([wordIdx, wordIdx]);
      onSegmentLoopChange(null);
      return;
    }

    // Clicking same single word → deselect
    if (selectedWordRange[0] === wordIdx && selectedWordRange[1] === wordIdx) {
      setSelectedWordRange(null);
      onSegmentLoopChange(null);
      return;
    }

    // Second click → complete the range
    const newFrom = Math.min(selectedWordRange[0], wordIdx);
    const newTo = Math.max(selectedWordRange[0], wordIdx);
    setSelectedWordRange([newFrom, newTo]);
  }, [subtitle, selectedWordRange, onSegmentLoopChange]);

  const handleToggleSegmentLoop = useCallback(() => {
    if (segmentLoopRange) {
      onSegmentLoopChange(null);
      return;
    }
    if (!subtitle || !selectedWordRange) return;

    const [from, to] = selectedWordRange;
    const range = getWordTimingRange(
      subtitle.wordTimings,
      wordCount,
      from,
      to,
      subtitle.endTime,
    );

    if (range) {
      onSegmentLoopChange(range);
      // Seek to start and play
      const video = videoRef?.current;
      if (video) {
        video.currentTime = range.startTime;
        video.play().catch(() => {});
      }
    }
  }, [subtitle, selectedWordRange, segmentLoopRange, wordCount, onSegmentLoopChange]);

  const handleClearSelection = useCallback(() => {
    setSelectedWordRange(null);
    onSegmentLoopChange(null);
  }, [onSegmentLoopChange]);

  // Auto-hide success message after 3s
  useEffect(() => {
    if (!addMsg?.ok) return;
    const t = setTimeout(() => setAddMsg(null), 3000);
    return () => clearTimeout(t);
  }, [addMsg]);

  // ---- Manual add handlers ----

  function getAuthHeaders() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async function callAddApi(body: Record<string, unknown>) {
    const res = await fetch('/api/flashcards/add', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const handleOpenVocab = useCallback(() => {
    let word = '';
    if (selectedWordRange && subtitle) {
      word = parts.filter(p => p.trim()).slice(selectedWordRange[0], selectedWordRange[1] + 1).join(' ').replace(/[^a-zA-Z0-9'-]+$/, '').trim();
    }
    setVocabWord(word);
    setVocabDef('');
    setVocabPos('');
    setAddMsg(null);
    setAddMode('vocab');
  }, [selectedWordRange, subtitle]);

  const handleVocabLookup = useCallback(async () => {
    if (!vocabWord.trim()) return;
    setVocabLookingUp(true);
    try {
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ word: vocabWord.trim(), promptType: 'dictionary' }),
      });
      const data = await res.json();
      if (data.definition) setVocabDef(data.definition);
      if (data.pos) setVocabPos(data.pos);
    } catch { /* ignore */ }
    setVocabLookingUp(false);
  }, [vocabWord]);

  const handleAddVocabConfirm = useCallback(async () => {
    if (!vocabWord.trim() || !vocabDef.trim()) return;
    setAddLoading(true);
    setAddMsg(null);
    try {
      await callAddApi({
        action: 'vocab',
        videoId,
        word: vocabWord.trim(),
        definition: vocabDef.trim(),
        pos: vocabPos || undefined,
        startTime: subtitle?.startTime,
        endTime: subtitle?.endTime,
      });
      setAddMsg({ text: `已添加「${vocabWord.trim()}」`, ok: true });
      setAddMode('none');
      // Refresh flashcard words
      setFlashcardWords(prev => new Set(Array.from(prev).concat(vocabWord.trim().toLowerCase())));
      setFlashcardTotal(n => n + 1);
    } catch (e) {
      setAddMsg({ text: (e as Error).message, ok: false });
    }
    setAddLoading(false);
  }, [vocabWord, vocabDef, vocabPos, videoId, subtitle]);

  const handleAddListening = useCallback(async () => {
    if (!subtitle) return;
    setAddLoading(true);
    setAddMsg(null);
    try {
      await callAddApi({
        action: 'listening',
        videoId,
        sentence: subtitle.text,
        startTime: subtitle.startTime,
        endTime: subtitle.endTime,
      });
      setAddMsg({ text: '已添加听力卡', ok: true });
    } catch (e) {
      setAddMsg({ text: (e as Error).message, ok: false });
    }
    setAddLoading(false);
  }, [subtitle, videoId]);

  const handleOpenSentence = useCallback(() => {
    setSentencePattern('');
    setAddMsg(null);
    setAddMode('sentence');
  }, []);

  const handleAddSentenceConfirm = useCallback(async () => {
    if (!sentencePattern.trim() || !subtitle) return;
    setAddLoading(true);
    setAddMsg(null);
    try {
      await callAddApi({
        action: 'sentence',
        videoId,
        sentence: subtitle.text,
        pattern: sentencePattern.trim(),
        zhSentence: zhText || undefined,
        startTime: subtitle.startTime,
        endTime: subtitle.endTime,
      });
      setAddMsg({ text: `已添加句型「${sentencePattern.trim()}」`, ok: true });
      setAddMode('none');
    } catch (e) {
      setAddMsg({ text: (e as Error).message, ok: false });
    }
    setAddLoading(false);
  }, [sentencePattern, subtitle, videoId]);

  // Empty state
  if (!subtitle) {
    return (
      <div className="bg-muted/50 rounded-lg px-4 py-3">
        <p className="text-sm text-muted-foreground italic">等待播放...</p>
      </div>
    );
  }

  const isSentenceLooping = loopingSubId === subtitle.id;
  const segmentText = selectedWordRange
    ? parts.filter(p => p.trim()).slice(selectedWordRange[0], selectedWordRange[1] + 1).join(' ')
    : '';

  return (
    <div className="bg-muted/50 rounded-lg px-4 py-3 space-y-2">
      {/* English subtitle text */}
      <p className="text-base leading-8 text-foreground break-words">
        {parts.map((part, i) => {
          if (!part.trim()) return <span key={i}>{part}</span>;

          const wordIdx = parts.slice(0, i + 1).filter(p => p.trim()).length - 1;
          const cls = classifyWord(part);
          const isActiveWord = wordIdx === activeWordIdx;
          const isInSelection = selectedWordRange
            && wordIdx >= selectedWordRange[0]
            && wordIdx <= selectedWordRange[1];
          const isInSegmentLoop = segmentLoopRange && selectedWordRange
            && wordIdx >= selectedWordRange[0]
            && wordIdx <= selectedWordRange[1];
          const isFlashcardWord = flashcardWords.size > 0
            && flashcardWords.has(part.trim().toLowerCase().replace(/[^a-zA-Z0-9'-]+$/, ''));

          let className: string;
          if (isActiveWord) {
            className = 'bg-green-400/25 text-green-700 dark:text-green-300 rounded px-1 ring-2 ring-green-500/70 shadow-[0_0_6px_rgba(34,197,94,0.25)] transition-all duration-75 cursor-pointer';
          } else if (isInSegmentLoop && segmentLoopRange) {
            className = 'bg-violet-400/25 text-violet-700 dark:text-violet-300 rounded px-1 ring-1 ring-violet-500/60 cursor-pointer';
          } else if (isInSelection) {
            className = 'bg-violet-400/20 text-violet-700 dark:text-violet-300 rounded px-1 ring-1 ring-violet-400/40 cursor-pointer';
          } else if (highlightWords && cls.isKeyVocab) {
            className = `${cls.bgColor} ${cls.color} rounded px-1 cursor-pointer transition-colors`;
          } else if (isFlashcardWord) {
            className = 'border-b-2 border-amber-400/60 text-amber-700 dark:text-amber-300 rounded px-1 cursor-pointer transition-colors hover:bg-amber-400/10';
          } else {
            className = 'hover:bg-primary/10 rounded px-1 cursor-pointer transition-colors';
          }

          return (
            <span
              key={i}
              className={className}
              onClick={() => handleWordClick(wordIdx)}
            >
              {part}
            </span>
          );
        })}
      </p>

      {/* Chinese translation */}
      {zhText ? (
        <p className="text-sm leading-6 text-foreground font-medium">{zhText}</p>
      ) : translating ? (
        <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          中文字幕后台翻译中，完成后自动出现
        </p>
      ) : null}

      {/* Flashcard hint bar */}
      {currentFlashcardWords.length > 0 && (
        <div className="flex items-center gap-2 pt-1.5 border-t border-border/40">
          <BookOpen className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-muted-foreground">
            本句有 {currentFlashcardWords.length} 个闪卡词：
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {' '}{currentFlashcardWords.join(', ')}
            </span>
          </span>
          <Link
            href={`/flashcards/${videoId}`}
            className="ml-auto text-xs text-amber-600 dark:text-amber-400 hover:underline shrink-0"
          >
            查看全部 ({flashcardTotal})
          </Link>
        </div>
      )}

      {/* Segment loop bar */}
      {(selectedWordRange || segmentLoopRange) && (
        <div className="flex items-center gap-2 pt-1.5 border-t border-border/40">
          <button
            type="button"
            onClick={handleToggleSegmentLoop}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
              segmentLoopRange
                ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80'
            }`}
          >
            <Repeat className="h-3.5 w-3.5" />
            {segmentLoopRange ? '停止循环' : `循环 "${segmentText}"`}
          </button>
          <button
            type="button"
            onClick={handleClearSelection}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="取消选择"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-1.5 pt-1.5 border-t border-border/40">
        <button
          type="button"
          onClick={onToggleSentenceLoop}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
            isSentenceLooping
              ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          title={isSentenceLooping ? '取消单句循环' : '单句循环'}
        >
          <Repeat className="h-3.5 w-3.5" />
          单句循环
        </button>
        <button
          type="button"
          onClick={onSlowReplay}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="0.7x 慢放本句"
        >
          <Turtle className="h-3.5 w-3.5" />
          慢放
        </button>
        <button
          type="button"
          onClick={onReplay}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="重播本句"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          重播
        </button>

        {/* Separator */}
        <span className="w-px h-4 bg-border/60 mx-1" />

        {/* Add vocab */}
        <button type="button" onClick={handleOpenVocab}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
          title="添加词汇闪卡">
          <PlusCircle className="h-3.5 w-3.5" />
          词汇
        </button>

        {/* Add listening */}
        <button type="button" onClick={handleAddListening} disabled={addLoading}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 transition-colors disabled:opacity-50"
          title="本句生成听力填空卡">
          {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ear className="h-3.5 w-3.5" />}
          听力
        </button>

        {/* Add sentence */}
        <button type="button" onClick={handleOpenSentence}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors"
          title="添加句型闪卡">
          <Quote className="h-3.5 w-3.5" />
          句型
        </button>
      </div>

      {/* Status message */}
      {addMsg && (
        <div className={`text-xs px-3 py-1.5 rounded-lg ${addMsg.ok ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'}`}>
          {addMsg.text}
        </div>
      )}

      {/* Vocab form */}
      {addMode === 'vocab' && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <div className="flex items-center gap-2">
            <input
              value={vocabWord}
              onChange={e => setVocabWord(e.target.value)}
              placeholder="单词或短语"
              className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
              autoFocus
            />
            <select
              value={vocabPos}
              onChange={e => setVocabPos(e.target.value)}
              className="bg-background border border-border rounded-lg px-2 py-1.5 text-xs text-muted-foreground"
            >
              <option value="">词性</option>
              {['noun','verb','adj','adv','phrase','prep','conj','pron'].map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button type="button" onClick={handleVocabLookup} disabled={vocabLookingUp || !vocabWord.trim()}
              className="px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              title="查释义">
              {vocabLookingUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '查释义'}
            </button>
          </div>
          <input
            value={vocabDef}
            onChange={e => setVocabDef(e.target.value)}
            placeholder="中文释义"
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAddVocabConfirm} disabled={addLoading || !vocabWord.trim() || !vocabDef.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-50">
              {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              添加词汇卡
            </button>
            <button type="button" onClick={() => setAddMode('none')}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              取消
            </button>
          </div>
        </div>
      )}

      {/* Sentence form */}
      {addMode === 'sentence' && (
        <div className="space-y-2 pt-1 border-t border-border/40">
          <div className="text-xs text-muted-foreground">
            原句：{subtitle.text}
          </div>
          <input
            value={sentencePattern}
            onChange={e => setSentencePattern(e.target.value)}
            placeholder="句型名，如 would rather X than Y"
            className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-sm"
            autoFocus
          />
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleAddSentenceConfirm} disabled={addLoading || !sentencePattern.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500 text-white hover:bg-purple-600 transition-colors disabled:opacity-50">
              {addLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              添加句型卡
            </button>
            <button type="button" onClick={() => setAddMode('none')}
              className="px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
