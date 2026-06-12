import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { revalidatePath } from 'next/cache';
import authSessions from '@/lib/auth-sessions';

const PROGRESS_FILE = path.join(process.cwd(), 'download-progress.json');

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

function getProgress() {
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
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
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

function setProgress(progress: any) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
  } catch {
    // 写入失败静默处理
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  try {
    const { urls } = await req.json();
    if (!Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: '缺少 urls 参数' }, { status: 400 });
    }

    setProgress({
      status: 'running',
      total: urls.length,
      completed: 0,
      failed: 0,
      currentUrl: urls[0],
      currentTitle: '',
      logs: [`开始下载 ${urls.length} 个视频...`],
      perVideo: {} as Record<string, { url: string; title?: string; status: string; pct: number; error?: string }>,
      updatedAt: new Date().toISOString(),
    });

    const scriptPath = path.join(process.cwd(), 'batch_downloader.py');
    const urlsFile = path.join(process.cwd(), '.batch-urls-tmp.txt');

    try {
      fs.writeFileSync(urlsFile, urls.join('\n'), 'utf-8');
    } catch (e: any) {
      return NextResponse.json({ error: '无法写入临时文件: ' + e.message }, { status: 500 });
    }

    try {
      const child = spawn('python', [scriptPath, urlsFile], {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let completed = 0;
      let failed = 0;

      child.stdout?.on('data', (data: Buffer) => {
        try {
          const lines = data.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            const prev = getProgress();
            const perVideo = (prev.perVideo || {}) as Record<string, { url: string; title?: string; status: string; pct: number; error?: string }>;

            // 解析结构化进度行 [VPROG] <vid> <status> <rest>
            const vprog = line.match(/^\[VPROG\]\s+(\S+)\s+(\S+)(?:\s+(.*))?$/);
            if (vprog) {
              const [, vid, status, rest] = vprog;
              const cur = perVideo[vid] || { url: '', status: 'queued', pct: 0 };
              if (status === 'queued') {
                cur.status = 'queued'; cur.url = rest || cur.url;
              } else if (status === 'started') {
                cur.status = 'downloading'; cur.url = rest || cur.url;
              } else if (status === 'downloading') {
                cur.status = 'downloading';
                const p = parseFloat(rest || '0');
                if (!isNaN(p)) cur.pct = p;
              } else if (status === 'done') {
                cur.status = 'done'; cur.pct = 100; cur.title = rest || cur.title;
                completed++;
              } else if (status === 'failed') {
                cur.status = 'failed'; cur.error = rest;
                failed++;
              } else if (status === 'skipped') {
                cur.status = 'skipped'; cur.pct = 100;
                completed++;
              }
              perVideo[vid] = cur;
              setProgress({
                ...prev,
                status: 'running',
                total: urls.length,
                completed,
                failed,
                currentUrl: cur.url || prev.currentUrl,
                currentTitle: cur.title || '',
                perVideo,
                updatedAt: new Date().toISOString(),
              });
              continue;
            }

            // 兼容旧的中文日志（仅用于 logs 滚动显示，不再用作计数）
            setProgress({
              ...prev,
              status: 'running',
              total: urls.length,
              completed,
              failed,
              perVideo,
              logs: [...(prev.logs || []).slice(-49), line.replace(/^\S+\s+\[\w+\]\s*/, '')],
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          // 日志处理出错不影响下载
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        try {
          const line = data.toString().trim();
          if (line) {
            const prev = getProgress();
            setProgress({
              ...prev,
              logs: [...prev.logs.slice(-49), `[ERR] ${line}`],
              updatedAt: new Date().toISOString(),
            });
          }
        } catch {
          // 忽略
        }
      });

      child.on('close', (code) => {
        try {
          const p = getProgress();
          setProgress({
            ...p,
            status: code === 0 ? 'completed' : 'error',
            updatedAt: new Date().toISOString(),
          });
          if (code === 0) revalidatePath('/');
        } catch {
          // 忽略
        }
        try {
          fs.unlinkSync(urlsFile);
        } catch {}
      });

      return NextResponse.json({ success: true, total: urls.length });
    } catch (e: any) {
      return NextResponse.json({ error: '启动下载进程失败: ' + e.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '未知错误' }, { status: 500 });
  }
}
