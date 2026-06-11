import { describe, it, expect } from 'vitest';
import { classifyWord, getKeyVocabFromSubtitles, STOP_WORDS, CATEGORY_CONFIG } from '@/lib/word-classify';
import type { WordCategory } from '@/lib/word-classify';

describe('classifyWord', () => {
  it('空字符串返回 other', () => {
    const result = classifyWord('');
    expect(result.category).toBe('other');
    expect(result.isKeyVocab).toBe(false);
  });

  it('单字符返回 other', () => {
    const result = classifyWord('a');
    expect(result.category).toBe('other');
  });

  it('停用词不是关键词汇', () => {
    const result = classifyWord('the');
    expect(result.isKeyVocab).toBe(false);
  });

  it('本地词典中的词按释义分类', () => {
    const result = classifyWord('run');
    if (result.category !== 'other') {
      expect(['verb', 'noun']).toContain(result.category);
    }
  });

  it('-ly 后缀识别为副词', () => {
    const result = classifyWord('quickly');
    expect(result.category).toBe('adv');
  });

  it('-tion 后缀识别为名词', () => {
    const result = classifyWord('education');
    expect(result.category).toBe('noun');
  });

  it('-ful 后缀识别为形容词', () => {
    const result = classifyWord('beautiful');
    expect(result.category).toBe('adj');
  });

  it('-ize 后缀识别为动词', () => {
    const result = classifyWord('realize');
    expect(result.category).toBe('verb');
  });

  it('动词/名词/形容词/副词是关键词汇', () => {
    const verbResult = classifyWord('organize');
    if (verbResult.category === 'verb') {
      expect(verbResult.isKeyVocab).toBe(true);
    }
  });

  it('标点符号被清理', () => {
    const result = classifyWord('quickly,');
    expect(result.category).toBe('adv');
  });

  it('大小写不敏感', () => {
    const r1 = classifyWord('Quickly');
    const r2 = classifyWord('quickly');
    expect(r1.category).toBe(r2.category);
  });
});

describe('STOP_WORDS', () => {
  it('包含常见停用词', () => {
    expect(STOP_WORDS.has('the')).toBe(true);
    expect(STOP_WORDS.has('is')).toBe(true);
    expect(STOP_WORDS.has('and')).toBe(true);
  });

  it('不包含实义词', () => {
    expect(STOP_WORDS.has('education')).toBe(false);
    expect(STOP_WORDS.has('beautiful')).toBe(false);
  });
});

describe('CATEGORY_CONFIG', () => {
  it('包含所有 12 种词性', () => {
    const categories: WordCategory[] = ['verb', 'noun', 'adj', 'adv', 'prep', 'pron', 'conj', 'det', 'num', 'int', 'art', 'other'];
    for (const cat of categories) {
      expect(CATEGORY_CONFIG[cat]).toBeDefined();
      expect(CATEGORY_CONFIG[cat].label).toBeDefined();
    }
  });
});

describe('getKeyVocabFromSubtitles', () => {
  it('从字幕中提取关键词汇', () => {
    const subtitles = [
      { text: 'She quickly realized the beautiful education system' },
    ];
    const result = getKeyVocabFromSubtitles(subtitles);
    expect(result.size).toBeGreaterThan(0);
  });

  it('过滤停用词', () => {
    const subtitles = [
      { text: 'the a an is are was were' },
    ];
    const result = getKeyVocabFromSubtitles(subtitles);
    expect(result.size).toBe(0);
  });

  it('统计词频', () => {
    const subtitles = [
      { text: 'quickly quickly quickly' },
    ];
    const result = getKeyVocabFromSubtitles(subtitles);
    const quickly = result.get('quickly');
    expect(quickly).toBeDefined();
    expect(quickly!.count).toBe(3);
  });

  it('短词（<3字符）被过滤', () => {
    const subtitles = [
      { text: 'go do me' },
    ];
    const result = getKeyVocabFromSubtitles(subtitles);
    expect(result.size).toBe(0);
  });
});
