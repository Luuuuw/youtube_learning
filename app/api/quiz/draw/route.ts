import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';
import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

function verifyAuth(req: NextRequest): { valid: boolean } {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { valid: false };
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return { valid: false };
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) return { valid: false };
  return { valid: true };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const { videoId, count, stars } = await req.json() as {
      videoId?: string;
      count?: number;
      stars?: number;
    };

    if (!videoId || !VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }

    const bankPath = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
    if (!fs.existsSync(bankPath)) {
      return NextResponse.json({ error: '该视频尚未生成题库，请先生成题库' }, { status: 404 });
    }

    const bank = JSON.parse(fs.readFileSync(bankPath, 'utf-8'));
    if (!bank.questions || !Array.isArray(bank.questions) || bank.questions.length === 0) {
      return NextResponse.json({ error: '题库数据为空' }, { status: 500 });
    }

    const starLevel = Math.min(Math.max(stars || 1, 1), 4);
    const drawCount = 6;

    const allQuestions: Record<string, unknown>[] = shuffle(bank.questions);

    const choicePool = allQuestions.filter((q) => q.type === 'choice');
    const speakingPool = allQuestions.filter((q) => q.type === 'speaking');

    const easyChoice = shuffle(choicePool.filter((q) => q.difficulty === 'easy'));
    const mediumChoice = shuffle(choicePool.filter((q) => q.difficulty === 'medium'));
    const hardChoice = shuffle(choicePool.filter((q) => q.difficulty === 'hard'));
    const shuffledSpeaking = shuffle(speakingPool);

    let drawn: typeof allQuestions = [];

    if (starLevel === 1) {
      const easyCount = Math.min(4, easyChoice.length);
      const mediumCount = Math.min(2, mediumChoice.length);
      const remaining = drawCount - easyCount - mediumCount;
      const hardCount = remaining > 0 ? Math.min(remaining, hardChoice.length) : 0;
      drawn = [
        ...easyChoice.slice(0, easyCount),
        ...mediumChoice.slice(0, mediumCount),
        ...hardChoice.slice(0, hardCount),
      ];
    } else if (starLevel === 2) {
      const easyCount = Math.min(2, easyChoice.length);
      const mediumCount = Math.min(3, mediumChoice.length);
      const remaining = drawCount - easyCount - mediumCount;
      const hardCount = remaining > 0 ? Math.min(remaining, hardChoice.length) : 0;
      drawn = [
        ...easyChoice.slice(0, easyCount),
        ...mediumChoice.slice(0, mediumCount),
        ...hardChoice.slice(0, hardCount),
      ];
    } else if (starLevel === 3) {
      const mediumCount = Math.min(4, mediumChoice.length);
      const hardCount = Math.min(2, hardChoice.length);
      const remaining = drawCount - mediumCount - hardCount;
      const easyCount = remaining > 0 ? Math.min(remaining, easyChoice.length) : 0;
      drawn = [
        ...mediumChoice.slice(0, mediumCount),
        ...hardChoice.slice(0, hardCount),
        ...easyChoice.slice(0, easyCount),
      ];
    } else {
      const speakingCount = Math.min(1, shuffledSpeaking.length);
      const hardCount = Math.min(3, hardChoice.length);
      const mediumCount = Math.min(2, mediumChoice.length);
      const remaining = drawCount - speakingCount - hardCount - mediumCount;
      const easyCount = remaining > 0 ? Math.min(remaining, easyChoice.length) : 0;
      drawn = [
        ...hardChoice.slice(0, hardCount),
        ...mediumChoice.slice(0, mediumCount),
        ...easyChoice.slice(0, easyCount),
        ...shuffledSpeaking.slice(0, speakingCount),
      ];
    }

    if (drawn.length < drawCount) {
      const drawnIds = new Set(drawn.map(q => q.id));
      const fillPool = shuffle(choicePool.filter(q => !drawnIds.has(q.id as number)));
      const fillCount = drawCount - drawn.length;
      drawn = [...drawn, ...fillPool.slice(0, fillCount)];
    }

    drawn = shuffle(drawn).map((q: Record<string, unknown>, idx: number) => ({
      ...q,
      id: idx + 1,
    }));

    return NextResponse.json({
      videoId,
      fromBank: true,
      bankTotal: bank.questions.length,
      bankStats: bank.stats,
      drawnCount: drawn.length,
      questions: drawn,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '抽题失败';
    console.error('[quiz/draw]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
