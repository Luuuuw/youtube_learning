// HITL 端到端流程测试：模拟看板审批闭环
//
// pending → list → approve → snapshot → revert → 文件恢复
//
// 5 个 admin API（ai-pending GET, approve POST, reject POST, ai-audit GET, ai-revert POST）
// 都是 verifyAdmin + 调下面这套 lib 函数的薄壳，能跑通就说明 API 也基本能跑通。
//
// IMPORTANT: 这个 fixture 必须最先 import（ESM 提升原因）
import { TEST_DATA_DIR } from './_data-dir-fixture';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomBytes } from 'crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildProposal,
  safeAiWrite,
  listPendingProposals,
  approvePendingProposal,
  rejectPendingProposal,
  removePendingProposal,
} from '@/lib/safe-ai-write';
import { listSnapshots, revertToSnapshot } from '@/lib/ai-snapshot';
import { listAudit } from '@/lib/ai-audit-log';

const PENDING_DIR = path.join(TEST_DATA_DIR, 'ai-pending');

function makeTempTarget(initialContent: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hitl-e2e-${randomBytes(4).toString('hex')}-`));
  const target = path.join(dir, 'target.txt');
  fs.writeFileSync(target, initialContent, 'utf-8');
  return target;
}

function wipeState(): void {
  const g = globalThis as { __aiAuditCache?: { entries?: unknown[]; dirty?: boolean } };
  if (g.__aiAuditCache && Array.isArray(g.__aiAuditCache.entries)) {
    g.__aiAuditCache.entries.length = 0;
    g.__aiAuditCache.dirty = false;
  }
  try {
    if (fs.existsSync(PENDING_DIR)) {
      for (const f of fs.readdirSync(PENDING_DIR)) {
        try { fs.unlinkSync(path.join(PENDING_DIR, f)); } catch {}
      }
    }
  } catch {}
  try {
    const logFile = path.join(TEST_DATA_DIR, 'ai-audit-log.json');
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
  } catch {}
}

describe('HITL e2e: pending → approve → revert 完整闭环', () => {
  beforeEach(() => { wipeState(); });

  it('high-risk 写盘 → pending → list 看到 → approve → 应用 + snapshot + audit applied → revert 文件恢复', async () => {
    const target = makeTempTarget('VERSION_1_ORIGINAL_CONTENT');

    // 1) high-risk write → 应该 pending，applyFn 不被调用
    const proposal = buildProposal({
      operation: 'hitl-e2e-test',
      targetFile: target,
      before: 'VERSION_1_ORIGINAL_CONTENT',
      after: 'VERSION_2_AI_PROPOSED',
      metadata: { model: 'test-model', videoId: 'test' },
      actor: 'test:e2e',
    });

    let applyCallCount = 0;
    const result1 = await safeAiWrite(
      proposal,
      { riskLevel: 'high' },
      () => {
        applyCallCount++;
        fs.writeFileSync(target, 'VERSION_2_AI_PROPOSED', 'utf-8');
        return 'applied';
      },
    );

    expect(result1.status).toBe('pending');
    expect(result1.proposalId).toBe(proposal.id);
    expect(applyCallCount).toBe(0);
    expect(fs.readFileSync(target, 'utf-8')).toBe('VERSION_1_ORIGINAL_CONTENT');

    // 2) listPendingProposals 应该看到
    const pending = listPendingProposals();
    const found = pending.find(p => p.id === proposal.id);
    expect(found).toBeDefined();
    expect(found?.operation).toBe('hitl-e2e-test');

    // 3) audit log 此时应该有 proposed 记录但没 applied
    const auditAfterPropose = listAudit();
    const proposeEntry = auditAfterPropose.find(a => a.proposalId === proposal.id && a.action === 'proposed');
    expect(proposeEntry).toBeDefined();
    expect(auditAfterPropose.find(a => a.proposalId === proposal.id && a.action === 'applied')).toBeUndefined();

    // 4) approvePendingProposal → applyFn 真的跑
    let approveCallCount = 0;
    const result2 = await approvePendingProposal(proposal.id, (p) => {
      approveCallCount++;
      expect(p.id).toBe(proposal.id);
      fs.writeFileSync(target, String(p.after), 'utf-8');
      return 'approved-applied';
    });

    expect(result2.status).toBe('applied');
    expect(result2.result).toBe('approved-applied');
    expect(approveCallCount).toBe(1);
    expect(fs.readFileSync(target, 'utf-8')).toBe('VERSION_2_AI_PROPOSED');

    // 5) pending 文件应该已被删
    expect(listPendingProposals().find(p => p.id === proposal.id)).toBeUndefined();

    // 6) snapshot 应该已生成（approvePendingProposal 内部会调 snapshotBefore）
    const snapshots = listSnapshots(target);
    expect(snapshots.length).toBeGreaterThan(0);
    // snapshot 应该保留的是 apply 前的内容
    const snapContent = fs.readFileSync(snapshots[0].snapshotPath, 'utf-8');
    expect(snapContent).toBe('VERSION_1_ORIGINAL_CONTENT');

    // 7) audit log 应该有 applied 记录
    const auditAfterApply = listAudit();
    const applyEntry = auditAfterApply.find(a => a.proposalId === proposal.id && a.action === 'applied');
    expect(applyEntry).toBeDefined();

    // 8) revert 流程：用 snapshot 把文件恢复回 V1
    const reverted = revertToSnapshot(target, snapshots[0].snapshotPath);
    expect(reverted).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('VERSION_1_ORIGINAL_CONTENT');
  });

  it('reject 流程：pending → reject → 文件不被改 + pending 文件被删 + audit rejected', async () => {
    const target = makeTempTarget('UNCHANGED');

    const proposal = buildProposal({
      operation: 'hitl-reject-test',
      targetFile: target,
      before: 'UNCHANGED',
      after: 'NEVER_APPLIED',
      metadata: { model: 'test-model' },
      actor: 'test:e2e',
    });

    await safeAiWrite(proposal, { riskLevel: 'high' }, () => { throw new Error('不应被调用'); });

    const ok = rejectPendingProposal(proposal.id, '测试 reject');
    expect(ok).toBe(true);

    // 文件不变
    expect(fs.readFileSync(target, 'utf-8')).toBe('UNCHANGED');
    // pending 文件已删
    expect(listPendingProposals().find(p => p.id === proposal.id)).toBeUndefined();
    // audit 有 rejected
    const rejectedEntry = listAudit().find(a => a.proposalId === proposal.id && a.action === 'rejected');
    expect(rejectedEntry).toBeDefined();
    expect(rejectedEntry?.errorMsg).toContain('测试 reject');
  });

  it('AI_HITL_BYPASS=1 时 high-risk 直接 apply（紧急 bypass）', async () => {
    const target = makeTempTarget('V1');
    const originalEnv = process.env.AI_HITL_BYPASS;
    process.env.AI_HITL_BYPASS = '1';

    try {
      const proposal = buildProposal({
        operation: 'hitl-bypass-test',
        targetFile: target,
        before: 'V1',
        after: 'V2',
        metadata: { model: 'test-model' },
        actor: 'test:bypass',
      });

      const result = await safeAiWrite(
        proposal,
        { riskLevel: 'high' },
        () => {
          fs.writeFileSync(target, 'V2', 'utf-8');
          return 'bypass-applied';
        },
      );

      expect(result.status).toBe('applied');
      expect(fs.readFileSync(target, 'utf-8')).toBe('V2');
      // pending 文件不应被写（bypass 模式直接 apply）
      expect(listPendingProposals().find(p => p.id === proposal.id)).toBeUndefined();
    } finally {
      if (originalEnv === undefined) delete process.env.AI_HITL_BYPASS;
      else process.env.AI_HITL_BYPASS = originalEnv;
    }
  });
});
