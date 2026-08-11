// GET  /api/flashcards?videoId=&dimension=&due_only=1
//      → 用户视角的卡片列表（自己的 + shared，词汇维度去重）
//      返回 { cards: [{...card, state: FlashcardState | null}] }
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { flashcardDb, Dimension, SHARED_OWNER } from '@/lib/flashcard-db';
import { DATA_DIR } from '@/lib/data-dir';

const VALID_DIMENSIONS: Dimension[] = ['vocab', 'listening', 'sentence'];
const MAX_NEW_CARDS_PER_DAY = 20;

interface DailyCounter {
  date: string; // YYYY-MM-DD
  newCardsShown: Record<string, number>; // owner -> count
  newCardIds: Record<string, string[]>; // owner -> card IDs shown today
}

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;

  const { searchParams } = new URL(req.url);
  const videoId = searchParams.get('videoId') || undefined;
  const dimRaw = searchParams.get('dimension');
  const dimension = (dimRaw && VALID_DIMENSIONS.includes(dimRaw as Dimension))
    ? (dimRaw as Dimension)
    : undefined;
  const dueOnly = searchParams.get('due_only') === '1';

  if (dueOnly) {
    const due = flashcardDb.getDueForUser(owner, { videoId, dimension });

    // 新卡日上限（仅"全部"维度生效，单个维度不限制）
    const applyCap = !dimension;
    const today = new Date().toISOString().slice(0, 10);
    const dailyFile = path.join(DATA_DIR, 'flashcard-daily.json');
    let daily: DailyCounter = { date: today, newCardsShown: {}, newCardIds: {} };
    if (applyCap) {
      try {
        if (fs.existsSync(dailyFile)) {
          const parsed = JSON.parse(fs.readFileSync(dailyFile, 'utf-8'));
          if (parsed.date === today) daily = parsed;
        }
      } catch { /* ignore */ }
    }
    if (!applyCap) {
      // 单个维度：不过滤，不截断，全部返回
      return NextResponse.json({
        cards: due.map(({ card, state }) => ({ ...card, state })),
        newCardsToday: 0,
        newCardsLimit: 0,
      });
    }

    if (!daily.newCardsShown) daily.newCardsShown = {};
    if (!daily.newCardIds) daily.newCardIds = {};
    const shownIds = new Set(daily.newCardIds[owner] || []);
    const newShown = daily.newCardsShown[owner] || 0;
    const remainingQuota = Math.max(0, MAX_NEW_CARDS_PER_DAY - newShown);

    // 分离新卡和复习卡；新卡排除今天已展示过的
    const newCards: typeof due = [];
    const reviewCards: typeof due = [];
    for (const item of due) {
      if (item.state === null) {
        if (!shownIds.has(item.card.id)) {
          newCards.push(item);
        }
      } else {
        reviewCards.push(item);
      }
    }

    // 新卡截断
    const limitedNew = newCards.slice(0, remainingQuota);
    for (const item of limitedNew) {
      shownIds.add(item.card.id);
    }
    daily.newCardsShown[owner] = shownIds.size;
    daily.newCardIds[owner] = Array.from(shownIds);

    try {
      if (!fs.existsSync(path.dirname(dailyFile))) fs.mkdirSync(path.dirname(dailyFile), { recursive: true });
      fs.writeFileSync(dailyFile, JSON.stringify(daily, null, 2), 'utf-8');
    } catch { /* ignore */ }

    // 合并时也加上已在今天展示但未复习的新卡（for continuity）
    const alreadyShownNew = due.filter(
      item => item.state === null && shownIds.has(item.card.id) && !limitedNew.some(n => n.card.id === item.card.id),
    );
    const result = [...limitedNew, ...alreadyShownNew, ...reviewCards];
    return NextResponse.json({
      cards: result.map(({ card, state }) => ({ ...card, state })),
      newCardsToday: shownIds.size,
      newCardsLimit: MAX_NEW_CARDS_PER_DAY,
    });
  }

  const cards = flashcardDb.listForUser(owner, { videoId, dimension });
  const out = cards.map(c => ({
    ...c,
    state: flashcardDb.getState(c.id, owner),
  }));
  return NextResponse.json({ cards: out });
}

export async function DELETE(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  const isAdmin = auth.role === 'admin';

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });

  const card = flashcardDb.getCard(id);
  if (!card) return NextResponse.json({ error: '卡片不存在' }, { status: 404 });

  // 用户可删自己的卡；只有 admin 可删 ai 共享卡
  if (card.owner !== owner && !(isAdmin && card.owner === SHARED_OWNER)) {
    return NextResponse.json({ error: '无权限删除此卡片' }, { status: 403 });
  }

  flashcardDb.deleteCard(id, card.owner);
  return NextResponse.json({ success: true });
}
