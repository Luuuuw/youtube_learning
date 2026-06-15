import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_VIDEO_ID = 'test-state-video';
let tmpRoot: string;
let originalCwd: string;
let contentDir: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-state-'));
  contentDir = path.join(tmpRoot, 'public', 'content', TEST_VIDEO_ID);
  fs.mkdirSync(contentDir, { recursive: true });
  process.chdir(tmpRoot);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function importFresh() {
  const mod = await import('@/lib/translate-state?t=' + Date.now());
  return mod;
}

describe('translate-state', () => {
  it('loadState 返回 null 当文件不存在', async () => {
    const { loadState } = await importFresh();
    expect(loadState(TEST_VIDEO_ID)).toBeNull();
  });

  it('save 后 load 拿回相同内容', async () => {
    const { initState, saveState, loadState, markDone } = await importFresh();
    const state = initState(TEST_VIDEO_ID, 3);
    markDone(state, '0.000-2.500', 'hello', '你好', 'minimax');
    markDone(state, '2.500-5.000', 'world', '世界', 'deepseek');
    saveState(state);

    const loaded = loadState(TEST_VIDEO_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.totalCues).toBe(3);
    expect(loaded!.cues['0.000-2.500'].zh).toBe('你好');
    expect(loaded!.cues['0.000-2.500'].source).toBe('minimax');
    expect(loaded!.cues['2.500-5.000'].source).toBe('deepseek');
  });

  it('getDoneTranslation 命中已 done 的 cue', async () => {
    const { initState, markDone, getDoneTranslation } = await importFresh();
    const state = initState(TEST_VIDEO_ID, 1);
    markDone(state, '0.000-2.500', 'hello', '你好', 'minimax');
    expect(getDoneTranslation(state, '0.000-2.500')).toBe('你好');
  });

  it('getDoneTranslation 在英文文本变更时失效', async () => {
    const { initState, markDone, getDoneTranslation } = await importFresh();
    const state = initState(TEST_VIDEO_ID, 1);
    markDone(state, '0.000-2.500', 'hello', '你好', 'minimax');
    // 同 key 但 en 不同 → 不应复用旧翻译
    expect(getDoneTranslation(state, '0.000-2.500', 'hello there')).toBeNull();
    // 同 key 且 en 一致 → 复用
    expect(getDoneTranslation(state, '0.000-2.500', 'hello')).toBe('你好');
    // 不传 currentEn → 不校验，复用
    expect(getDoneTranslation(state, '0.000-2.500')).toBe('你好');
  });

  it('markFailed 不会覆盖之前 done 的 zh', async () => {
    const { initState, markDone, markFailed } = await importFresh();
    const state = initState(TEST_VIDEO_ID, 1);
    markDone(state, '0.000-2.500', 'hello', '你好', 'minimax');
    markFailed(state, '0.000-2.500', 'hello');
    expect(state.cues['0.000-2.500'].zh).toBe('你好');
    expect(state.cues['0.000-2.500'].status).toBe('failed');
    expect(state.cues['0.000-2.500'].attempts).toBe(2);
  });

  it('countDone 只算 status=done 且 zh 非空', async () => {
    const { initState, markDone, markFailed, countDone } = await importFresh();
    const state = initState(TEST_VIDEO_ID, 3);
    markDone(state, 'a', 'a', 'A', 'minimax');
    markDone(state, 'b', 'b', 'B', 'deepseek');
    markFailed(state, 'c', 'c');
    expect(countDone(state)).toBe(2);
  });

  it('initState 在传入 existing 时保留已有 cues', async () => {
    const { initState, saveState, loadState, markDone } = await importFresh();
    const old = initState(TEST_VIDEO_ID, 10);
    markDone(old, 'a', 'a', 'A', 'minimax');
    saveState(old);

    const loaded = loadState(TEST_VIDEO_ID);
    const next = initState(TEST_VIDEO_ID, 12, loaded);
    expect(next.totalCues).toBe(12);
    expect(next.cues['a']).toBeDefined();
    expect(next.cues['a'].zh).toBe('A');
    // startedAt 保留
    expect(next.startedAt).toBe(old.startedAt);
  });

  it('损坏的 state 文件不会让 loadState 抛错', async () => {
    const { loadState } = await importFresh();
    const statePath = path.join(contentDir, '.translate-state.json');
    fs.writeFileSync(statePath, '{not json', 'utf-8');
    expect(loadState(TEST_VIDEO_ID)).toBeNull();
  });

  it('cueKey 始终用 3 位小数（与 zh-Hans.json 对齐）', async () => {
    const { cueKey } = await importFresh();
    expect(cueKey(0, 2.5)).toBe('0.000-2.500');
    expect(cueKey(12.3456, 15.6789)).toBe('12.346-15.679');
  });
});
