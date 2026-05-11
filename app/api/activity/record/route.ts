import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { recordView } from '@/lib/activity-db';

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  try {
    const { videoId } = await req.json();
    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: '缺少 videoId' }, { status: 400 });
    }
    recordView(auth.code!, videoId);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
