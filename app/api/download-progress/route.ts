import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';

const PROGRESS_FILE = path.join(process.cwd(), 'download-progress.json');

export interface DownloadProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  completed: number;
  failed: number;
  currentUrl: string;
  currentTitle: string;
  logs: string[];
  updatedAt: string;
}

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

function getProgress(): DownloadProgress {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return {
      status: 'idle',
      total: 0,
      completed: 0,
      failed: 0,
      currentUrl: '',
      currentTitle: '',
      logs: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      status: 'idle',
      total: 0,
      completed: 0,
      failed: 0,
      currentUrl: '',
      currentTitle: '',
      logs: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

function setProgress(progress: DownloadProgress) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
  } catch {
    // 写入失败静默处理
  }
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  try {
    return NextResponse.json(getProgress());
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '获取进度失败' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  try {
    const body = await req.json();
    setProgress(body);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '更新进度失败' }, { status: 500 });
  }
}
