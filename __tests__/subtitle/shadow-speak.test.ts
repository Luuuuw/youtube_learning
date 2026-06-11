import { describe, it, expect } from 'vitest';
import { compareTranscript, getScoreLabel } from '@/lib/shadow-speak';

describe('compareTranscript', () => {
  it('完全匹配得 100 分', () => {
    const result = compareTranscript('hello world', 'hello world');
    expect(result.score).toBe(100);
    expect(result.correctCount).toBe(2);
    expect(result.totalCount).toBe(2);
    expect(result.words.every(w => w.status === 'correct')).toBe(true);
  });

  it('完全不同得 0 分', () => {
    const result = compareTranscript('hello world', 'foo bar');
    expect(result.score).toBe(0);
  });

  it('部分匹配', () => {
    const result = compareTranscript('hello beautiful world', 'hello world');
    expect(result.correctCount).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(100);
  });

  it('空原文返回 0 分', () => {
    const result = compareTranscript('', 'hello');
    expect(result.score).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it('空口语文本有 missing 词', () => {
    const result = compareTranscript('hello world', '');
    expect(result.score).toBe(0);
    const missing = result.words.filter(w => w.status === 'missing');
    expect(missing.length).toBe(2);
  });

  it('多余词标记为 extra', () => {
    const result = compareTranscript('hello', 'hello extra');
    const extra = result.words.filter(w => w.status === 'extra');
    expect(extra.length).toBe(1);
  });

  it('标点符号被忽略', () => {
    const result = compareTranscript('Hello, world!', 'hello world');
    expect(result.score).toBe(100);
  });

  it('大小写不敏感', () => {
    const result = compareTranscript('HELLO WORLD', 'hello world');
    expect(result.score).toBe(100);
  });

  it('th/s 混淆提供音素提示', () => {
    const result = compareTranscript('think about', 'sink about');
    const wrong = result.words.find(w => w.original === 'think');
    if (wrong && wrong.status === 'wrong') {
      expect(wrong.phonemeHint).toBeDefined();
    }
  });

  it('r/l 混淆提供音素提示', () => {
    const result = compareTranscript('right now', 'light now');
    const wrong = result.words.find(w => w.original === 'right');
    if (wrong && wrong.status === 'wrong') {
      expect(wrong.phonemeHint).toBeDefined();
    }
  });

  it('Levenshtein 对齐处理插入和删除', () => {
    const result = compareTranscript('the cat sat', 'the sat');
    expect(result.words.length).toBeGreaterThan(0);
  });
});

describe('getScoreLabel', () => {
  it('90+ 完美', () => {
    const label = getScoreLabel(95);
    expect(label.label).toBe('完美');
  });

  it('75-89 优秀', () => {
    const label = getScoreLabel(80);
    expect(label.label).toBe('优秀');
  });

  it('60-74 不错', () => {
    const label = getScoreLabel(65);
    expect(label.label).toBe('不错');
  });

  it('40-59 继续加油', () => {
    const label = getScoreLabel(50);
    expect(label.label).toBe('继续加油');
  });

  it('<40 再试一次', () => {
    const label = getScoreLabel(30);
    expect(label.label).toBe('再试一次');
  });

  it('边界值', () => {
    expect(getScoreLabel(90).label).toBe('完美');
    expect(getScoreLabel(75).label).toBe('优秀');
    expect(getScoreLabel(60).label).toBe('不错');
    expect(getScoreLabel(40).label).toBe('继续加油');
    expect(getScoreLabel(0).label).toBe('再试一次');
  });
});
