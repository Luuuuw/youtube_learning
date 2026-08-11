// POST /api/flashcards/generate
//   admin-only. body: { videoId }
//   调 generateFlashcards(videoId) 让 AI 跑三批（vocab/listening/sentence），
//   落到 public/content/<videoId>/flashcards.json（草稿）。
//   ⚠️ ~30-60s 走 DeepSeek，不做 streaming。
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-middleware';
import { generateFlashcards } from '@/lib/flashcard-gen';
import { flashcardDb, SHARED_OWNER } from '@/lib/flashcard-db';

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) {
    if (!auth.role) return unauthorizedResponse();
    return forbiddenResponse();
  }

  let body: { videoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const videoId = body.videoId;
  if (!videoId || typeof videoId !== 'string') {
    return NextResponse.json({ error: '缺少 videoId' }, { status: 400 });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return NextResponse.json({ error: 'videoId 格式非法' }, { status: 400 });
  }

  try {
    const { cards, stats } = await generateFlashcards(videoId);

    // 自动审批入库
    let imported = 0;
    if (cards.length > 0) {
      imported = flashcardDb.addCards(cards.map(c => ({
        videoId: c.videoId,
        dimension: c.dimension,
        type: c.type,
        front: c.front,
        back: c.back,
        context: c.context,
        audioStart: c.audioStart,
        audioEnd: c.audioEnd,
        hint: c.hint,
        tags: c.tags,
        word: c.word,
        owner: SHARED_OWNER,
        source: c.source || 'ai',
        reviewedByAdmin: false,
      }))).length;
    }

    return NextResponse.json({
      success: true,
      stats,
      count: cards.length,
      imported,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成失败';
    console.error('[flashcards/generate]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
