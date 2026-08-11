// AI 改动安全写盘 facade（Safe-Mutation Pattern 主入口）
//
// 所有 AI 决策的写盘改动应该走 safeAiWrite(proposal, options, applyFn)。
//
// 流程：
//   1. logProposed(p) → audit 记录提案
//   2. runInvariants(p, invariants) → 失败 → logRejected → return rejected
//   3. 按 riskLevel 分流：
//      - low / medium: 立即调 applyFn → snapshotBefore(target) → applyFn() → logApplied
//      - high: 写到 data/ai-pending/{id}.json → return pending（看板 admin 审批后才 apply）
//
// 设计原则：
// - applyFn 是真正的写盘动作（由调用方提供），这里只做 wrap
// - 不引入新依赖；纯 Node + 项目内现有 lib
// - 失败 silent，不阻塞主流程（如 audit log 写不进，主翻译还能跑）

import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { DATA_DIR } from '@/lib/data-dir';
import { snapshotBefore } from '@/lib/ai-snapshot';
import { runInvariants, type Invariant } from '@/lib/ai-invariants';
import { logProposed, logApplied, logRejected } from '@/lib/ai-audit-log';

const PENDING_DIR = path.join(DATA_DIR, 'ai-pending');

export type RiskLevel = 'low' | 'medium' | 'high';

export interface AiProposal {
  id: string;
  operation: string;
  targetFile: string;
  before: unknown;
  after: unknown;
  metadata: {
    model?: string;
    modelResponseId?: string;
    promptHash?: string;
    confidence?: number;
    videoId?: string;
    key?: string;
    nextCueText?: string;
    [extraKey: string]: unknown;
  };
  actor: string;
  createdAt: string;
  status: 'pending' | 'applied' | 'rejected' | 'reverted';
}

export interface SafeAiWriteOptions {
  riskLevel: RiskLevel;
  invariants?: Invariant[];
  /** 紧急 bypass HITL，仅 admin 手动触发场景用。来自 env AI_HITL_BYPASS=1 时全局生效。 */
  bypassHitl?: boolean;
}

export interface SafeAiWriteResult<T> {
  status: 'applied' | 'pending' | 'rejected';
  result?: T;
  reason?: string;
  proposalId: string;
}

function ensurePendingDir(): void {
  try {
    if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
  } catch (err) {
    console.warn('[safe-ai-write] mkdir pending dir failed:', (err as Error).message);
  }
}

function newProposalId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/**
 * 生成提案 helper（调用方可选用）。
 */
export function buildProposal(args: Omit<AiProposal, 'id' | 'createdAt' | 'status'> & { id?: string }): AiProposal {
  return {
    id: args.id ?? newProposalId(),
    operation: args.operation,
    targetFile: args.targetFile,
    before: args.before,
    after: args.after,
    metadata: args.metadata,
    actor: args.actor,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

/**
 * 主入口。详见文件顶部注释。
 */
export async function safeAiWrite<T>(
  proposal: AiProposal,
  options: SafeAiWriteOptions,
  applyFn: () => Promise<T> | T,
): Promise<SafeAiWriteResult<T>> {
  // Layer C: 提案入审计
  try { logProposed(proposal); } catch (err) {
    console.warn('[safe-ai-write] logProposed failed:', (err as Error).message);
  }

  // Layer B: invariants 校验
  const invariants = options.invariants ?? [];
  const errors = runInvariants(proposal, invariants);
  if (errors.length > 0) {
    const reason = `invariants 失败: ${errors.join('; ')}`;
    try { logRejected(proposal.id, reason); } catch {}
    return { status: 'rejected', reason, proposalId: proposal.id };
  }

  const envBypass = process.env.AI_HITL_BYPASS === '1';
  const useHitl = options.riskLevel === 'high' && !options.bypassHitl && !envBypass;

  if (useHitl) {
    // Layer D: 写到 staging 区，等 admin 审
    ensurePendingDir();
    const pendingPath = path.join(PENDING_DIR, `${proposal.id}.json`);
    try {
      atomicWriteJsonSync(pendingPath, proposal);
      return { status: 'pending', reason: '等待 admin 审批', proposalId: proposal.id };
    } catch (err) {
      const reason = `写 pending 文件失败: ${(err as Error).message}`;
      try { logRejected(proposal.id, reason); } catch {}
      return { status: 'rejected', reason, proposalId: proposal.id };
    }
  }

  // Layer A + 执行：备份 + apply + audit applied
  const t0 = Date.now();
  const snapshotPath = snapshotBefore(proposal.targetFile);
  try {
    const result = await applyFn();
    try { logApplied(proposal.id, snapshotPath, Date.now() - t0); } catch {}
    return { status: 'applied', result, proposalId: proposal.id };
  } catch (err) {
    const reason = `applyFn 失败: ${(err as Error).message}`;
    try { logRejected(proposal.id, reason); } catch {}
    return { status: 'rejected', reason, proposalId: proposal.id };
  }
}

/**
 * 列 staging 区所有 pending proposals（供看板 / API 读）。
 */
export function listPendingProposals(): AiProposal[] {
  ensurePendingDir();
  try {
    const files = fs.readdirSync(PENDING_DIR);
    const out: AiProposal[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      try {
        const p: AiProposal = JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf-8'));
        out.push(p);
      } catch {}
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function getPendingProposal(proposalId: string): AiProposal | null {
  const p = path.join(PENDING_DIR, `${proposalId}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function removePendingProposal(proposalId: string): boolean {
  const p = path.join(PENDING_DIR, `${proposalId}.json`);
  if (!fs.existsSync(p)) return false;
  try {
    fs.unlinkSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Admin 审批 pending proposal：snapshot + applyFn + audit applied + 删 pending 文件。
 * 调用方提供 applyFn（同 safeAiWrite 的 applyFn）。
 */
export async function approvePendingProposal<T>(
  proposalId: string,
  applyFn: (p: AiProposal) => Promise<T> | T,
): Promise<SafeAiWriteResult<T>> {
  const p = getPendingProposal(proposalId);
  if (!p) return { status: 'rejected', reason: 'pending 文件不存在', proposalId };

  const t0 = Date.now();
  const snapshotPath = snapshotBefore(p.targetFile);
  try {
    const result = await applyFn(p);
    try { logApplied(p.id, snapshotPath, Date.now() - t0); } catch {}
    removePendingProposal(proposalId);
    return { status: 'applied', result, proposalId };
  } catch (err) {
    const reason = `apply 失败: ${(err as Error).message}`;
    try { logRejected(proposalId, reason); } catch {}
    return { status: 'rejected', reason, proposalId };
  }
}

/**
 * Admin 拒绝 pending proposal。
 */
export function rejectPendingProposal(proposalId: string, reason = 'admin 拒绝'): boolean {
  const p = getPendingProposal(proposalId);
  if (!p) return false;
  try { logRejected(proposalId, reason); } catch {}
  return removePendingProposal(proposalId);
}
