// IMPORTANT: fixture import must come FIRST.
// Sets process.env.DATA_DIR before lib/data-dir.ts captures it at module-init.
import { TEST_DATA_DIR } from './_data-dir-fixture';

import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  logProposed,
  logApplied,
  logRejected,
  listAudit,
  flushAuditLog,
} from '@/lib/ai-audit-log';
import type { AiProposal } from '@/lib/safe-ai-write';

const LOG_PATH = path.join(TEST_DATA_DIR, 'ai-audit-log.json');

function makeProposal(id = 'p-' + randomBytes(3).toString('hex'), op = 'translate'): AiProposal {
  return {
    id,
    operation: op,
    targetFile: '/tmp/foo.vtt',
    before: 'a',
    after: 'b',
    metadata: { model: 'minimax' },
    actor: 'tester',
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

function wipeAuditState(): void {
  // Drain the singleton AuditLogCache's in-memory entries.
  const g = globalThis as { __aiAuditCache?: { entries?: unknown[]; dirty?: boolean } };
  if (g.__aiAuditCache && Array.isArray(g.__aiAuditCache.entries)) {
    g.__aiAuditCache.entries.length = 0;
    g.__aiAuditCache.dirty = false;
  }
  try { if (fs.existsSync(LOG_PATH)) fs.unlinkSync(LOG_PATH); } catch {}
  // Remove any rotated dated copies left behind by a prior test
  try {
    for (const f of fs.readdirSync(TEST_DATA_DIR)) {
      if (f.startsWith('ai-audit-log.') && f.endsWith('.json')) {
        try { fs.unlinkSync(path.join(TEST_DATA_DIR, f)); } catch {}
      }
    }
  } catch {}
}

beforeEach(() => {
  wipeAuditState();
});

afterAll(() => {
  try { fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }); } catch {}
});

describe('ai-audit-log', () => {
  it('logProposed appends an entry retrievable via listAudit', () => {
    const p = makeProposal('prop-1');
    logProposed(p);
    const list = listAudit();
    expect(list).toHaveLength(1);
    expect(list[0].proposalId).toBe('prop-1');
    expect(list[0].action).toBe('proposed');
  });

  it('logApplied adds an "applied" entry referencing the proposal id', () => {
    logProposed(makeProposal('prop-2'));
    logApplied('prop-2', '/tmp/foo.snapshot-1.bak', 42);
    const applied = listAudit({ action: 'applied' });
    expect(applied).toHaveLength(1);
    expect(applied[0].proposalId).toBe('prop-2');
    expect(applied[0].snapshotPath).toBe('/tmp/foo.snapshot-1.bak');
    expect(applied[0].durationMs).toBe(42);
  });

  it('listAudit filters by action', () => {
    logProposed(makeProposal('a'));
    logProposed(makeProposal('b'));
    logRejected('a', 'reason');
    expect(listAudit({ action: 'rejected' })).toHaveLength(1);
    expect(listAudit({ action: 'proposed' })).toHaveLength(2);
  });

  it('listAudit filters by proposalId', () => {
    logProposed(makeProposal('alpha'));
    logProposed(makeProposal('beta'));
    logApplied('alpha', null, 10);
    const filtered = listAudit({ proposalId: 'alpha' });
    expect(filtered).toHaveLength(2);
    expect(filtered.every((e) => e.proposalId === 'alpha')).toBe(true);
  });

  it('listAudit honors limit', () => {
    for (let i = 0; i < 5; i++) logProposed(makeProposal(`p-${i}`));
    expect(listAudit({ limit: 2 })).toHaveLength(2);
  });

  it('rotation: oversized log gets rotated to a dated file and main log starts fresh', () => {
    // Pre-seed the on-disk audit log with >10MB so the next append triggers rotation.
    const bigEntry = {
      id: 'x', ts: new Date().toISOString(), proposalId: 'old',
      action: 'proposed', padding: 'A'.repeat(2000),
    };
    const bigArray = Array.from({ length: 6000 }, () => bigEntry); // ~12MB
    fs.writeFileSync(LOG_PATH, JSON.stringify(bigArray), 'utf-8');
    expect(fs.statSync(LOG_PATH).size).toBeGreaterThan(10 * 1024 * 1024);

    // maybeRotate() runs inside append() and reads file size.
    logProposed(makeProposal('post-rotate'));
    flushAuditLog();

    const today = new Date().toISOString().slice(0, 10);
    const rotatedPath = path.join(TEST_DATA_DIR, `ai-audit-log.${today}.json`);
    expect(fs.existsSync(rotatedPath)).toBe(true);

    // After rotation, in-memory entries reset and a fresh flush wrote a small array.
    expect(fs.statSync(LOG_PATH).size).toBeLessThan(10 * 1024 * 1024);
  });
});
