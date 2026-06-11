'use client';

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { ChevronDown, ChevronRight, Play, Plus, Check, Search, Loader2 } from 'lucide-react';
import { getVideoVocab, LearningPriority, VideoVocabEntry, ExamLevel } from '@/lib/word-classify';
import { lookupWord } from '@/lib/dictionary';

interface VideoVocabPanelProps {
  subtitles: import('@/lib/vtt-parser').Subtitle[];
  onSeekToSubtitle?: (index: number) => void;
  onAddVocab?: (word: string) => void;
  /** Set of words already in user's vocab book */
  vocabBookWords?: Set<string>;
}

const PRIORITY_CONFIG: Record<LearningPriority, {
  label: string;
  description: string;
  emptyText: string;
  icon: string;
  headerClass: string;
  badgeClass: string;
}> = {
  core: {
    label: '核心词',
    description: '视频中反复出现的重点词汇，优先掌握',
    emptyText: '没有核心词',
    icon: '🔥',
    headerClass: 'text-orange-600 dark:text-orange-400',
    badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  },
  advanced: {
    label: '进阶词',
    description: '视频中的生词，建议学习',
    emptyText: '没有进阶词',
    icon: '📘',
    headerClass: 'text-blue-600 dark:text-blue-400',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  basic: {
    label: '基础词',
    description: '常见基础词汇，可跳过',
    emptyText: '没有基础词',
    icon: '📝',
    headerClass: 'text-gray-500 dark:text-gray-400',
    badgeClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400',
  },
};

const EXAM_LEVEL_CONFIG: Record<ExamLevel, { label: string; className: string }> = {
  '四级': { label: '四级', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  '六级': { label: '六级', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  '考研': { label: '考研', className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  '雅思': { label: '雅思', className: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  '托福': { label: '托福', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  '专八': { label: '专八', className: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300' },
};

export function VideoVocabPanel({
  subtitles,
  onSeekToSubtitle,
  onAddVocab,
  vocabBookWords,
}: VideoVocabPanelProps) {
  const vocabEntries = useMemo(() => getVideoVocab(subtitles), [subtitles]);
  const [expandedGroups, setExpandedGroups] = useState<Set<LearningPriority>>(new Set<LearningPriority>(['core', 'advanced']));
  const [addingWord, setAddingWord] = useState<string | null>(null);
  // Lookup cache: word -> definition (from batch lookup or AI lookup)
  const [lookupCache, setLookupCache] = useState<Record<string, string>>({});
  const [batchLookupLoading, setBatchLookupLoading] = useState(false);
  const [batchLookupDone, setBatchLookupDone] = useState(false);

  // Batch lookup words without definitions on mount
  useEffect(() => {
    if (batchLookupDone || batchLookupLoading) return;
    const wordsWithoutDef = vocabEntries.filter(e => !e.definition).map(e => e.word);
    if (wordsWithoutDef.length === 0) {
      setBatchLookupDone(true);
      return;
    }

    setBatchLookupLoading(true);
    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    fetch('/api/vocab/batch-lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ words: wordsWithoutDef }),
    })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.results) {
          const newCache: Record<string, string> = {};
          for (const [word, entry] of Object.entries(data.results as Record<string, { phonetic?: string; definition: string; pos?: string; source?: string } | null>)) {
            if (entry) {
              const parts: string[] = [];
              if (entry.phonetic) parts.push(entry.phonetic);
              if (entry.definition) parts.push(entry.definition);
              if (parts.length > 0) newCache[word] = parts.join('\n');
            }
          }
          if (Object.keys(newCache).length > 0) {
            setLookupCache(prev => ({ ...prev, ...newCache }));
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        setBatchLookupLoading(false);
        setBatchLookupDone(true);
      });
  }, [vocabEntries, batchLookupDone, batchLookupLoading]);

  const grouped = useMemo(() => {
    const groups: Record<LearningPriority, VideoVocabEntry[]> = { core: [], advanced: [], basic: [] };
    for (const entry of vocabEntries) {
      groups[entry.priority].push(entry);
    }
    return groups;
  }, [vocabEntries]);

  const toggleGroup = useCallback((p: LearningPriority) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }, []);

  const handleAddVocab = useCallback(async (word: string) => {
    if (!onAddVocab) return;
    setAddingWord(word);
    try {
      await onAddVocab(word);
    } finally {
      setAddingWord(null);
    }
  }, [onAddVocab]);

  const handleLookup = useCallback(async (word: string) => {
    if (lookupCache[word]) return;
    try {
      const result = await lookupWord(word);
      if (result.definition) {
        setLookupCache(prev => ({ ...prev, [word]: result.definition }));
      }
    } catch {
      // lookup failed silently
    }
  }, [lookupCache]);

  const totalVocab = vocabEntries.length;
  const coreCount = grouped.core.length;
  const advancedCount = grouped.advanced.length;
  const basicCount = grouped.basic.length;

  if (totalVocab === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        暂无词汇
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3">
      {/* Summary */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pb-2 border-b border-border">
        <span>共 {totalVocab} 个词</span>
        {coreCount > 0 && <span className={PRIORITY_CONFIG.core.badgeClass + ' px-1.5 py-0.5 rounded-full'}>核心 {coreCount}</span>}
        {advancedCount > 0 && <span className={PRIORITY_CONFIG.advanced.badgeClass + ' px-1.5 py-0.5 rounded-full'}>进阶 {advancedCount}</span>}
        {basicCount > 0 && <span className={PRIORITY_CONFIG.basic.badgeClass + ' px-1.5 py-0.5 rounded-full'}>基础 {basicCount}</span>}
        {batchLookupLoading && (
          <span className="flex items-center gap-1 text-blue-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            查词中...
          </span>
        )}
      </div>

      {/* Priority groups */}
      {(['core', 'advanced', 'basic'] as LearningPriority[]).map(priority => {
        const entries = grouped[priority];
        if (entries.length === 0) return null;
        const config = PRIORITY_CONFIG[priority];
        const isExpanded = expandedGroups.has(priority);

        return (
          <div key={priority}>
            {/* Group header */}
            <button
              onClick={() => toggleGroup(priority)}
              className="w-full flex items-center gap-2 py-1.5 group"
            >
              {isExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className={`text-sm font-medium ${config.headerClass}`}>
                {config.icon} {config.label}
              </span>
              <span className="text-xs text-muted-foreground">{entries.length}词</span>
              <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
                — {config.description}
              </span>
            </button>

            {/* Word list */}
            {isExpanded && (
              <div className="mt-1 space-y-1.5 pl-1">
                {entries.map(entry => (
                  <VocabCard
                    key={entry.word}
                    entry={entry}
                    priority={priority}
                    lookedUpDef={lookupCache[entry.word]}
                    onSeek={onSeekToSubtitle ? () => onSeekToSubtitle(entry.firstIndex) : undefined}
                    onAddVocab={onAddVocab ? () => handleAddVocab(entry.word) : undefined}
                    onLookup={() => handleLookup(entry.word)}
                    adding={addingWord === entry.word}
                    inVocabBook={vocabBookWords?.has(entry.word) ?? false}
                    batchLoading={batchLookupLoading}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VocabCard({
  entry,
  priority,
  lookedUpDef,
  onSeek,
  onAddVocab,
  onLookup,
  adding,
  inVocabBook,
  batchLoading,
}: {
  entry: VideoVocabEntry;
  priority: LearningPriority;
  lookedUpDef?: string;
  onSeek?: () => void;
  onAddVocab?: () => void;
  onLookup?: () => void;
  adding: boolean;
  inVocabBook: boolean;
  batchLoading?: boolean;
}) {
  const isCore = priority === 'core';
  const [looking, setLooking] = useState(false);
  const hasDef = !!(entry.definition || lookedUpDef);
  const displayDef = lookedUpDef || entry.definition;

  const handleLookup = async () => {
    if (!onLookup || looking) return;
    setLooking(true);
    try {
      await onLookup();
    } finally {
      setLooking(false);
    }
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2 transition-colors ${
        isCore
          ? 'border-orange-200 bg-orange-50/50 dark:border-orange-800/40 dark:bg-orange-900/10'
          : 'border-border/60 bg-card hover:bg-muted/40'
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Word */}
        <span className={`text-sm font-medium ${isCore ? 'text-foreground' : 'text-foreground/90'}`}>
          {entry.word}
        </span>

        {/* POS tag */}
        {entry.pos && (
          <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
            {entry.pos}
          </span>
        )}

        {/* Exam level tag */}
        {entry.examLevel && EXAM_LEVEL_CONFIG[entry.examLevel] && (
          <span className={`text-[10px] px-1 py-0.5 rounded ${EXAM_LEVEL_CONFIG[entry.examLevel].className}`}>
            {EXAM_LEVEL_CONFIG[entry.examLevel].label}
          </span>
        )}

        {/* Frequency badge */}
        {entry.count > 1 && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            isCore
              ? 'bg-orange-200/60 text-orange-700 dark:bg-orange-800/40 dark:text-orange-300'
              : 'bg-muted text-muted-foreground'
          }`}>
            ×{entry.count}
          </span>
        )}

        <div className="flex-1" />

        {/* Loading state during batch lookup */}
        {!hasDef && batchLoading && (
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        )}

        {/* Manual lookup button: only show after batch is done and still no definition */}
        {!hasDef && !batchLoading && onLookup && (
          <button
            onClick={handleLookup}
            disabled={looking}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="查词"
          >
            {looking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          </button>
        )}

        {/* Actions */}
        {onSeek && (
          <button
            onClick={onSeek}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="跳转到首次出现"
          >
            <Play className="h-3 w-3" />
          </button>
        )}
        {onAddVocab && (
          <button
            onClick={onAddVocab}
            disabled={adding || inVocabBook}
            className={`p-1 rounded transition-colors ${
              inVocabBook
                ? 'text-green-600 dark:text-green-400'
                : adding
                ? 'text-muted-foreground animate-pulse'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            title={inVocabBook ? '已在生词本' : '加入生词本'}
          >
            {inVocabBook ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          </button>
        )}
      </div>

      {/* Definition */}
      {displayDef && (
        <div className="mt-1 text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
          {displayDef}
        </div>
      )}
    </div>
  );
}
