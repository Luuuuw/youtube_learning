// POST /api/flashcards/approve
//   admin-only. body: { videoId, cardIds[], action: 'approve' | 'reject' }
//   approve → flashcardDb.addCard()，owner=__shared__、reviewedByAdmin=true
//   reject  → 直接丢
//   两种 action 都从草稿 cards 数组里移除处理过的 id，剩 0 张则删整个 flashcards.json
import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-middleware';
import { flashcardDb, SHARED_OWNER, type Flashcard } from '@/lib/flashcard-db';
import { DATA_DIR } from '@/lib/data-dir';
import { safeAiWrite, buildProposal } from '@/lib/safe-ai-write';
import { mustHaveCardContent } from '@/lib/ai-invariants';

interface DraftFile {
  videoId: string;
  generatedAt?: string;
  cards: Flashcard[];
}

interface Body {
  videoId?: string;
  cardIds?: string[];
  action?: 'approve' | 'reject';
}

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) {
    if (!auth.role) return unauthorizedResponse();
    return forbiddenResponse();
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const { videoId, cardIds, action } = body;
  if (!videoId || typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return NextResponse.json({ error: 'videoId 非法' }, { status: 400 });
  }
  if (!Array.isArray(cardIds) || cardIds.length === 0) {
    return NextResponse.json({ error: 'cardIds 为空' }, { status: 400 });
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action 必须是 approve / reject' }, { status: 400 });
  }

  const draftPath = path.join(process.cwd(), 'public', 'content', videoId, 'flashcards.json');
  if (!fs.existsSync(draftPath)) {
    return NextResponse.json({ error: '草稿不存在' }, { status: 404 });
  }

  let draft: DraftFile;
  try {
    draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8')) as DraftFile;
  } catch {
    return NextResponse.json({ error: '草稿读取失败' }, { status: 500 });
  }
  const allCards = Array.isArray(draft.cards) ? draft.cards : [];

  const idSet = new Set(cardIds);
  const targets = allCards.filter(c => idSet.has(c.id));
  const remaining = allCards.filter(c => !idSet.has(c.id));

  let approved = 0;
  let rejected = 0;

  if (action === 'approve') {
    // 整批 import 算作一次 safe-mutation 提案：medium risk + 自动备份 + audit log
    // 整批 import 算作一次 safe-mutation 提案：medium risk + 自动备份 + audit log
    // requestedCount = admin 选中要导入的张数；appliedCount 由 applyFn 返回，
    // 单卡 addCard 失败会跳过，所以两者可能不一致。
    const proposal = buildProposal({
      operation: 'flashcard-import',
      targetFile: path.join(DATA_DIR, 'flashcards.json'),
      before: { videoId, addedCount: 0 },
      after: { videoId, requestedCount: targets.length, ids: targets.map(c => c.id) },
      metadata: {
        videoId,
        model: 'admin-approved',
        cards: targets.map(c => ({ id: c.id, front: c.front, back: c.back })),
      },
      actor: `admin:${auth.code || 'unknown'}`,
    });
    const result = await safeAiWrite(
      proposal,
      { riskLevel: 'medium', invariants: [mustHaveCardContent] },
      () => {
        let count = 0;
        for (const c of targets) {
          try {
            flashcardDb.addCard({
              videoId: c.videoId,
              dimension: c.dimension,
              type: c.type,
              front: c.front,
              back: c.back,
              context: c.context,
              audioStart: c.audioStart,
              audioEnd: c.audioEnd,
              hint: c.hint,
              tags: Array.isArray(c.tags) ? c.tags : [],
              word: c.word,
              owner: SHARED_OWNER,
              source: c.source || 'ai',
              reviewedByAdmin: true,
            });
            count++;
          } catch (err) {
            console.warn('[flashcards/approve] addCard failed for', c.id, (err as Error).message);
          }
        }
        return count;
      },
    );
    approved = typeof result.result === 'number' ? result.result : 0;
  } else {
    rejected = targets.length;
  }

  // 重写或删草稿
  try {
    if (remaining.length === 0) {
      fs.unlinkSync(draftPath);
    } else {
      atomicWriteJsonSync(draftPath, {
        videoId: draft.videoId || videoId,
        generatedAt: draft.generatedAt,
        cards: remaining,
      });
    }
  } catch (err) {
    console.error('[flashcards/approve] 草稿落盘失败:', (err as Error).message);
    return NextResponse.json({ error: '草稿落盘失败' }, { status: 500 });
  }

  return NextResponse.json({
    approved,
    rejected,
    remaining: remaining.length,
  });
}
