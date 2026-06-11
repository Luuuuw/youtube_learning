import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const API_TIMEOUT_MS = 30_000;

function verifyAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) return false;
  return true;
}

async function callMiniMax(messages: { role: string; content: string }[], apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: 'MiniMax-M2.5', messages }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const { originalText, transcript, speakDuration, expectedDuration } = await req.json() as {
      originalText?: string;
      transcript?: string;
      speakDuration?: number;
      expectedDuration?: number;
    };

    if (!originalText || !transcript) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });
    }

    const prompt = `Evaluate shadow speaking. Original: "${originalText}" User said: "${transcript}" Duration: ${speakDuration?.toFixed(1) || '?'}s / ${expectedDuration?.toFixed(1) || '?'}s. Score 0-100: accuracy(word correctness), fluency(rhythm/pacing), completeness(coverage). JSON only: {"accuracy":N,"fluency":N,"completeness":N,"tip":"one brief Chinese tip"}`;

    const content = await callMiniMax(
      [{ role: 'user', content: prompt }],
      apiKey,
    );

    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    let score;
    try {
      score = JSON.parse(jsonStr);
    } catch {
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        score = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
      } else {
        throw new Error('AI 返回格式无法解析');
      }
    }

    return NextResponse.json({ score });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '评分失败';
    console.error('[shadow-speak/score]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
