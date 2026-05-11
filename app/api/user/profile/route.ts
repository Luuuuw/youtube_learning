import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { getAllWords, getTodayStats, getWeeklyStats, getAllReviewLogs } from '@/lib/vocab-db';
import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  try {
    const words = getAllWords(auth.code);
    const stats = getTodayStats(auth.code);
    const weekly = getWeeklyStats();

    let videoCount = 0;
    if (fs.existsSync(CONTENT_DIR)) {
      const dirs = fs.readdirSync(CONTENT_DIR);
      videoCount = dirs.filter(d => fs.existsSync(path.join(CONTENT_DIR, d, 'video.mp4'))).length;
    }

    const recentLogs = getAllReviewLogs().slice(0, 30);
    const totalReviews = recentLogs.length;
    const remembered = recentLogs.filter(l => l.result === 'remember').length;

    return NextResponse.json({
      code: auth.code,
      role: auth.role,
      vocabCount: words.length,
      masteredCount: words.filter(w => w.proficiency >= 4).length,
      learningCount: words.filter(w => w.proficiency > 0 && w.proficiency < 4).length,
      newCount: words.filter(w => w.proficiency === 0).length,
      todayDue: stats.due,
      todayNew: stats.new,
      todayMastered: stats.mastered,
      todayTotal: stats.total,
      weekly,
      videoCount,
      totalReviews,
      rememberRate: totalReviews > 0 ? Math.round((remembered / totalReviews) * 100) : 0,
      joinedAt: words.length > 0 ? words[0].createdAt : null,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
