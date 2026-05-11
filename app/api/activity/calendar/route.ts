import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { getRecentActivity } from '@/lib/activity-db';

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  try {
    const data = getRecentActivity(auth.code!, 90);
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
