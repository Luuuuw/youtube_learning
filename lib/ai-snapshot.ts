// AI 写盘前的备份层（Safe-Mutation Layer A）
//
// 模式：写盘前调 snapshotBefore(target) → 复制 target 为 target.snapshot-{ts}.bak
// 之后 apply 写入；如需 revert，调 revertToSnapshot()。
// 每个 target 保留最近 5 个 snapshot，超出按时间戳删最旧。
//
// 注意：所有 snapshot 文件名带 `.snapshot-` 前缀，统一被 .gitignore 屏蔽。

import fs from 'fs';
import path from 'path';

const KEEP_SNAPSHOTS = 5;
const SNAPSHOT_MARKER = '.snapshot-';

export interface SnapshotInfo {
  snapshotPath: string;
  target: string;
  timestamp: number;
  sizeBytes: number;
}

/**
 * 写盘前调用。返回 snapshot 文件路径（如果原文件不存在则返回 null）。
 * 自动轮换：每个 target 保留 KEEP_SNAPSHOTS 份，超出按时间删最旧。
 */
export function snapshotBefore(target: string): string | null {
  if (!fs.existsSync(target)) return null;
  const ts = Date.now();
  const snapshotPath = `${target}${SNAPSHOT_MARKER}${ts}.bak`;
  try {
    fs.copyFileSync(target, snapshotPath);
    rotateSnapshots(target);
    return snapshotPath;
  } catch (err) {
    console.warn(`[ai-snapshot] snapshotBefore failed for ${target}:`, (err as Error).message);
    return null;
  }
}

/**
 * 列出 target 的所有 snapshot，最新在前。
 */
export function listSnapshots(target: string): SnapshotInfo[] {
  const dir = path.dirname(target);
  const baseName = path.basename(target);
  if (!fs.existsSync(dir)) return [];

  try {
    const files = fs.readdirSync(dir);
    const prefix = `${baseName}${SNAPSHOT_MARKER}`;
    const snapshots: SnapshotInfo[] = [];
    for (const f of files) {
      if (!f.startsWith(prefix) || !f.endsWith('.bak')) continue;
      const tsStr = f.slice(prefix.length, -'.bak'.length);
      const timestamp = Number(tsStr);
      if (Number.isNaN(timestamp)) continue;
      const snapshotPath = path.join(dir, f);
      let sizeBytes = 0;
      try { sizeBytes = fs.statSync(snapshotPath).size; } catch {}
      snapshots.push({ snapshotPath, target, timestamp, sizeBytes });
    }
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    console.warn(`[ai-snapshot] listSnapshots failed:`, (err as Error).message);
    return [];
  }
}

/**
 * 从指定 snapshot 恢复到 target。原 target 内容会再做一次 snapshot 防丢。
 * 返回是否成功。
 */
export function revertToSnapshot(target: string, snapshotPath: string): boolean {
  if (!fs.existsSync(snapshotPath)) {
    console.warn(`[ai-snapshot] snapshot not found: ${snapshotPath}`);
    return false;
  }
  try {
    // 先备份当前 target（防"恢复后又后悔"）
    snapshotBefore(target);
    fs.copyFileSync(snapshotPath, target);
    return true;
  } catch (err) {
    console.error(`[ai-snapshot] revert failed:`, (err as Error).message);
    return false;
  }
}

/**
 * 轮换：保留最近 KEEP_SNAPSHOTS 份，多出来按时间删。
 */
function rotateSnapshots(target: string): void {
  const snapshots = listSnapshots(target);
  if (snapshots.length <= KEEP_SNAPSHOTS) return;
  const toDelete = snapshots.slice(KEEP_SNAPSHOTS);
  for (const s of toDelete) {
    try { fs.unlinkSync(s.snapshotPath); } catch {}
  }
}
