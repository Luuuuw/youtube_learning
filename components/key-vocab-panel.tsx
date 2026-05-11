import React, { useMemo } from 'react';
import {
  CATEGORY_CONFIG,
  WordCategory,
  WordClassResult,
  getKeyVocabFromSubtitles,
} from '@/lib/word-classify';

const CATEGORY_ORDER: WordCategory[] = ['verb', 'noun', 'adj', 'adv', 'prep', 'conj', 'pron', 'other'];

interface KeyVocabPanelProps {
  subtitles: import('@/lib/vtt-parser').Subtitle[];
}

export function KeyVocabPanel({ subtitles }: KeyVocabPanelProps) {
  const keyVocabMap = useMemo(() => getKeyVocabFromSubtitles(subtitles), [subtitles]);

  const groupedVocab = useMemo(() => {
    const groups = new Map<WordCategory, { word: string; count: number }[]>();
    keyVocabMap.forEach((info, word) => {
      if (!groups.has(info.category)) groups.set(info.category, []);
      groups.get(info.category)!.push({ word, count: info.count });
    });
    groups.forEach((words) => words.sort((a, b) => b.count - a.count));
    return groups;
  }, [keyVocabMap]);

  if (keyVocabMap.size === 0) {
    return (
      <div className="text-center text-muted-foreground py-12">
        暂无重点词汇
      </div>
    );
  }

  return (
    <div className="space-y-4 p-3">
      {CATEGORY_ORDER.map((cat) => {
        const words = groupedVocab.get(cat);
        if (!words || words.length === 0) return null;

        const config = CATEGORY_CONFIG[cat];
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                {config.label}
              </span>
              <span className="text-xs text-muted-foreground">{words.length}词</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {words.map(({ word, count }) => (
                <span
                  key={word}
                  data-word={word}
                  className={`px-2 py-1 rounded-md text-xs cursor-pointer transition-colors hover:opacity-80 ${config.bgColor} ${config.color}`}
                >
                  {word}
                  {count > 1 && <span className="ml-1 opacity-60">×{count}</span>}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
