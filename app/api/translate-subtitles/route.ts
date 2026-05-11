import { NextRequest, NextResponse } from 'next/server';
import { translateSubtitlesForVideo } from '@/lib/translate';
import { parseVtt } from '@/lib/vtt-parser';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

function verifyAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) return false;
  return true;
}

function hasGoodAlignment(
  en: { startTime: number; endTime: number }[],
  zh: { startTime: number; endTime: number }[]
): boolean {
  if (en.length === 0 || zh.length === 0) return false;
  const sample = Math.min(en.length, 120);
  let matched = 0;
  let j = 0;
  for (let i = 0; i < sample; i++) {
    const e = en[i];
    while (j + 1 < zh.length && zh[j + 1].startTime <= e.startTime) j++;
    const candidates = [zh[j], zh[j + 1], zh[j - 1]].filter(Boolean) as { startTime: number; endTime: number }[];
    const ok = candidates.some((z) => {
      const overlap = Math.max(0, Math.min(e.endTime, z.endTime) - Math.max(e.startTime, z.startTime));
      return overlap > 0 || Math.abs(e.startTime - z.startTime) < 0.8;
    });
    if (ok) matched++;
  }
  return matched / sample >= 0.82;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { videoId, subtitles } = body as {
      videoId: string;
      subtitles: { id: number; startTime: number; endTime: number; text: string }[];
    };

    if (!videoId || !Array.isArray(subtitles) || subtitles.length === 0) {
      return NextResponse.json({ error: '缺少 videoId 或 subtitles 参数' }, { status: 400 });
    }

    if (!VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }

    const videoDir = path.join(CONTENT_DIR, videoId);
    if (!fs.existsSync(videoDir)) {
      return NextResponse.json({ error: '视频目录不存在' }, { status: 404 });
    }

    const zhVttPath = path.join(videoDir, 'video.zh-Hans.vtt');
    const zhJsonPath = path.join(videoDir, 'video.zh-Hans.json');

    if (fs.existsSync(zhVttPath)) {
      if (fs.existsSync(zhJsonPath)) {
        try {
          const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
          const zhSubtitles = subtitles.map((s) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            text: jsonMap[s.id] || '',
          }));
          return NextResponse.json({ message: '中文字幕已存在', cached: true, zhSubtitles });
        } catch {}
      }

      const zhSubtitles = parseVtt(fs.readFileSync(zhVttPath, 'utf-8'));
      if (hasGoodAlignment(subtitles, zhSubtitles)) {
        return NextResponse.json({ message: '中文字幕已存在', cached: true, zhSubtitles });
      }
    }

    const parsedSubtitles = subtitles.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      text: s.text,
    })) as import('@/lib/vtt-parser').Subtitle[];

    const zhSubtitles = await translateSubtitlesForVideo(videoId, parsedSubtitles);

    if (zhSubtitles.length === 0) {
      return NextResponse.json({ error: '翻译失败' }, { status: 500 });
    }

    return NextResponse.json({
      message: '翻译完成',
      translated: zhSubtitles.length,
      total: subtitles.length,
      zhSubtitles,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
