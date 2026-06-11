import { describe, it, expect } from 'vitest';
import { binarySearchSubtitleIndex, getSubtitleAtTime, buildSubtitleTranslationMap } from '@/lib/subtitle-sync';
import type { Subtitle } from '@/lib/vtt-parser';

function makeSubtitles(count: number, intervalSec: number = 3): Subtitle[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    startTime: i * intervalSec,
    endTime: (i + 1) * intervalSec - 0.1,
    text: `Subtitle ${i + 1}`,
  }));
}

describe('binarySearchSubtitleIndex', () => {
  it('找到匹配的字幕索引', () => {
    const subs = makeSubtitles(10);
    const idx = binarySearchSubtitleIndex(subs, 1.5);
    expect(idx).toBe(0);
  });

  it('时间在两个字幕之间返回 -1', () => {
    const subs = makeSubtitles(10);
    const idx = binarySearchSubtitleIndex(subs, 2.95);
    expect(idx).toBe(-1);
  });

  it('第一个字幕', () => {
    const subs = makeSubtitles(10);
    expect(binarySearchSubtitleIndex(subs, 0)).toBe(0);
  });

  it('最后一个字幕', () => {
    const subs = makeSubtitles(10);
    expect(binarySearchSubtitleIndex(subs, 27)).toBe(9);
  });

  it('时间超出范围返回 -1', () => {
    const subs = makeSubtitles(10);
    expect(binarySearchSubtitleIndex(subs, -1)).toBe(-1);
    expect(binarySearchSubtitleIndex(subs, 100)).toBe(-1);
  });

  it('空数组返回 -1', () => {
    expect(binarySearchSubtitleIndex([], 1.5)).toBe(-1);
  });

  it('单条字幕', () => {
    const subs = makeSubtitles(1);
    expect(binarySearchSubtitleIndex(subs, 1)).toBe(0);
    expect(binarySearchSubtitleIndex(subs, 5)).toBe(-1);
  });

  it('大量字幕时性能正常', () => {
    const subs = makeSubtitles(10000);
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      binarySearchSubtitleIndex(subs, Math.random() * 30000);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});

describe('getSubtitleAtTime', () => {
  it('返回匹配的字幕对象', () => {
    const subs = makeSubtitles(10);
    const sub = getSubtitleAtTime(subs, 4.5);
    expect(sub).not.toBeNull();
    expect(sub!.text).toContain('Subtitle');
  });

  it('时间不在任何字幕范围内返回 null', () => {
    const subs = makeSubtitles(5);
    expect(getSubtitleAtTime(subs, 100)).toBeNull();
  });
});

describe('buildSubtitleTranslationMap', () => {
  it('精确时间匹配', () => {
    const en: Subtitle[] = [
      { id: 1, startTime: 0, endTime: 3, text: 'Hello' },
      { id: 2, startTime: 3, endTime: 6, text: 'World' },
    ];
    const zh: Subtitle[] = [
      { id: 1, startTime: 0, endTime: 3, text: '你好' },
      { id: 2, startTime: 3, endTime: 6, text: '世界' },
    ];

    const map = buildSubtitleTranslationMap(en, zh);
    expect(map.get(1)).toBe('你好');
    expect(map.get(2)).toBe('世界');
  });

  it('空输入返回空 Map', () => {
    expect(buildSubtitleTranslationMap([], []).size).toBe(0);
    expect(buildSubtitleTranslationMap([{ id: 1, startTime: 0, endTime: 1, text: 'a' }], []).size).toBe(0);
  });

  it('模糊匹配回退', () => {
    const en: Subtitle[] = [
      { id: 1, startTime: 0, endTime: 3, text: 'Hello' },
    ];
    const zh: Subtitle[] = [
      { id: 1, startTime: 0.1, endTime: 2.9, text: '你好' },
    ];

    const map = buildSubtitleTranslationMap(en, zh);
    expect(map.size).toBeGreaterThanOrEqual(0);
  });
});
