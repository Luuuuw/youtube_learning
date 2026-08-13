import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-middleware';
import { DATA_DIR } from '@/lib/data-dir';

// 只读导出用户数据文件（不含 git 公共资产、临时文件、AI 审计日志），仅 admin 可访问。
// 返回原始文件内容（字符串），脚本端原样写回，避免二次 JSON 解析破坏数据。

const BACKUP_FILES = [
  'users.json',
  'sessions.json',
  'activity.json',
  'vocab.json',
  'flashcard-state.json',
  'flashcard-logs.json',
  'review-log.json',
  'flashcard-daily.json',
  'announcement.json',
];

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  if (auth.role !== 'admin') return forbiddenResponse();

  const files: Record<string, string> = {};
  for (const name of BACKUP_FILES) {
    try {
      files[name] = fs.readFileSync(path.join(DATA_DIR, name), 'utf-8');
    } catch {
      files[name] = '';
    }
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    files,
  });
}
