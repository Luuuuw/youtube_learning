import { describe, it, expect } from 'vitest';
import {
  mustNotBeEmpty,
  mustHaveChinese,
  mustPreserveVttRollupTags,
  mustPreserveCueCount,
  mustRecordModel,
  mustNotOverlapWithNext,
  mustHaveCardContent,
  runInvariants,
  type Invariant,
} from '@/lib/ai-invariants';
import type { AiProposal } from '@/lib/safe-ai-write';

function makeProposal(overrides: Partial<AiProposal> = {}): AiProposal {
  return {
    id: 'test-id',
    operation: 'test',
    targetFile: '/tmp/test.txt',
    before: '',
    after: '',
    metadata: {},
    actor: 'tester',
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  };
}

describe('mustNotBeEmpty', () => {
  it('returns null for non-empty string >= minLen', () => {
    const inv = mustNotBeEmpty(3);
    expect(inv(makeProposal({ after: 'hello' }))).toBeNull();
  });

  it('fails for empty string', () => {
    const inv = mustNotBeEmpty(1);
    const result = inv(makeProposal({ after: '' }));
    expect(result).not.toBeNull();
    expect(result).toMatch(/mustNotBeEmpty/);
  });

  it('fails for whitespace-only string (trimmed length 0)', () => {
    const inv = mustNotBeEmpty(1);
    expect(inv(makeProposal({ after: '   \n  ' }))).toMatch(/长度 0/);
  });

  it('fails when shorter than minLen', () => {
    const inv = mustNotBeEmpty(10);
    expect(inv(makeProposal({ after: 'short' }))).toMatch(/< 10/);
  });

  it('fails for non-string (number)', () => {
    const inv = mustNotBeEmpty(1);
    const result = inv(makeProposal({ after: 42 }));
    expect(result).toMatch(/不是字符串/);
  });

  it('fails for non-string (null)', () => {
    const inv = mustNotBeEmpty(1);
    const result = inv(makeProposal({ after: null }));
    expect(result).toMatch(/不是字符串/);
  });
});

describe('mustHaveChinese', () => {
  it('passes for "你好"', () => {
    expect(mustHaveChinese(makeProposal({ after: '你好' }))).toBeNull();
  });

  it('passes for mixed Chinese-English text', () => {
    expect(mustHaveChinese(makeProposal({ after: 'hello 世界' }))).toBeNull();
  });

  it('fails for pure English "hello"', () => {
    const result = mustHaveChinese(makeProposal({ after: 'hello' }));
    expect(result).toMatch(/不含任何中文/);
  });

  it('returns null (not its concern) for non-string after', () => {
    expect(mustHaveChinese(makeProposal({ after: 123 }))).toBeNull();
    expect(mustHaveChinese(makeProposal({ after: { foo: 'bar' } }))).toBeNull();
  });
});

describe('mustPreserveVttRollupTags', () => {
  it('passes when after has >=50% of before tags', () => {
    const before = '<00:00:01.000>hello <00:00:02.000>world <00:00:03.000>foo <00:00:04.000>bar';
    const after = '<00:00:01.000>hi <00:00:03.000>foo';  // 2 of 4 == 50%
    expect(mustPreserveVttRollupTags(makeProposal({ before, after }))).toBeNull();
  });

  it('fails at <50%', () => {
    const before = '<00:00:01.000>a <00:00:02.000>b <00:00:03.000>c <00:00:04.000>d';
    const after = '<00:00:01.000>only';  // 1 of 4 == 25%
    const result = mustPreserveVttRollupTags(makeProposal({ before, after }));
    expect(result).toMatch(/词级时间戳/);
  });

  it('returns null when before has 0 tags', () => {
    expect(mustPreserveVttRollupTags(makeProposal({ before: 'plain text', after: 'whatever' }))).toBeNull();
  });

  it('returns null when before or after not string', () => {
    expect(mustPreserveVttRollupTags(makeProposal({ before: null, after: 'x' }))).toBeNull();
    expect(mustPreserveVttRollupTags(makeProposal({ before: 'x', after: 42 }))).toBeNull();
  });
});

describe('mustPreserveCueCount', () => {
  it('passes when after has >=20% of before cues', () => {
    const before = '1\n00:00:01.000 --> 00:00:02.000\nA\n\n2\n00:00:02.000 --> 00:00:03.000\nB\n\n3\n00:00:03.000 --> 00:00:04.000\nC\n\n4\n00:00:04.000 --> 00:00:05.000\nD\n\n5\n00:00:05.000 --> 00:00:06.000\nE';
    const after = '1\n00:00:01.000 --> 00:00:02.000\nA\n\n2\n00:00:05.000 --> 00:00:06.000\nE';  // 2 of 5 == 40%
    expect(mustPreserveCueCount(makeProposal({ before, after }))).toBeNull();
  });

  it('fails when after has <20% of before cues', () => {
    const before = Array.from({ length: 10 }, (_, i) => `${i}\n00:00:0${i}.000 --> 00:00:0${i + 1}.000\nx`).join('\n\n');
    const after = '1\n00:00:01.000 --> 00:00:02.000\nonly';  // 1 of 10 == 10%
    const result = mustPreserveCueCount(makeProposal({ before, after }));
    expect(result).toMatch(/cue 数/);
  });

  it('returns null when before has 0 cues', () => {
    expect(mustPreserveCueCount(makeProposal({ before: 'WEBVTT\n', after: 'whatever' }))).toBeNull();
  });
});

describe('mustRecordModel', () => {
  it('passes when metadata.model present', () => {
    expect(mustRecordModel(makeProposal({ metadata: { model: 'minimax' } }))).toBeNull();
  });

  it('fails when metadata.model missing', () => {
    const result = mustRecordModel(makeProposal({ metadata: {} }));
    expect(result).toMatch(/model 缺失/);
  });

  it('fails when metadata.model empty string', () => {
    const result = mustRecordModel(makeProposal({ metadata: { model: '' } }));
    expect(result).toMatch(/model 缺失/);
  });
});

describe('mustNotOverlapWithNext', () => {
  it('fails when first 5 words match next cue start', () => {
    const inv = mustNotOverlapWithNext(60, 5);
    const after = 'and then I went home';
    const result = inv(makeProposal({ after, metadata: { nextCueText: 'and then I went home now' } }));
    expect(result).toMatch(/重叠/);
  });

  it('passes when first words differ', () => {
    const inv = mustNotOverlapWithNext(60, 5);
    const after = 'something completely different here today';
    expect(inv(makeProposal({ after, metadata: { nextCueText: 'and then I went home now' } }))).toBeNull();
  });

  it('returns null when no nextCueText in metadata', () => {
    const inv = mustNotOverlapWithNext(60, 5);
    expect(inv(makeProposal({ after: 'hello world', metadata: {} }))).toBeNull();
  });

  it('returns null when after is not a string', () => {
    const inv = mustNotOverlapWithNext(60, 5);
    expect(inv(makeProposal({ after: 42, metadata: { nextCueText: 'foo bar' } }))).toBeNull();
  });
});

describe('mustHaveCardContent', () => {
  it('passes for non-empty cards array with valid front/back', () => {
    expect(
      mustHaveCardContent(makeProposal({
        metadata: { cards: [{ front: 'hello', back: '你好' }] },
      })),
    ).toBeNull();
  });

  it('fails for empty cards array', () => {
    const result = mustHaveCardContent(makeProposal({ metadata: { cards: [] } }));
    expect(result).toMatch(/缺失或为空/);
  });

  it('fails when metadata.cards missing entirely', () => {
    const result = mustHaveCardContent(makeProposal({ metadata: {} }));
    expect(result).toMatch(/缺失或为空/);
  });

  it('fails when any card has blank front', () => {
    const result = mustHaveCardContent(makeProposal({
      metadata: { cards: [{ front: 'ok', back: '好' }, { front: '   ', back: '后面' }] },
    }));
    expect(result).toMatch(/含空字段/);
    expect(result).toMatch(/#2/);
  });

  it('fails when any card has blank back', () => {
    const result = mustHaveCardContent(makeProposal({
      metadata: { cards: [{ front: 'only-front', back: '' }] },
    }));
    expect(result).toMatch(/含空字段/);
  });
});

describe('runInvariants', () => {
  it('returns empty array when all pass', () => {
    const errors = runInvariants(
      makeProposal({ after: '你好世界', metadata: { model: 'gpt' } }),
      [mustNotBeEmpty(1), mustHaveChinese, mustRecordModel],
    );
    expect(errors).toEqual([]);
  });

  it('aggregates errors across multiple invariants', () => {
    const errors = runInvariants(
      makeProposal({ after: '', metadata: {} }),
      [mustNotBeEmpty(1), mustHaveChinese, mustRecordModel],
    );
    // 'mustNotBeEmpty' fails (empty), 'mustHaveChinese' returns null (not string concern — wait, '' IS string)
    // Empty string IS a string, so mustHaveChinese will check it → 不含中文 → also fails
    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.includes('mustNotBeEmpty'))).toBe(true);
    expect(errors.some((e) => e.includes('mustRecordModel'))).toBe(true);
  });

  it('captures invariants that throw internally', () => {
    const throwingInv: Invariant = () => {
      throw new Error('boom');
    };
    const errors = runInvariants(makeProposal(), [throwingInv]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/内部抛错.*boom/);
  });
});
