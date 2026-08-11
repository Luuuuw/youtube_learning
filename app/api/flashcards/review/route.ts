// POST /api/flashcards/review { cardId, rating, durationMs }
//      → FSRS 调度，返回新的 state
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { flashcardDb } from '@/lib/flashcard-db';
import type { FlashcardRating } from '@/lib/flashcard-fsrs';

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;

  let body: { cardId?: string; rating?: number; durationMs?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '无效 JSON' }, { status: 400 });
  }

  const { cardId, rating, durationMs } = body;
  if (!cardId || typeof cardId !== 'string') {
    return NextResponse.json({ error: '缺 cardId' }, { status: 400 });
  }
  if (rating !== 1 && rating !== 2 && rating !== 3 && rating !== 4) {
    return NextResponse.json({ error: 'rating 必须是 1-4' }, { status: 400 });
  }

  let state;
  try {
    state = flashcardDb.reviewCard(
      cardId,
      owner,
      rating as FlashcardRating,
      typeof durationMs === 'number' ? durationMs : 0,
    );
  } catch (e) {
    console.error('[review] 评分失败:', (e as Error).message);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
  if (!state) {
    return NextResponse.json({ error: '卡片不存在或无权限' }, { status: 404 });
  }
  return NextResponse.json({ state });
}
