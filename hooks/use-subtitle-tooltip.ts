import { useState, useCallback, useRef } from 'react';
import { lookupWord, VocabBankEntry } from '@/lib/dictionary';

interface TooltipState {
  word: string;
  context: string;
  timestamp: number;
  x: number;
  y: number;
  showBelow: boolean;
}

export function useSubtitleTooltip(videoId?: string, videoTitle?: string) {
  const [tooltipState, setTooltipState] = useState<TooltipState | null>(null);
  const [tooltipDef, setTooltipDef] = useState('');
  const [tooltipLoading, setTooltipLoading] = useState(false);
  const [tooltipAdded, setTooltipAdded] = useState(false);
  const [tooltipExists, setTooltipExists] = useState(false);
  const [tooltipBankEntry, setTooltipBankEntry] = useState<VocabBankEntry | null>(null);

  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTooltipWordRef = useRef<string>('');

  const clearTooltipTimer = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
  }, []);

  const handleWordMouseOver = useCallback((e: React.MouseEvent, editMode: boolean) => {
    if (editMode) return;

    const target = e.target as HTMLElement;
    const wordEl = target.closest('[data-word]') as HTMLElement | null;
    if (!wordEl) return;

    const word = wordEl.dataset.word;
    if (!word) return;

    clearTooltipTimer();

    if (currentTooltipWordRef.current === word && tooltipState) return;

    const rect = wordEl.getBoundingClientRect();
    const showBelow = rect.top < 200;

    currentTooltipWordRef.current = word;
    setTooltipState({
      word,
      context: wordEl.dataset.context || '',
      timestamp: Number(wordEl.dataset.ts || 0),
      x: rect.left + rect.width / 2,
      y: showBelow ? rect.bottom + 8 : rect.top - 8,
      showBelow,
    });
    setTooltipDef('');
    setTooltipLoading(true);
    setTooltipAdded(false);
    setTooltipExists(false);
    setTooltipBankEntry(null);

    const cleanWord = word.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase();
    lookupWord(cleanWord, wordEl.dataset.context || '')
      .then((result) => {
        if (currentTooltipWordRef.current === word) {
          setTooltipDef(result.definition);
          if (result.bankEntry) setTooltipBankEntry(result.bankEntry);
        }
      })
      .catch(() => {
        if (currentTooltipWordRef.current === word) {
          setTooltipDef('查询失败');
        }
      })
      .finally(() => {
        if (currentTooltipWordRef.current === word) {
          setTooltipLoading(false);
        }
      });

    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    fetch(`/api/vocab?check=${encodeURIComponent(cleanWord)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
    })
      .then(r => r.json())
      .then(data => {
        if (currentTooltipWordRef.current === word) {
          if (data.exists) setTooltipExists(true);
        }
      })
      .catch(() => {});
  }, [clearTooltipTimer, tooltipState]);

  const handleWordMouseOut = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('[data-word]') || related?.closest('[data-tooltip]')) return;

    clearTooltipTimer();
    tooltipTimerRef.current = setTimeout(() => {
      currentTooltipWordRef.current = '';
      setTooltipState(null);
    }, 400);
  }, [clearTooltipTimer]);

  const handleTooltipEnter = useCallback(() => {
    clearTooltipTimer();
  }, [clearTooltipTimer]);

  const handleTooltipLeave = useCallback(() => {
    currentTooltipWordRef.current = '';
    setTooltipState(null);
  }, []);

  const handleAddVocab = useCallback(async () => {
    if (!tooltipState) return;
    const cleanWord = tooltipState.word.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase();

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
          definition: tooltipDef || '（暂无释义）',
          context: tooltipState.context,
          videoId: videoId || '',
          videoTitle: videoTitle || '',
          timestamp: tooltipState.timestamp,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (tooltipExists) {
          setTooltipExists(true);
        } else if (data.word) {
          const created = new Date(data.word.createdAt).getTime();
          const now = Date.now();
          if (now - created < 3000) {
            setTooltipAdded(true);
          } else {
            setTooltipExists(true);
          }
        }
      }
    } catch {}
  }, [tooltipState, tooltipDef, videoId, videoTitle, tooltipExists]);

  return {
    tooltipState,
    tooltipDef,
    tooltipLoading,
    tooltipAdded,
    tooltipExists,
    tooltipBankEntry,
    handleWordMouseOver,
    handleWordMouseOut,
    handleTooltipEnter,
    handleTooltipLeave,
    handleAddVocab,
  };
}
