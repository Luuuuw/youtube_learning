// POST /api/flashcards/add
//   手动 / AI 辅助添加单张闪卡，支持三种 action：
//    vocab: { action, videoId, word, definition, pos?, startTime?, endTime? }
//    listening: { action, videoId, sentence, startTime?, endTime? }
//    sentence: { action, videoId, sentence, pattern, startTime?, endTime? }
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { flashcardDb, SHARED_OWNER, Dimension, CardType } from '@/lib/flashcard-db';
import { AI_MODELS } from '@/lib/ai-models';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- DeepSeek helpers ----------

async function callDS(sys: string, user: string): Promise<unknown> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 缺失');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(AI_MODELS.deepseek_chat.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODELS.deepseek_chat.id,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Listening generation ----------

const LISTENING_SYS = `你是英语听力填空闪卡生成助手。给定一个英文句子，挑 1 个关键内容词（名词/动词/形容词/副词）挖空。
- correct 是从原句精确摘取的单词（保持原形态、大小写）
- 给 3 个干扰项（distractors），同词性、有迷惑性、但放回原句不通顺
- front_with_blank 是把 correct 替换为 ___（三个下划线）后的整句

只输出严格的 JSON：
{"front_with_blank":"I'd rather grab a quick bite than go to a ___ restaurant","correct":"fancy","distractors":["expensive","big","new"]}`;

function makeListeningPrompt(sentence: string): { sys: string; user: string } {
  return {
    sys: LISTENING_SYS,
    user: `句子：${sentence}\n请生成一张听力填空卡。`,
  };
}

// ---------- Sentence generation ----------

// 句型卡不再用 AI — 直接逐词替换，100% 精确
function makeSentenceCloze(sentence: string, pattern: string): { front_cloze: string; fills: string[] } {
  const words = pattern.split(/\s+/).filter(Boolean);
  let front = sentence;
  const fills: string[] = [];
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(front)) {
      front = front.replace(re, '___');
      fills.push(w);
    }
  }
  return { front_cloze: front, fills };
}

// ---------- POST handler ----------

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const owner = auth.code!;

  let body: {
    action: 'vocab' | 'listening' | 'sentence';
    videoId?: string;
    word?: string;
    definition?: string;
    pos?: string;
    sentence?: string;
    pattern?: string;
    zhSentence?: string;
    startTime?: number;
    endTime?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 });
  }

  const { action, videoId, startTime, endTime } = body;
  if (!videoId) return NextResponse.json({ error: '缺少 videoId' }, { status: 400 });

  try {
    if (action === 'vocab') {
      const { word, definition, pos } = body;
      if (!word || !definition) return NextResponse.json({ error: '缺少 word 或 definition' }, { status: 400 });

      const card = flashcardDb.addCard({
        videoId,
        dimension: 'vocab' as Dimension,
        type: 'recognition' as CardType,
        front: word,
        back: `${definition} (${pos || '?'})`,
        context: '',
        audioStart: startTime,
        audioEnd: endTime,
        word: word.toLowerCase(),
        tags: [pos || 'manual'].filter(Boolean),
        owner,
        source: 'manual',
        reviewedByAdmin: true,
      });
      return NextResponse.json({ success: true, card });
    }

    if (action === 'listening') {
      const { sentence } = body;
      if (!sentence) return NextResponse.json({ error: '缺少 sentence' }, { status: 400 });

      const { sys, user } = makeListeningPrompt(sentence);
      const raw = await callDS(sys, user);
      const ai = raw as { front_with_blank?: string; correct?: string; distractors?: string[] };

      if (!ai.front_with_blank || !ai.correct) {
        return NextResponse.json({ error: 'AI 生成失败' }, { status: 500 });
      }

      const choices = [ai.correct, ...(ai.distractors || [])].filter(Boolean);
      const card = flashcardDb.addCard({
        videoId,
        dimension: 'listening' as Dimension,
        type: 'audio_fill' as CardType,
        front: `(听音频) ${ai.front_with_blank}`,
        back: ai.correct,
        context: sentence,
        audioStart: startTime,
        audioEnd: endTime,
        hint: `选项：${choices.sort(() => Math.random() - 0.5).join(' / ')}`,
        tags: ['fill-in-blank'],
        owner,
        source: 'ai',
        reviewedByAdmin: true,
      });
      return NextResponse.json({ success: true, card });
    }

    if (action === 'sentence') {
      const { sentence, pattern, zhSentence } = body;
      if (!sentence || !pattern) return NextResponse.json({ error: '缺少 sentence 或 pattern' }, { status: 400 });

      const { front_cloze, fills } = makeSentenceCloze(sentence, pattern);
      if (fills.length === 0) {
        return NextResponse.json({ error: '句型词组未在句子中找到，请检查拼写' }, { status: 400 });
      }

      const zhPrefix = zhSentence && typeof zhSentence === 'string' ? `${zhSentence}\n` : '';
      const card = flashcardDb.addCard({
        videoId,
        dimension: 'sentence' as Dimension,
        type: 'cloze' as CardType,
        front: `${zhPrefix}${front_cloze}`,
        back: fills.join(' / '),
        context: sentence,
        audioStart: startTime,
        audioEnd: endTime,
        hint: pattern,
        tags: ['pattern'],
        owner,
        source: 'manual' as const,
        reviewedByAdmin: true,
      });
      return NextResponse.json({ success: true, card });
    }

    return NextResponse.json({ error: '未知 action' }, { status: 400 });
  } catch (e) {
    console.error('[flashcards/add]', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
