import { NextRequest, NextResponse } from 'next/server';
import { getVideoList } from '@/lib/videos';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  try {
    const videos = getVideoList();
    return NextResponse.json(videos);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '获取视频列表失败' }, { status: 500 });
  }
}
