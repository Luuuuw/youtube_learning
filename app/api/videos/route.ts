import { NextResponse } from 'next/server';
import { getVideoList } from '@/lib/videos';

export async function GET() {
  try {
    const videos = getVideoList();
    return NextResponse.json(videos);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '获取视频列表失败' }, { status: 500 });
  }
}
