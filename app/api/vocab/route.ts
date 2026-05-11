import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { getAllWords, addWord, updateWord, deleteWord,
  getDueWords, reviewWord, getTodayStats, getWeeklyStats,
  getWordById, getReviewHistory, getWordByName, getLearningCurve,
} from '@/lib/vocab-db';

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get('type');

    if (type === 'due') {
      const words = getDueWords(owner);
      return NextResponse.json({ words });
    }

    if (type === 'stats') {
      const stats = getTodayStats(owner);
      return NextResponse.json(stats);
    }

    if (type === 'weekly') {
      const weekly = getWeeklyStats();
      return NextResponse.json({ weekly });
    }

    if (type === 'curve') {
      const days = parseInt(searchParams.get('days') || '30', 10);
      const curve = getLearningCurve(Math.min(Math.max(days, 7), 90));
      return NextResponse.json({ curve });
    }

    const id = searchParams.get('id');
    if (id) {
      const word = getWordById(id, owner);
      if (!word) {
        return NextResponse.json({ error: '单词不存在' }, { status: 404 });
      }
      const history = getReviewHistory(id);
      return NextResponse.json({ word, history });
    }

    const check = searchParams.get('check');
    if (check) {
      const word = getWordByName(check, owner);
      return NextResponse.json({ exists: !!word, word: word || null });
    }

    const words = getAllWords(owner);
    return NextResponse.json({ words });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'review') {
      const { id, result } = body;
      if (!id || !result || !['remember', 'forget'].includes(result)) {
        return NextResponse.json({ error: '参数错误' }, { status: 400 });
      }
      const word = reviewWord(id, result, owner);
      if (!word) {
        return NextResponse.json({ error: '单词不存在' }, { status: 404 });
      }
      return NextResponse.json({ word });
    }

    const { word, definition, context, videoId, videoTitle, timestamp, phonetic, example } = body;
    if (!word || !definition) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const newWord = addWord({
      word: word.trim(),
      definition: definition.trim(),
      context: context || '',
      videoId: videoId || '',
      videoTitle: videoTitle || '',
      timestamp: timestamp || 0,
      phonetic: phonetic || '',
      example: example || '',
      owner,
    });

    return NextResponse.json({ word: newWord });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  try {
    const body = await req.json();
    const { id, definition } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    if (!definition || typeof definition !== 'string') {
      return NextResponse.json({ error: '缺少 definition 参数' }, { status: 400 });
    }

    const word = updateWord(id, { definition: definition.trim() }, owner);
    if (!word) {
      return NextResponse.json({ error: '单词不存在' }, { status: 404 });
    }

    return NextResponse.json({ word });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    }

    const success = deleteWord(id, owner);
    if (!success) {
      return NextResponse.json({ error: '单词不存在' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
