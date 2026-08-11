// POST /api/admin/ai-revert body {auditId: string}
// 找 audit entry → 验是 'applied' 且有 snapshotPath → revert + logReverted
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { findAuditById, listAudit, logReverted } from '@/lib/ai-audit-log';
import { revertToSnapshot } from '@/lib/ai-snapshot';

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) return forbiddenResponse();

  let body: { auditId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '无效 JSON' }, { status: 400 }); }
  const auditId = typeof body.auditId === 'string' ? body.auditId : '';
  if (!auditId) return NextResponse.json({ error: '缺 auditId' }, { status: 400 });

  const entry = findAuditById(auditId);
  if (!entry) return NextResponse.json({ status: 'failed', reason: 'audit entry 不存在' }, { status: 404 });
  if (entry.action !== 'applied') {
    return NextResponse.json({ status: 'failed', reason: `audit action 是 '${entry.action}' 不是 'applied'，不能 revert` }, { status: 400 });
  }
  if (!entry.snapshotPath) {
    return NextResponse.json({ status: 'failed', reason: '该 audit 无 snapshotPath（写盘时未生成备份）' }, { status: 400 });
  }

  // 从对应 proposed entry 拿 targetFile（applied entry 不带 proposal 主体）
  const proposedEntries = listAudit({ proposalId: entry.proposalId, action: 'proposed', limit: 1 });
  const targetFile = proposedEntries[0]?.proposal?.targetFile;
  if (!targetFile) {
    return NextResponse.json({ status: 'failed', reason: '找不到对应 proposed entry 的 targetFile' }, { status: 500 });
  }

  const ok = revertToSnapshot(targetFile, entry.snapshotPath);
  if (!ok) return NextResponse.json({ status: 'failed', reason: 'revertToSnapshot 失败' }, { status: 500 });

  logReverted(entry.proposalId, auditId);
  return NextResponse.json({ status: 'reverted' });
}
