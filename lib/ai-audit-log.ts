// AI 改动审计日志（Safe-Mutation Layer C）
//
// 所有 AI 写盘提案 + 状态变更追加到 data/ai-audit-log.json。
// JSON Lines 风格（数组形式落地，每条 entry 独立）。
// 防抖 1s 刷盘，避免高频写。
// 文件 > 10MB 自动 rotate 到 data/ai-audit-log.{YYYY-MM-DD}.json。

import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { DATA_DIR } from '@/lib/data-dir';
import type { AiProposal } from '@/lib/safe-ai-write';

const LOG_FILE = path.join(DATA_DIR, 'ai-audit-log.json');
const MAX_SIZE_BYTES = 10 * 1024 * 1024;  // 10 MB
const FLUSH_DEBOUNCE_MS = 1000;

export interface AuditEntry {
  ts: string;                              // ISO timestamp
  proposalId: string;
  action: 'proposed' | 'applied' | 'rejected' | 'reverted';
  proposal?: AiProposal;                   // 仅在 proposed 时记完整 proposal，其他 action 记轻量
  snapshotPath?: string;                   // applied 时记本次 backup 路径
  durationMs?: number;                     // apply 耗时
  errorMsg?: string;                       // rejected/失败时
  revertOfAuditId?: string;                // reverted 时指向被 revert 的 applied entry id
  id: string;                              // 本 entry uuid
}

class AuditLogCache {
  private entries: AuditEntry[] = [];
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(LOG_FILE)) {
        this.entries = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
      }
    } catch (err) {
      console.warn('[ai-audit] load failed, starting empty:', (err as Error).message);
      this.entries = [];
    }
  }

  append(entry: AuditEntry): void {
    this.entries.push(entry);
    this.dirty = true;
    this.scheduleFlush();
    this.maybeRotate();
  }

  private scheduleFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      atomicWriteJsonSync(LOG_FILE, this.entries);
      this.dirty = false;
    } catch (err) {
      console.error('[ai-audit] flush failed:', (err as Error).message);
    }
    this.flushTimer = null;
  }

  private maybeRotate(): void {
    try {
      if (!fs.existsSync(LOG_FILE)) return;
      const size = fs.statSync(LOG_FILE).size;
      if (size < MAX_SIZE_BYTES) return;
      // rotate：原文件改名加日期，开新文件
      const today = new Date().toISOString().slice(0, 10);
      const rotated = path.join(DATA_DIR, `ai-audit-log.${today}.json`);
      fs.copyFileSync(LOG_FILE, rotated);
      this.entries = [];
      this.dirty = true;
      this.scheduleFlush();
    } catch (err) {
      console.warn('[ai-audit] rotate failed:', (err as Error).message);
    }
  }

  list(filter?: { proposalId?: string; action?: AuditEntry['action']; limit?: number }): AuditEntry[] {
    let list = this.entries.slice();
    if (filter?.proposalId) list = list.filter(e => e.proposalId === filter.proposalId);
    if (filter?.action) list = list.filter(e => e.action === filter.action);
    list.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    if (filter?.limit) list = list.slice(0, filter.limit);
    return list;
  }

  findById(id: string): AuditEntry | undefined {
    return this.entries.find(e => e.id === id);
  }
}

const globalForAudit = globalThis as unknown as { __aiAuditCache?: AuditLogCache };
const cache: AuditLogCache = globalForAudit.__aiAuditCache ?? new AuditLogCache();
if (!globalForAudit.__aiAuditCache) globalForAudit.__aiAuditCache = cache;

function newEntryId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function logProposed(p: AiProposal): string {
  const entry: AuditEntry = {
    id: newEntryId(),
    ts: new Date().toISOString(),
    proposalId: p.id,
    action: 'proposed',
    proposal: p,
  };
  cache.append(entry);
  return entry.id;
}

export function logApplied(proposalId: string, snapshotPath: string | null, durationMs: number): string {
  const entry: AuditEntry = {
    id: newEntryId(),
    ts: new Date().toISOString(),
    proposalId,
    action: 'applied',
    snapshotPath: snapshotPath ?? undefined,
    durationMs,
  };
  cache.append(entry);
  return entry.id;
}

export function logRejected(proposalId: string, errorMsg: string): string {
  const entry: AuditEntry = {
    id: newEntryId(),
    ts: new Date().toISOString(),
    proposalId,
    action: 'rejected',
    errorMsg,
  };
  cache.append(entry);
  return entry.id;
}

export function logReverted(proposalId: string, revertOfAuditId: string): string {
  const entry: AuditEntry = {
    id: newEntryId(),
    ts: new Date().toISOString(),
    proposalId,
    action: 'reverted',
    revertOfAuditId,
  };
  cache.append(entry);
  return entry.id;
}

export function listAudit(filter?: Parameters<typeof cache.list>[0]): AuditEntry[] {
  return cache.list(filter);
}

export function findAuditById(id: string): AuditEntry | undefined {
  return cache.findById(id);
}

export function flushAuditLog(): void {
  cache.flush();
}
