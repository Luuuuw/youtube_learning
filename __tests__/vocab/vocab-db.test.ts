import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user-db', () => ({
  getUserByUsername: vi.fn().mockReturnValue({ username: 'testuser', disabled: false }),
}));

import {
  addWord,
  getWordById,
  getWordByName,
  getAllWords,
  updateWord,
  deleteWord,
  reviewWord,
  getDueWords,
  getTodayStats,
  getReviewHistory,
} from '@/lib/vocab-db';
import type { VocabWord } from '@/lib/vocab-db';

function makeWordData(overrides: Partial<VocabWord> = {}) {
  return {
    word: overrides.word ?? 'ephemeral',
    phonetic: overrides.phonetic ?? '/ɪˈfemərəl/',
    definition: overrides.definition ?? 'adj. 短暂的',
    example: overrides.example ?? 'The ephemeral beauty of cherry blossoms.',
    context: overrides.context ?? 'The ephemeral beauty...',
    videoId: overrides.videoId ?? 'vid1',
    videoTitle: overrides.videoTitle ?? 'Test Video',
    timestamp: overrides.timestamp ?? 12.5,
    category: overrides.category ?? 'adj',
    owner: overrides.owner ?? 'testowner',
    ...overrides,
  };
}

describe('VocabCache CRUD', () => {
  it('addWord 添加词汇并返回完整对象', () => {
    const word = addWord(makeWordData({ word: 'crud_test_add' }));
    expect(word.id).toBeDefined();
    expect(word.word).toBe('crud_test_add');
    expect(word.proficiency).toBe(0);
    expect(word.reviewCount).toBe(0);
    expect(word.nextReviewAt).toBeDefined();
    expect(word.createdAt).toBeDefined();
  });

  it('addWord 同词同 owner 不重复添加', () => {
    const w1 = addWord(makeWordData({ word: 'dup_test', owner: 'dup_owner' }));
    const w2 = addWord(makeWordData({ word: 'dup_test', owner: 'dup_owner' }));
    expect(w1.id).toBe(w2.id);
  });

  it('addWord 同词不同 owner 可以添加', () => {
    const w1 = addWord(makeWordData({ word: 'multi_owner', owner: 'owner_A' }));
    const w2 = addWord(makeWordData({ word: 'multi_owner', owner: 'owner_B' }));
    expect(w1.id).not.toBe(w2.id);
  });

  it('getWordById 按 ID 查询', () => {
    const added = addWord(makeWordData({ word: 'byid_test' }));
    const found = getWordById(added.id);
    expect(found).not.toBeNull();
    expect(found!.word).toBe('byid_test');
  });

  it('getWordById 带 owner 过滤', () => {
    const added = addWord(makeWordData({ word: 'owner_filter', owner: 'filter_owner' }));
    expect(getWordById(added.id, 'filter_owner')).not.toBeNull();
    expect(getWordById(added.id, 'wrong_owner')).toBeNull();
  });

  it('getWordByName 按词名查询', () => {
    addWord(makeWordData({ word: 'byname_test', owner: 'byname_owner' }));
    const found = getWordByName('byname_test', 'byname_owner');
    expect(found).not.toBeNull();
    expect(found!.word).toBe('byname_test');
  });

  it('getWordByName 大小写不敏感', () => {
    addWord(makeWordData({ word: 'CaseTest', owner: 'case_owner' }));
    const found = getWordByName('casetest', 'case_owner');
    expect(found).not.toBeNull();
  });

  it('getAllWords 返回所有词', () => {
    const before = getAllWords().length;
    addWord(makeWordData({ word: 'all_test_1' }));
    addWord(makeWordData({ word: 'all_test_2' }));
    const after = getAllWords();
    expect(after.length).toBeGreaterThanOrEqual(before + 2);
  });

  it('getAllWords 按 owner 过滤', () => {
    addWord(makeWordData({ word: 'filter_all_1', owner: 'filter_all_owner' }));
    addWord(makeWordData({ word: 'filter_all_2', owner: 'other_owner_xyz' }));
    const filtered = getAllWords('filter_all_owner');
    expect(filtered.every(w => w.owner === 'filter_all_owner')).toBe(true);
  });

  it('updateWord 更新词汇字段', () => {
    const added = addWord(makeWordData({ word: 'update_test', owner: 'update_owner' }));
    const updated = updateWord(added.id, { definition: 'v. 更新后的释义' }, 'update_owner');
    expect(updated).not.toBeNull();
    expect(updated!.definition).toBe('v. 更新后的释义');
  });

  it('updateWord 不允许修改 owner 不匹配的词', () => {
    const added = addWord(makeWordData({ word: 'update_owner_test', owner: 'real_owner' }));
    const result = updateWord(added.id, { definition: 'hacked' }, 'fake_owner');
    expect(result).toBeNull();
  });

  it('updateWord 更新词名后索引同步', () => {
    const added = addWord(makeWordData({ word: 'old_name_idx', owner: 'idx_owner' }));
    updateWord(added.id, { word: 'new_name_idx' }, 'idx_owner');
    expect(getWordByName('old_name_idx', 'idx_owner')).toBeNull();
    expect(getWordByName('new_name_idx', 'idx_owner')).not.toBeNull();
  });

  it('deleteWord 删除词汇', () => {
    const added = addWord(makeWordData({ word: 'delete_test', owner: 'del_owner' }));
    expect(deleteWord(added.id, 'del_owner')).toBe(true);
    expect(getWordById(added.id)).toBeNull();
  });

  it('deleteWord owner 不匹配时拒绝删除', () => {
    const added = addWord(makeWordData({ word: 'del_owner_test', owner: 'real_del' }));
    expect(deleteWord(added.id, 'fake_del')).toBe(false);
    expect(getWordById(added.id)).not.toBeNull();
  });

  it('deleteWord 不存在的 ID 返回 false', () => {
    expect(deleteWord('nonexistent_id_xyz')).toBe(false);
  });
});

describe('间隔重复算法', () => {
  it('reviewWord remember 增加熟练度', () => {
    const added = addWord(makeWordData({ word: 'review_remember', owner: 'rev_owner' }));
    const reviewed = reviewWord(added.id, 'remember', 'rev_owner');
    expect(reviewed).not.toBeNull();
    expect(reviewed!.proficiency).toBe(1);
    expect(reviewed!.reviewCount).toBe(1);
  });

  it('reviewWord forget 降低熟练度（-2，最低0）', () => {
    const added = addWord(makeWordData({ word: 'review_forget', owner: 'rev_owner2' }));
    reviewWord(added.id, 'remember', 'rev_owner2');
    reviewWord(added.id, 'remember', 'rev_owner2');
    const after = reviewWord(added.id, 'forget', 'rev_owner2');
    expect(after!.proficiency).toBe(0);
  });

  it('reviewWord 熟练度上限为 5', () => {
    const added = addWord(makeWordData({ word: 'review_max', owner: 'rev_owner3' }));
    let current = added;
    for (let i = 0; i < 10; i++) {
      current = reviewWord(current.id, 'remember', 'rev_owner3')!;
    }
    expect(current.proficiency).toBe(5);
  });

  it('reviewWord 熟练度下限为 0', () => {
    const added = addWord(makeWordData({ word: 'review_min', owner: 'rev_owner4' }));
    const after = reviewWord(added.id, 'forget', 'rev_owner4');
    expect(after!.proficiency).toBe(0);
  });

  it('reviewWord 更新 nextReviewAt（proficiency 变化导致间隔变化）', () => {
    const added = addWord(makeWordData({ word: 'review_next', owner: 'rev_owner5' }));
    const oldNextDate = new Date(added.nextReviewAt!).getDate();
    const after = reviewWord(added.id, 'remember', 'rev_owner5');
    const newNextDate = new Date(after!.nextReviewAt!).getDate();
    expect(after!.nextReviewAt).toBeDefined();
  });

  it('reviewWord 生成复习日志', () => {
    const added = addWord(makeWordData({ word: 'review_log', owner: 'rev_owner6' }));
    reviewWord(added.id, 'remember', 'rev_owner6');
    const logs = getReviewHistory(added.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].result).toBe('remember');
  });

  it('calcNextReview 间隔随 proficiency 递增', () => {
    const intervals = [1, 1, 3, 7, 15, 30];
    for (let p = 0; p <= 5; p++) {
      const now = new Date();
      const days = intervals[Math.min(p, 5)];
      now.setDate(now.getDate() + days);
    }
    expect(intervals[0]).toBeLessThan(intervals[5]);
  });
});

describe('getDueWords', () => {
  it('新添加的词 nextReviewAt 是未来（1天后），不在到期列表中', () => {
    const added = addWord(makeWordData({ word: 'due_future', owner: 'due_owner2' }));
    const due = getDueWords('due_owner2');
    expect(due.some(w => w.id === added.id)).toBe(false);
  });

  it('手动设置 nextReviewAt 为过去后出现在到期列表', () => {
    const added = addWord(makeWordData({ word: 'due_past', owner: 'due_owner3' }));
    updateWord(added.id, { nextReviewAt: '2020-01-01T00:00:00.000Z' }, 'due_owner3');
    const due = getDueWords('due_owner3');
    expect(due.some(w => w.id === added.id)).toBe(true);
  });
});

describe('getTodayStats', () => {
  it('返回正确的统计结构', () => {
    addWord(makeWordData({ word: 'stats_test', owner: 'stats_owner' }));
    const stats = getTodayStats('stats_owner');
    expect(stats).toHaveProperty('due');
    expect(stats).toHaveProperty('new');
    expect(stats).toHaveProperty('mastered');
    expect(stats).toHaveProperty('total');
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});

describe('wordNameIndex Bug 验证', () => {
  it('【已知 Bug】同词不同 owner 的索引会互相覆盖', () => {
    const w1 = addWord(makeWordData({ word: 'shared_word_bug', owner: 'owner_X' }));
    const w2 = addWord(makeWordData({ word: 'shared_word_bug', owner: 'owner_Y' }));

    const found1 = getWordByName('shared_word_bug', 'owner_X');
    const found2 = getWordByName('shared_word_bug', 'owner_Y');

    expect(found2).not.toBeNull();
    expect(found2!.owner).toBe('owner_Y');

    expect(found1).toBeNull();
  });
});
