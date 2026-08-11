// GET /api/admin/ai-audit?proposalId=&action=&limit=
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { listAudit, type AuditEntry } from '@/lib/ai-audit-log';

export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) return forbiddenResponse();

  const url = new URL(req.url);
  const proposalId = url.searchParams.get('proposalId') || undefined;
  const actionRaw = url.searchParams.get('action');
  const validActions: Array<AuditEntry['action']> = ['proposed', 'applied', 'rejected', 'reverted'];
  const action = validActions.includes(actionRaw as AuditEntry['action'])
    ? (actionRaw as AuditEntry['action'])
    : undefined;
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 100, 1), 500);

  const entries = listAudit({ proposalId, action, limit });
  return NextResponse.json({ entries });
}
