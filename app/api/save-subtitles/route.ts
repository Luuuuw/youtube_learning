import { NextRequest, NextResponse } from 'next/server';
import { saveZhSubtitles } from '@/lib/translate';
import { parseVtt, Subtitle } from '@/lib/vtt-parser';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

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

    const parsedSubtitles: Subtitle[] = subtitles.map((s) => ({
      id: s.id,
      startTime: s.startTime,
      endTime: s.endTime,
      text: s.text,
    }));

    saveZhSubtitles(videoId, parsedSubtitles);

    const zhJsonPath = path.join(videoDir, 'video.zh-Hans.json');
    let zhSubtitles: Subtitle[] = [];
    try {
      const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
      zhSubtitles = parsedSubtitles.map(s => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        text: jsonMap[s.id] || '',
      }));
    } catch {
      zhSubtitles = parsedSubtitles;
    }

    return NextResponse.json({
      message: '字幕保存成功',
      count: zhSubtitles.length,
      zhSubtitles,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
