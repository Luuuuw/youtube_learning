import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { snapshotBefore, listSnapshots, revertToSnapshot } from '@/lib/ai-snapshot';

let tmpDir: string;
let targetFile: string;

beforeEach(() => {
  // Unique tmp dir per test to avoid cross-test pollution
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `snapshot-test-${randomBytes(4).toString('hex')}-`));
  targetFile = path.join(tmpDir, 'target.vtt');
  fs.writeFileSync(targetFile, 'original-content', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Wait a few ms so each snapshot gets a unique Date.now() */
async function tick(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('snapshotBefore', () => {
  it('copies content and returns a path matching {target}.snapshot-{ts}.bak', () => {
    const snap = snapshotBefore(targetFile);
    expect(snap).not.toBeNull();
    expect(snap).toMatch(/\.snapshot-\d+\.bak$/);
    expect(snap!.startsWith(targetFile)).toBe(true);
  });

  it('snapshot file exists and content matches original target', () => {
    const snap = snapshotBefore(targetFile)!;
    expect(fs.existsSync(snap)).toBe(true);
    expect(fs.readFileSync(snap, 'utf-8')).toBe('original-content');
  });

  it('returns null for non-existent target file (does not throw)', () => {
    const nonExist = path.join(tmpDir, 'nothing-here.txt');
    expect(() => snapshotBefore(nonExist)).not.toThrow();
    expect(snapshotBefore(nonExist)).toBeNull();
  });
});

describe('listSnapshots', () => {
  it('accumulates multiple snapshots, sorted newest-first', async () => {
    const s1 = snapshotBefore(targetFile)!;
    await tick();
    const s2 = snapshotBefore(targetFile)!;
    await tick();
    const s3 = snapshotBefore(targetFile)!;

    const list = listSnapshots(targetFile);
    expect(list).toHaveLength(3);
    // Newest first
    expect(list[0].snapshotPath).toBe(s3);
    expect(list[1].snapshotPath).toBe(s2);
    expect(list[2].snapshotPath).toBe(s1);
    expect(list[0].timestamp).toBeGreaterThanOrEqual(list[1].timestamp);
    expect(list[1].timestamp).toBeGreaterThanOrEqual(list[2].timestamp);
  });

  it('returns empty array when target dir does not exist', () => {
    expect(listSnapshots(path.join(tmpDir, 'nonexistent-subdir', 'target.txt'))).toEqual([]);
  });
});

describe('snapshot rotation (keep last 5)', () => {
  it('after 6 snapshots, only the 5 most recent remain', async () => {
    const created: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Mutate file so each snapshot can be distinguished, then take snapshot of new content
      fs.writeFileSync(targetFile, `content-${i}`, 'utf-8');
      created.push(snapshotBefore(targetFile)!);
      await tick();
    }

    const list = listSnapshots(targetFile);
    expect(list).toHaveLength(5);

    // Oldest (created[0]) should have been deleted
    expect(fs.existsSync(created[0])).toBe(false);
    // The 5 newer ones should remain
    for (let i = 1; i < 6; i++) {
      expect(fs.existsSync(created[i])).toBe(true);
    }
  });
});

describe('revertToSnapshot', () => {
  it('restores target content from a snapshot', () => {
    const snap = snapshotBefore(targetFile)!;
    fs.writeFileSync(targetFile, 'corrupted-content', 'utf-8');
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('corrupted-content');

    const ok = revertToSnapshot(targetFile, snap);
    expect(ok).toBe(true);
    expect(fs.readFileSync(targetFile, 'utf-8')).toBe('original-content');
  });

  it('returns false when snapshot file is missing', () => {
    const fakeSnap = path.join(tmpDir, 'target.vtt.snapshot-99999.bak');
    expect(revertToSnapshot(targetFile, fakeSnap)).toBe(false);
  });

  it('makes a backup of current target before reverting (safety snapshot)', async () => {
    const snap = snapshotBefore(targetFile)!;
    await tick();
    fs.writeFileSync(targetFile, 'will-be-overwritten', 'utf-8');

    const beforeRevert = listSnapshots(targetFile).length;
    revertToSnapshot(targetFile, snap);
    const afterRevert = listSnapshots(targetFile).length;

    // revertToSnapshot internally calls snapshotBefore() of current target → one extra snapshot
    expect(afterRevert).toBe(beforeRevert + 1);
  });
});
