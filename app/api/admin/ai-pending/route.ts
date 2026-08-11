// GET /api/admin/ai-pending → 列 staging 区所有 pending 提案
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { listPendingProposals } from '@/lib/safe-ai-write';

export async function GET(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) return forbiddenResponse();
  return NextResponse.json({ proposals: listPendingProposals() });
}
