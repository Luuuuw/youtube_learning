import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';
import { revalidatePath } from 'next/cache';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

const VALID_CATEGORIES = ['beauty', 'tech', 'lifestyle', 'education', 'entertainment', 'business', 'travel', 'food', 'fitness', 'vlog', 'other'];
const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
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

export async function PUT(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  try {
    const { videoId, category, difficulty } = await req.json();

    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: '缺少 videoId 参数' }, { status: 400 });
    }

    if (!VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }

    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: '无效的分类' }, { status: 400 });
    }

    if (difficulty && !VALID_DIFFICULTIES.includes(difficulty)) {
      return NextResponse.json({ error: '无效的难度等级' }, { status: 400 });
    }

    const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return NextResponse.json({ error: '视频不存在' }, { status: 404 });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    if (category) meta.category = category;
    if (difficulty) meta.difficulty = difficulty;

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    revalidatePath('/');
    revalidatePath(`/${videoId}`);

    return NextResponse.json({
      videoId,
      category: meta.category,
      difficulty: meta.difficulty,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
