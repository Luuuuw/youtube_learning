// GET /api/flashcards/stats
//     → 当前用户的统计：到期 / 新卡 / 已掌握 / 各维度计数 / 近期复习次数
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { flashcardDb } from '@/lib/flashcard-db';

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  try {
    return NextResponse.json(flashcardDb.getUserStats(owner));
  } catch (e) {
    console.error('[flashcards/stats] 查询失败:', (e as Error).message);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
