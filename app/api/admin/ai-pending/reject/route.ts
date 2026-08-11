// POST /api/admin/ai-pending/reject body {ids: string[], reason?: string}
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { rejectPendingProposal } from '@/lib/safe-ai-write';

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) return forbiddenResponse();

  let body: { ids?: unknown; reason?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '无效 JSON' }, { status: 400 }); }
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') as string[] : [];
  const reason = typeof body.reason === 'string' ? body.reason : 'admin 拒绝';
  if (ids.length === 0) return NextResponse.json({ error: '缺 ids' }, { status: 400 });

  let rejected = 0;
  let notFound = 0;
  for (const id of ids) {
    if (rejectPendingProposal(id, reason)) rejected++;
    else notFound++;
  }
  return NextResponse.json({ rejected, notFound });
}
