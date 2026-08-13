// IMPORTANT: this fixture must be imported FIRST.
// It sets process.env.DATA_DIR before lib/data-dir.ts captures it at module-init.
import { TEST_DATA_DIR } from './_data-dir-fixture';

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import {
  buildProposal,
  safeAiWrite,
  listPendingProposals,
  getPendingProposal,
  removePendingProposal,
} from '@/lib/safe-ai-write';
import { listAudit, flushAuditLog } from '@/lib/ai-audit-log';
import type { AiProposal } from '@/lib/safe-ai-write';
import type { Invariant } from '@/lib/ai-invariants';

const PENDING_DIR = path.join(TEST_DATA_DIR, 'ai-pending');

function wipeState(): void {
  // Clear in-memory audit cache (singleton lives on globalThis)
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

let savedBypass: string | undefined;

beforeEach(() => {
  savedBypass = process.env.AI_HITL_BYPASS;
  delete process.env.AI_HITL_BYPASS;
  wipeState();
});

afterAll(() => {
  if (savedBypass === undefined) delete process.env.AI_HITL_BYPASS;
  else process.env.AI_HITL_BYPASS = savedBypass;
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

function proposalArgs(overrides: Partial<AiProposal> = {}): Omit<AiProposal, 'id' | 'createdAt' | 'status'> {
  return {
    operation: overrides.operation ?? 'translate',
    targetFile: overrides.targetFile ?? path.join(TEST_DATA_DIR, 'target.vtt'),
    before: overrides.before ?? 'hello',
    after: overrides.after ?? '你好',
    metadata: overrides.metadata ?? { model: 'minimax' },
    actor: overrides.actor ?? 'tester',
  };
}

describe('buildProposal', () => {
  it('produces an object with id, ISO createdAt, status=pending', () => {
    const p = buildProposal(proposalArgs());
    expect(typeof p.id).toBe('string');
    expect(p.id.length).toBeGreaterThan(0);
    expect(p.status).toBe('pending');
    expect(p.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(p.operation).toBe('translate');
    expect(p.actor).toBe('tester');
  });

  it('two consecutive buildProposal calls yield distinct ids', () => {
    const a = buildProposal(proposalArgs());
    const b = buildProposal(proposalArgs());
    expect(a.id).not.toBe(b.id);
  });

  it('respects caller-supplied id', () => {
    const p = buildProposal({ ...proposalArgs(), id: 'fixed-id-123' });
    expect(p.id).toBe('fixed-id-123');
  });
});

describe('safeAiWrite — low/medium risk happy path', () => {
  it('low risk + no invariants: calls applyFn and returns status=applied with result', async () => {
    const p = buildProposal(proposalArgs());
    const applyFn = vi.fn(async () => 'apply-result');
    const r = await safeAiWrite(p, { riskLevel: 'low' }, applyFn);
    expect(r.status).toBe('applied');
    expect(r.result).toBe('apply-result');
    expect(r.proposalId).toBe(p.id);
    expect(applyFn).toHaveBeenCalledTimes(1);
  });

  it('medium risk: snapshots targetFile (if exists) before apply', async () => {
    const target = path.join(TEST_DATA_DIR, `snap-target-${randomBytes(3).toString('hex')}.vtt`);
    fs.writeFileSync(target, 'before-content', 'utf-8');

    const p = buildProposal(proposalArgs({ targetFile: target }));
    const applyFn = vi.fn(() => {
      const dir = path.dirname(target);
      const baseName = path.basename(target);
      const sibling = fs.readdirSync(dir).filter((f) => f.startsWith(`${baseName}.snapshot-`) && f.endsWith('.bak'));
      expect(sibling.length).toBeGreaterThanOrEqual(1);
      fs.writeFileSync(target, 'after-content', 'utf-8');
      return 'done';
    });

    const r = await safeAiWrite(p, { riskLevel: 'medium' }, applyFn);
    expect(r.status).toBe('applied');
    expect(applyFn).toHaveBeenCalledTimes(1);
  });
});

describe('safeAiWrite — invariant rejection', () => {
  it('rejects when an invariant returns an error; applyFn is NEVER called', async () => {
    const p = buildProposal(proposalArgs({ after: '' }));
    const applyFn = vi.fn(async () => 'should-not-run');
    const failingInv: Invariant = () => 'forced failure';

    const r = await safeAiWrite(p, { riskLevel: 'low', invariants: [failingInv] }, applyFn);

    expect(r.status).toBe('rejected');
    expect(r.reason).toMatch(/invariants 失败/);
    expect(r.reason).toMatch(/forced failure/);
    expect(applyFn).not.toHaveBeenCalled();
  });

  it('rejected proposals emit a "rejected" audit entry', async () => {
    const p = buildProposal(proposalArgs());
    const failingInv: Invariant = () => 'nope';

    await safeAiWrite(p, { riskLevel: 'low', invariants: [failingInv] }, async () => 'x');
    flushAuditLog();
    const rejected = listAudit({ proposalId: p.id, action: 'rejected' });
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });
});

describe('safeAiWrite — high risk HITL', () => {
  it('writes pending JSON file under DATA_DIR/ai-pending/{id}.json; applyFn NOT called', async () => {
    const p = buildProposal(proposalArgs());
    const applyFn = vi.fn(async () => 'should-not-run');

    const r = await safeAiWrite(p, { riskLevel: 'high' }, applyFn);

    expect(r.status).toBe('pending');
    expect(r.proposalId).toBe(p.id);
    expect(applyFn).not.toHaveBeenCalled();

    const pendingPath = path.join(PENDING_DIR, `${p.id}.json`);
    expect(fs.existsSync(pendingPath)).toBe(true);
    const saved: AiProposal = JSON.parse(fs.readFileSync(pendingPath, 'utf-8'));
    expect(saved.id).toBe(p.id);
    expect(saved.operation).toBe('translate');
  });

  it('high-risk path still emits a "proposed" audit entry', async () => {
    const p = buildProposal(proposalArgs());
    await safeAiWrite(p, { riskLevel: 'high' }, async () => 'x');
    flushAuditLog();
    const proposed = listAudit({ proposalId: p.id, action: 'proposed' });
    expect(proposed.length).toBeGreaterThanOrEqual(1);
  });

  it('bypassHitl=true on high risk applies directly', async () => {
    const p = buildProposal(proposalArgs());
    const applyFn = vi.fn(async () => 'applied-via-bypass');
    const r = await safeAiWrite(p, { riskLevel: 'high', bypassHitl: true }, applyFn);
    expect(r.status).toBe('applied');
    expect(r.result).toBe('applied-via-bypass');
    expect(applyFn).toHaveBeenCalledTimes(1);
  });

  it('AI_HITL_BYPASS=1 env on high risk applies directly', async () => {
    process.env.AI_HITL_BYPASS = '1';
    const p = buildProposal(proposalArgs());
    const applyFn = vi.fn(async () => 'env-bypass');
    const r = await safeAiWrite(p, { riskLevel: 'high' }, applyFn);
    expect(r.status).toBe('applied');
    expect(applyFn).toHaveBeenCalledTimes(1);
  });
});

describe('safeAiWrite — applyFn throws', () => {
  it('returns status=rejected with applyFn error reason; emits rejected audit entry', async () => {
    const p = buildProposal(proposalArgs());
    const applyFn = vi.fn(async () => {
      throw new Error('disk full');
    });
    const r = await safeAiWrite(p, { riskLevel: 'low' }, applyFn);
    expect(r.status).toBe('rejected');
    expect(r.reason).toMatch(/applyFn 失败/);
    expect(r.reason).toMatch(/disk full/);

    flushAuditLog();
    const rejected = listAudit({ proposalId: p.id, action: 'rejected' });
    expect(rejected.length).toBeGreaterThanOrEqual(1);
  });
});

describe('safeAiWrite — concurrency', () => {
  it('two parallel calls for the same target each succeed with distinct ids', async () => {
    const target = path.join(TEST_DATA_DIR, 'parallel.vtt');
    fs.writeFileSync(target, 'shared', 'utf-8');

    const p1 = buildProposal(proposalArgs({ targetFile: target }));
    const p2 = buildProposal(proposalArgs({ targetFile: target }));
    expect(p1.id).not.toBe(p2.id);

    const [r1, r2] = await Promise.all([
      safeAiWrite(p1, { riskLevel: 'low' }, async () => 'one'),
      safeAiWrite(p2, { riskLevel: 'low' }, async () => 'two'),
    ]);

    expect(r1.status).toBe('applied');
    expect(r2.status).toBe('applied');
    expect(r1.proposalId).not.toBe(r2.proposalId);
    expect(new Set([r1.result, r2.result])).toEqual(new Set(['one', 'two']));
  });
});

describe('safeAiWrite — pending list helpers', () => {
  it('listPendingProposals returns the proposal written by a high-risk call', async () => {
    const p = buildProposal(proposalArgs());
    await safeAiWrite(p, { riskLevel: 'high' }, async () => 'noop');

    const all = listPendingProposals();
    expect(all.find((x) => x.id === p.id)).toBeDefined();
    expect(getPendingProposal(p.id)?.id).toBe(p.id);

    const removed = removePendingProposal(p.id);
    expect(removed).toBe(true);
    expect(getPendingProposal(p.id)).toBeNull();
  });
});
