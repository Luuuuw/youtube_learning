import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';
import { computeAllVideoHealth } from '@/lib/video-health';

function checkAdmin(req: NextRequest): { authorized: boolean; error?: NextResponse } {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { authorized: false, error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return { authorized: false, error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  if (session.role !== 'admin') return { authorized: false, error: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  return { authorized: true };
}

export async function GET(req: NextRequest) {
  const check = checkAdmin(req);
  if (!check.authorized) return check.error!;

  const { videos, summary } = computeAllVideoHealth();
  return NextResponse.json({ videos, summary });
}
