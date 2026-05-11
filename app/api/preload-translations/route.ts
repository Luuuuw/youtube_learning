import { NextRequest, NextResponse } from 'next/server';
import { translateSubtitlesForVideo, getVideosNeedingTranslation } from '@/lib/translate';
import { parseVtt } from '@/lib/vtt-parser';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

function verifyAdmin(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) return false;
  return session.role === 'admin';
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  try {
    const videos = getVideosNeedingTranslation();
    const toTranslate = videos.filter((v) => v.hasEn && !v.hasZh);

    if (toTranslate.length === 0) {
      return NextResponse.json({ message: '所有视频已有中文字幕', total: videos.length, translated: 0 });
    }

    const results: { videoId: string; status: string; count?: number }[] = [];

    for (const video of toTranslate) {
      try {
        const enVttPath = path.join(CONTENT_DIR, video.videoId, 'video.en.vtt');
        const enSubtitles = parseVtt(fs.readFileSync(enVttPath, 'utf-8'));

        const zhSubtitles = await translateSubtitlesForVideo(video.videoId, enSubtitles);

        results.push({
          videoId: video.videoId,
          status: zhSubtitles.length > 0 ? 'ok' : 'failed',
          count: zhSubtitles.length,
        });
      } catch (e: unknown) {
        results.push({
          videoId: video.videoId,
          status: `error: ${e instanceof Error ? e.message : '未知错误'}`,
        });
      }
    }

    const successCount = results.filter((r) => r.status === 'ok').length;

    return NextResponse.json({
      message: `翻译完成: ${successCount}/${toTranslate.length} 成功`,
      total: videos.length,
      translated: successCount,
      details: results,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const videos = getVideosNeedingTranslation();
  const toTranslate = videos.filter((v) => v.hasEn && !v.hasZh);
  return NextResponse.json({
    total: videos.length,
    hasZh: videos.filter((v) => v.hasZh).length,
    needsTranslation: toTranslate.length,
    videos: toTranslate.map((v) => v.videoId),
  });
}
