'use client';

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Subtitle, WordTiming, formatTime } from '@/lib/vtt-parser';
import {
  CATEGORY_CONFIG,
  WordCategory,
  WordClassResult,
  classifyWord,
  getVideoVocab,
} from '@/lib/word-classify';
import { binarySearchSubtitleIndex, buildSubtitleTranslationMap } from '@/lib/subtitle-sync';

import { useSubtitleSync } from '@/hooks/use-subtitle-sync';
import { useSubtitleTranslation } from '@/hooks/use-subtitle-translation';
import { useSubtitleEdit } from '@/hooks/use-subtitle-edit';
import { useSubtitleTooltip } from '@/hooks/use-subtitle-tooltip';
import { useAutoScroll } from '@/hooks/use-auto-scroll';

import { SubtitleHeader } from './subtitle-header';
import { VideoVocabPanel } from './video-vocab-panel';
import { SubtitleTooltip } from './subtitle-tooltip';

interface SubtitlePanelProps {
  subtitles: Subtitle[];
  zhSubtitles: Subtitle[];
  currentTime: number;
  onSeek: (time: number) => void;
  videoId?: string;
  videoTitle?: string;
  onZhSubtitlesUpdate?: (zhSubtitles: Subtitle[]) => void;
  autoScroll?: boolean;
  highlightWords?: boolean;
  isAdmin?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement>;
}

type TabType = 'subtitles' | 'keyvocab';

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function getActiveWordIndex(
  text: string,
  currentTime: number,
  startTime: number,
  endTime: number,
  wordTimings?: WordTiming[]
): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;

  if (wordTimings && wordTimings.length === words.length) {
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      if (currentTime >= wordTimings[i].startTime) {
        return i;
      }
    }
    return 0;
  }

  const duration = Math.max(endTime - startTime, 0.001);
  const progress = Math.max(0, Math.min(1, (currentTime - startTime) / duration));
  return Math.min(Math.floor(progress * words.length), words.length - 1);
}

function estimateLineCount(text: string, charsPerLine: number): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / charsPerLine));
}

interface SubtitleRowProps {
  subtitle: Subtitle;
  isActive: boolean;
  zhText: string | null;
  showZh: boolean;
  editMode: boolean;
  editValue: string;
  onClick: (subtitle: Subtitle) => void;
  onEditChange: (id: number, value: string) => void;
  registerHeight: (id: number, height: number) => void;
  renderSubtitleWords: (text: string, subtitle: Subtitle, isActive: boolean) => React.ReactNode;
}

const SubtitleRow = memo(function SubtitleRow({
  subtitle,
  isActive,
  zhText,
  showZh,
  editMode,
  editValue,
  onClick,
  onEditChange,
  registerHeight,
  renderSubtitleWords,
}: SubtitleRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;

    registerHeight(subtitle.id, element.getBoundingClientRect().height);

    const ResizeObserverImpl = (globalThis as typeof globalThis & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (!ResizeObserverImpl) return;

    const observer = new ResizeObserverImpl((entries) => {
      const entry = entries[0];
      if (entry) {
        registerHeight(subtitle.id, entry.contentRect.height);
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [registerHeight, subtitle.id, zhText, showZh, editMode, editValue]);

  return (
    <div className={isActive ? 'relative z-10' : 'relative'} data-subtitle-id={subtitle.id}>
      <div
        ref={rowRef}
        onClick={() => onClick(subtitle)}
        className={`rounded-xl border px-3 py-3 transition-all duration-200 ${
          isActive
            ? 'border-primary/60 bg-primary/15 shadow-sm'
            : 'border-border/60 bg-card hover:border-border hover:bg-muted/60'
        } ${editMode ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <div className="mb-2 text-xs text-muted-foreground tabular-nums">
          {formatTime(subtitle.startTime)}
        </div>
        <div className="text-sm leading-7 text-foreground break-words">
          {renderSubtitleWords(subtitle.text, subtitle, isActive)}
        </div>
        {editMode ? (
          <textarea
            value={editValue}
            onChange={(event) => onEditChange(subtitle.id, event.target.value)}
            className="mt-2 w-full resize-none rounded-lg border border-border bg-muted px-3 py-2 text-sm leading-6 text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring break-words"
            rows={Math.max(2, estimateLineCount(editValue || ' ', 28))}
            onClick={(event) => event.stopPropagation()}
          />
        ) : showZh && zhText ? (
          <div className="mt-2 border-t border-border/60 pt-2 text-sm leading-6 text-muted-foreground break-words [word-break:break-word]">
            {zhText}
          </div>
        ) : null}
      </div>
    </div>
  );
});

export default function SubtitlePanel({
  subtitles,
  zhSubtitles,
  currentTime,
  onSeek,
  videoId = '',
  videoTitle = '',
  onZhSubtitlesUpdate,
  autoScroll: autoScrollProp = true,
  highlightWords: highlightWordsProp = true,
  isAdmin = false,
  videoRef,
}: SubtitlePanelProps) {
  const [showZh, setShowZh] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<TabType>('subtitles');
  const [highlightEnabled, setHighlightEnabled] = useState(highlightWordsProp);
  const [preciseTime, setPreciseTime] = useState(currentTime);

  const debouncedSearch = useDebounce(searchQuery, 300);

  useEffect(() => setHighlightEnabled(highlightWordsProp), [highlightWordsProp]);

  useEffect(() => {
    const nextIndex = binarySearchSubtitleIndex(subtitles, currentTime);
  }, [currentTime, subtitles]);

  const {
    activeIndex,
    handleSeekDetection,
  } = useSubtitleSync(subtitles, currentTime);

  const {
    zhSubtitles: translationZhSubtitles,
    translating,
    error: translateError,
    translate,
    hasZhSubtitles,
  } = useSubtitleTranslation(videoId, subtitles, zhSubtitles, onZhSubtitlesUpdate);

  const subtitleZhIdMap = useMemo(() => {
    const m = new Map<number, string>();
    for (const zh of translationZhSubtitles) {
      if (zh.text.trim()) m.set(zh.id, zh.text);
    }
    return m;
  }, [translationZhSubtitles]);

  const subtitleZhMap = useMemo(() => {
    if (subtitleZhIdMap.size > 0) return subtitleZhIdMap;
    return buildSubtitleTranslationMap(subtitles, translationZhSubtitles);
  }, [subtitleZhIdMap, subtitles, translationZhSubtitles]);

  const getZhText = useCallback((enSub: Subtitle): string | null => {
    if (enSub.translation) return enSub.translation;
    if (translationZhSubtitles.length === 0) return null;
    return subtitleZhMap.get(enSub.id) ?? null;
  }, [translationZhSubtitles.length, subtitleZhMap]);

  const {
    editMode,
    editMap,
    saving,
    enterEditMode,
    cancelEditMode,
    handleEditChange,
    handleSave,
  } = useSubtitleEdit(videoId, subtitles, translationZhSubtitles, subtitleZhMap, onZhSubtitlesUpdate);

  const {
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
  } = useSubtitleTooltip(videoId, videoTitle);

  const {
    followActiveSubtitle,
    scrollViewportRef,
    handleScroll,
    handleResumeAutoScroll,
    scrollToIndex,
  } = useAutoScroll(autoScrollProp);

  useEffect(() => {
    if (handleSeekDetection(autoScrollProp)) {
      // seek detected
    }
  }, [autoScrollProp, currentTime, handleSeekDetection]);

  useEffect(() => {
    if (!videoRef?.current) return;
    let rafId: number;
    let lastUpdate = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused) {
        const now = performance.now();
        if (now - lastUpdate >= 32) {
          lastUpdate = now;
          setPreciseTime(video.currentTime);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [videoRef]);

  const activeSubtitle = activeIndex >= 0 ? subtitles[activeIndex] : null;

  const activeWordIdx = useMemo(() => {
    if (!activeSubtitle) return -1;
    return getActiveWordIndex(activeSubtitle.text, preciseTime, activeSubtitle.startTime, activeSubtitle.endTime, activeSubtitle.wordTimings);
  }, [activeSubtitle, preciseTime]);

  const filteredSubtitles = useMemo(() => {
    if (!debouncedSearch) return subtitles;
    const q = debouncedSearch.toLowerCase();
    return subtitles.filter(
      (s) => s.text.toLowerCase().includes(q) || (getZhText(s)?.toLowerCase().includes(q) ?? false)
    );
  }, [debouncedSearch, subtitles, getZhText]);

  const filteredIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    filteredSubtitles.forEach((subtitle, index) => map.set(subtitle.id, index));
    return map;
  }, [filteredSubtitles]);

  const registerRowHeight = useCallback((_id: number, _height: number) => {}, []);

  const handleSubtitleClick = useCallback((subtitle: Subtitle) => {
    if (editMode) return;
    onSeek(subtitle.startTime);
    if (autoScrollProp) {
      // handled by useAutoScroll
    }
  }, [autoScrollProp, editMode, onSeek]);

  const wordClassCache = useMemo(() => new Map<string, WordClassResult>(), []);
  const getWordClass = useCallback((word: string): WordClassResult => {
    const cached = wordClassCache.get(word);
    if (cached) return cached;
    const result = classifyWord(word);
    wordClassCache.set(word, result);
    return result;
  }, [wordClassCache]);

  const renderSubtitleWords = useCallback((text: string, subtitle: Subtitle, isActive: boolean) => {
    const parts = text.split(/(\s+)/);
    let wordCounter = 0;
    return parts.map((part, i) => {
      if (!part.trim()) return <span key={i}>{part}</span>;
      const cls = getWordClass(part);
      const currentWordIdx = wordCounter++;
      const isCurrentWord = isActive && currentWordIdx === activeWordIdx;

      const className = isCurrentWord
        ? 'bg-green-400/25 text-green-700 dark:text-green-300 rounded px-0.5 ring-2 ring-green-500/70 shadow-[0_0_6px_rgba(34,197,94,0.25)] transition-all duration-75 cursor-pointer'
        : highlightEnabled && cls.isKeyVocab
          ? `${cls.bgColor} ${cls.color} rounded px-0.5 cursor-pointer transition-colors`
          : 'hover:bg-primary/10 hover:underline underline-offset-2 px-0.5 rounded cursor-pointer transition-colors';

      return (
        <span
          key={i}
          data-word={part}
          data-context={subtitle.text}
          data-ts={subtitle.startTime}
          className={className}
        >
          {part}
        </span>
      );
    });
  }, [highlightEnabled, getWordClass, activeWordIdx]);

  const activeVisibleIndex = activeSubtitle ? (filteredIndexMap.get(activeSubtitle.id) ?? -1) : -1;

  useEffect(() => {
    if (!autoScrollProp || !followActiveSubtitle || activeVisibleIndex < 0) return;
    scrollToIndex(activeVisibleIndex, 'smooth');
  }, [activeVisibleIndex, autoScrollProp, followActiveSubtitle, scrollToIndex]);

  const keyVocabCount = useMemo(() => getVideoVocab(subtitles).length, [subtitles]);

  return (
    <div className="relative flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <SubtitleHeader
        tab={tab}
        onTabChange={setTab}
        showZh={showZh}
        onToggleZh={() => setShowZh(!showZh)}
        hasZhSubtitles={hasZhSubtitles}
        onTranslate={() => {
          setShowZh(true);
          translate();
        }}
        translating={translating}
        translateError={translateError}
        isAdmin={isAdmin}
        editMode={editMode}
        onEdit={enterEditMode}
        onSave={async () => {
          try {
            await handleSave();
          } catch (e) {
            console.error('保存失败:', e);
          }
        }}
        onCancel={cancelEditMode}
        saving={saving}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        highlightEnabled={highlightEnabled}
        onToggleHighlight={() => setHighlightEnabled(!highlightEnabled)}
        onResumeAutoScroll={handleResumeAutoScroll}
        keyVocabCount={keyVocabCount}
      />

      <div
        ref={scrollViewportRef}
        onScroll={handleScroll}
        onMouseOver={(e) => handleWordMouseOver(e, editMode)}
        onMouseOut={handleWordMouseOut}
        className="flex-1 overflow-y-auto min-h-0"
      >
        {tab === 'subtitles' ? (
          filteredSubtitles.length === 0 ? (
            <div className="px-3 py-12 text-center text-muted-foreground">
              {subtitles.length === 0 ? '暂无字幕' : '没有匹配的字幕'}
            </div>
          ) : (
            <div className="space-y-2 p-3">
              {filteredSubtitles.map((subtitle) => {
                const zhText =
                  editMode
                    ? editMap.get(subtitle.id) ?? subtitleZhMap.get(subtitle.id) ?? ''
                    : showZh && hasZhSubtitles
                      ? getZhText(subtitle)
                      : null;

                return (
                  <SubtitleRow
                    key={subtitle.id}
                    subtitle={subtitle}
                    isActive={activeSubtitle?.id === subtitle.id}
                    zhText={zhText}
                    showZh={showZh && hasZhSubtitles}
                    editMode={editMode}
                    editValue={editMap.get(subtitle.id) ?? subtitleZhMap.get(subtitle.id) ?? ''}
                    onClick={handleSubtitleClick}
                    onEditChange={handleEditChange}
                    registerHeight={registerRowHeight}
                    renderSubtitleWords={renderSubtitleWords}
                  />
                );
              })}
            </div>
          )
        ) : (
          <VideoVocabPanel
            subtitles={subtitles}
            onSeekToSubtitle={(index) => {
              if (index >= 0 && index < subtitles.length) {
                onSeek(subtitles[index].startTime);
              }
            }}
            onAddVocab={async (word) => {
              const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : null;
              if (!token) return;
              const context = subtitles.find(s => s.text.toLowerCase().includes(word))?.text || '';
              const timestamp = subtitles.find(s => s.text.toLowerCase().includes(word))?.startTime || 0;
              await fetch('/api/vocab', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ word, context, videoId, videoTitle, timestamp }),
              });
            }}
          />
        )}
      </div>

      {tab === 'subtitles' && autoScrollProp && !followActiveSubtitle && activeVisibleIndex >= 0 && (
        <button
          onClick={() => {
            handleResumeAutoScroll();
            scrollToIndex(activeVisibleIndex, 'smooth');
          }}
          className="absolute bottom-4 right-4 z-20 rounded-full border border-primary/30 bg-background/95 px-3 py-2 text-xs font-medium text-primary shadow-lg backdrop-blur-sm transition-colors hover:bg-primary/10"
        >
          回到当前进度
        </button>
      )}

      {tooltipState && !editMode && (
        <SubtitleTooltip
          state={tooltipState}
          definition={tooltipDef}
          loading={tooltipLoading}
          added={tooltipAdded}
          exists={tooltipExists}
          bankEntry={tooltipBankEntry}
          onEnter={handleTooltipEnter}
          onLeave={handleTooltipLeave}
          onCopy={() => navigator.clipboard.writeText(tooltipState.word.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase())}
          onAddVocab={handleAddVocab}
        />
      )}
    </div>
  );
}
