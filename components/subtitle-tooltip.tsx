import React, { useMemo } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { VocabBankEntry } from '@/lib/dictionary';

interface TooltipState {
  word: string;
  context: string;
  timestamp: number;
  x: number;
  y: number;
  showBelow: boolean;
}

interface SubtitleTooltipProps {
  state: TooltipState;
  definition: string;
  loading: boolean;
  added: boolean;
  exists: boolean;
  bankEntry?: VocabBankEntry | null;
  onEnter: () => void;
  onLeave: () => void;
  onCopy: () => void;
  onAddVocab: () => void;
}

export function SubtitleTooltip({
  state,
  definition,
  loading,
  added,
  exists,
  bankEntry,
  onEnter,
  onLeave,
  onCopy,
  onAddVocab,
}: SubtitleTooltipProps) {
  const tooltipStyle = useMemo<React.CSSProperties>(() => {
    if (!state) return {};

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const edgePadding = 16;
    const desktopHalfWidth = 180;
    const top = Math.max(10, state.y - (state.showBelow ? 0 : 10));

    if (viewportWidth < 640) {
      return {
        left: `${edgePadding}px`,
        right: `${edgePadding}px`,
        top: `${top}px`,
        transform: state.showBelow ? 'translateY(0)' : 'translateY(-100%)',
      };
    }

    const clampedX = Math.min(
      Math.max(state.x, edgePadding + desktopHalfWidth),
      viewportWidth - edgePadding - desktopHalfWidth
    );

    return {
      left: `${clampedX}px`,
      top: `${top}px`,
      transform: state.showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    };
  }, [state]);

  const cleanWord = state.word.replace(/[.,!?;:'"()\[\]{}]/g, '').toLowerCase();

  return (
    <div
      data-tooltip
      className="fixed z-[100] bg-popover text-popover-foreground border border-border rounded-lg shadow-xl p-3 w-[calc(100vw-2rem)] sm:min-w-[280px] sm:max-w-[400px] sm:w-auto break-words overflow-hidden"
      style={tooltipStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-semibold text-base">{cleanWord}</span>

        {bankEntry && (
          <>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${
                bankEntry.difficulty === 'easy'
                  ? 'bg-green-500/15 text-green-400 border-green-500/30'
                  : bankEntry.difficulty === 'medium'
                  ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
                  : 'bg-red-500/15 text-red-400 border-red-500/30'
              }`}
            >
              {bankEntry.difficulty === 'easy'
                ? '简单'
                : bankEntry.difficulty === 'medium'
                ? '中等'
                : '困难'}
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
            <span
              key={rw}
              className="text-[10px] px-1.5 py-0.5 rounded bg-primary/8 text-primary border border-primary/15 cursor-pointer hover:bg-primary/15"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(rw);
              }}
            >
              {rw}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2 flex gap-1.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          className="text-xs px-2 py-1 bg-muted rounded hover:bg-muted/80 transition-colors"
        >
          复制
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddVocab();
          }}
          disabled={added || exists}
          className={`text-xs px-2 py-1 rounded transition-colors flex items-center gap-1 ${
            added
              ? 'bg-green-500/20 text-green-600 cursor-default'
              : exists
              ? 'bg-amber-500/20 text-amber-600 cursor-default'
              : 'bg-muted hover:bg-muted/80'
          }`}
        >
          {added ? (
            <>
              <Check className="h-3 w-3" />
              已加入
            </>
          ) : exists ? (
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
  );
}
