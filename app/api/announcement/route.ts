import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';
import { verifyAuth, unauthorizedResponse, verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { DATA_DIR } from '@/lib/data-dir';

const FILE = path.join(DATA_DIR, 'announcement.json');

function readAnnouncement() {
  try {
    if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return null;
  } catch {
    return null;
  }
}

function writeAnnouncement(data: Record<string, unknown>) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const data = readAnnouncement();
  return NextResponse.json({ announcement: data || null });
}

export async function PUT(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const session = authSessions.get(token);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可编辑' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { content } = body;
    if (typeof content !== 'string' || content.trim().length < 50) {
      return NextResponse.json({ error: '公告内容至少需要50个字符' }, { status: 400 });
    }

    const data = {
      content: content.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: session.code,
    };
    writeAnnouncement(data);
    return NextResponse.json({ success: true, announcement: data });
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
}
