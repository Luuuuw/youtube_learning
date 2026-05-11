'use client';

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Check, Plus, Loader2 } from 'lucide-react';
import { lookupWord, VocabBankEntry } from '@/lib/dictionary';

interface WordTooltipProps {
  word: string;
  children: React.ReactNode;
  context?: string;
  videoId?: string;
  videoTitle?: string;
  timestamp?: number;
}

export default function WordTooltip({
  word,
  children,
  context = '',
  videoId = '',
  videoTitle = '',
  timestamp = 0,
}: WordTooltipProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showBelow, setShowBelow] = useState(false);
  const [added, setAdded] = useState(false);
  const [alreadyExists, setAlreadyExists] = useState(false);
  const [definition, setDefinition] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [bankEntry, setBankEntry] = useState<VocabBankEntry | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cleanWord = word.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase();
  const tooltipStyle = useMemo<React.CSSProperties>(() => {
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const edgePadding = 16;
    const desktopHalfWidth = 180;
    const top = Math.max(10, pos.y - (showBelow ? 0 : 10));

    if (viewportWidth < 640) {
      return {
        left: `${edgePadding}px`,
        right: `${edgePadding}px`,
        top: `${top}px`,
        transform: showBelow ? 'translateY(0)' : 'translateY(-100%)',
      };
    }

    const clampedX = Math.min(
      Math.max(pos.x, edgePadding + desktopHalfWidth),
      viewportWidth - edgePadding - desktopHalfWidth
    );

    return {
      left: `${clampedX}px`,
      top: `${top}px`,
      transform: showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    };
  }, [pos.x, pos.y, showBelow]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      setShow(false);
    }, 200);
  }, [clearHideTimer]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  const fetchDefinition = useCallback(async () => {
    if (definition || loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await lookupWord(cleanWord, context);
      setDefinition(result.definition);
      if (result.bankEntry) setBankEntry(result.bankEntry);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  }, [cleanWord, context, definition, loading]);

  const handleShow = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const below = rect.top < 200;
    setPos({
      x: rect.left + rect.width / 2,
      y: below ? rect.bottom + 8 : rect.top - 8,
    });
    setShowBelow(below);
    clearHideTimer();
    setShow(true);
    setAdded(false);
    setAlreadyExists(false);
    setBankEntry(null);
    fetchDefinition();
  }, [clearHideTimer, fetchDefinition]);

  const handleAddVocab = useCallback(async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/vocab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          word: cleanWord,
          definition: definition || '（暂无释义）',
          context,
          videoId,
          videoTitle,
          timestamp,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const returnedWord = data.word;
        if (returnedWord && returnedWord.createdAt !== returnedWord.updatedAt) {
          setAlreadyExists(true);
        } else {
          setAdded(true);
        }
      }
    } catch {
      // ignore
    }
  }, [cleanWord, context, definition, timestamp, videoId, videoTitle]);

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={handleShow}
        onMouseLeave={scheduleHide}
        onClick={(e) => {
          e.stopPropagation();
          handleShow();
        }}
      >
        {children}
      </span>
      {show && (
        <div
          ref={tooltipRef}
          className="fixed z-[100] bg-popover text-popover-foreground border border-border rounded-lg shadow-xl p-3 w-[calc(100vw-2rem)] sm:min-w-[260px] sm:max-w-[360px] sm:w-auto break-words overflow-hidden"
          style={tooltipStyle}
          onMouseEnter={clearHideTimer}
          onMouseLeave={scheduleHide}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-base">{cleanWord}</span>
            {bankEntry && (
              <>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                  bankEntry.difficulty === 'easy' ? 'bg-green-500/15 text-green-400 border-green-500/30' :
                  bankEntry.difficulty === 'medium' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' :
                  'bg-red-500/15 text-red-400 border-red-500/30'
                }`}>
                  {bankEntry.difficulty === 'easy' ? '简单' : bankEntry.difficulty === 'medium' ? '中等' : '困难'}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  出现{bankEntry.frequency}次
                </span>
              </>
            )}
          </div>

          <div className="text-sm text-muted-foreground border-t border-border pt-2 min-h-[40px]">
            {loading ? (
              <div className="flex items-center gap-2 py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs">查询中...</span>
              </div>
            ) : error ? (
              <div className="text-xs text-destructive">{error}</div>
            ) : definition ? (
              <div className="text-xs leading-relaxed whitespace-pre-wrap">{definition}</div>
            ) : (
              <div className="text-xs text-muted-foreground">暂无释义</div>
            )}
          </div>

          {bankEntry?.relatedWords && bankEntry.relatedWords.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className="text-[10px] text-muted-foreground mr-1">相关:</span>
              {bankEntry.relatedWords.slice(0, 4).map((rw) => (
                <span key={rw} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/8 text-primary border border-primary/15 cursor-pointer hover:bg-primary/15" onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(rw);
                }}>{rw}</span>
              ))}
            </div>
          )}

          <div className="mt-2 flex gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(cleanWord);
              }}
              className="text-xs px-2 py-1 bg-muted rounded hover:bg-muted/80 transition-colors"
            >
              复制
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAddVocab();
              }}
              disabled={added || alreadyExists}
              className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1 ${
                added
                  ? 'bg-green-500/20 text-green-600 cursor-default'
                  : alreadyExists
                  ? 'bg-amber-500/20 text-amber-600 cursor-default'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            >
              {added ? (
                <>
                  <Check className="h-3 w-3" />
                  已加入
                </>
              ) : alreadyExists ? (
                <>
                  <Check className="h-3 w-3" />
                  已在生词本
                </>
              ) : (
                <>
                  <Plus className="h-3 w-3" />
                  加入生词本
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
