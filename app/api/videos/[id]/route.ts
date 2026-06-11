import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getVideoById } from '@/lib/videos';
import authSessions from '@/lib/auth-sessions';
import { revalidatePath } from 'next/cache';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';

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

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = verifyAuth(request);
  if (!auth.valid) return unauthorizedResponse();
  try {
    const video = getVideoById(params.id);
    if (!video) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }
    return NextResponse.json(video);
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '获取视频失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  const { id } = params;

  if (!VALID_VIDEO_ID.test(id)) {
    return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
  }

  const videoDir = path.join(CONTENT_DIR, id);
  if (!fs.existsSync(videoDir)) {
    return NextResponse.json({ error: '视频不存在' }, { status: 404 });
  }

  try {
    fs.rmSync(videoDir, { recursive: true, force: true });
    revalidatePath('/');
    revalidatePath(`/${id}`);
    return NextResponse.json({ success: true, id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
