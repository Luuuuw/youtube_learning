import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';
import fs from 'fs';
import path from 'path';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const API_TIMEOUT_MS = 60_000;
const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

function verifyAuth(req: NextRequest): { valid: boolean; code?: string } {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { valid: false };
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return { valid: false };
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) return { valid: false };
  return { valid: true, code: session.code };
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
  const auth = verifyAuth(req);
  if (!auth.valid) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const { videoId, subtitle } = await req.json() as {
      videoId?: string;
      subtitle?: { text: string; startTime: number; endTime: number };
    };

    if (!videoId || !VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }
    if (!subtitle || !subtitle.text) {
      return NextResponse.json({ error: '缺少字幕数据' }, { status: 400 });
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });
    }

    const cachePath = path.join(CONTENT_DIR, videoId, 'shadow-tips.json');
    let cachedTips: Record<string, unknown> = {};
    if (fs.existsSync(cachePath)) {
      try {
        cachedTips = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      } catch {}
    }

    const cacheKey = `${subtitle.startTime.toFixed(2)}-${subtitle.endTime.toFixed(2)}`;
    if (cachedTips[cacheKey]) {
      return NextResponse.json({ analysis: cachedTips[cacheKey], fromCache: true });
    }

    const duration = subtitle.endTime - subtitle.startTime;
    const wordCount = subtitle.text.split(/\s+/).filter(Boolean).length;
    const wpm = duration > 0 ? Math.round((wordCount / duration) * 60) : 0;

    const systemPrompt = `# 英语跟读分析系统

## 身份
你是一位专业的英语语音教练，擅长分析英语句子的发音难点和跟读技巧。

## 任务
分析给定的英语句子，提供跟读指导。需要从以下维度分析：

### 输出格式（严格JSON，不要markdown标记）
{
  "level": "beginner" | "intermediate" | "advanced",
  "levelLabel": "入门" | "中级" | "进阶",
  "speed": {
    "wpm": 数字,
    "label": "慢速" | "正常" | "较快" | "快速",
    "tip": "速度相关建议"
  },
  "connectedSpeech": [
    {
      "words": "连读的词组",
      "type": "连读" | "同化" | "省音",
      "description": "中文说明如何连读"
    }
  ],
  "stress": [
    {
      "word": "需要重读的词",
      "reason": "为什么重读"
    }
  ],
  "swallowed": [
    {
      "word": "吞音的词/音",
      "description": "中文说明吞音规则"
    }
  ],
  "tips": [
    "跟读技巧1",
    "跟读技巧2",
    "跟读技巧3"
  ]
}

### 分析规则
1. **level**: 根据句子复杂度、语速、发音难度综合判断
   - beginner: 简单句、慢速、常见词汇
   - intermediate: 中等复杂度、正常语速、有连读
   - advanced: 复杂句、快速、多处连读/吞音/弱读
2. **speed**: 根据提供的 WPM 判断
   - < 120: 慢速
   - 120-160: 正常
   - 160-200: 较快
   - > 200: 快速
3. **connectedSpeech**: 找出句子中可能出现的连读、同化、省音现象
4. **stress**: 标出句子中需要重读的关键词（实词、信息词）
5. **swallowed**: 标出可能吞音/弱读的地方
6. **tips**: 给出3-5条实用的跟读建议，包括节奏、语调、呼吸等`;

    const userPrompt = `请分析以下英语句子的跟读要点：

句子："${subtitle.text}"
时长：${duration.toFixed(1)} 秒
语速：约 ${wpm} WPM（每分钟词数）

请提供完整的跟读分析。`;

    const content = await callMiniMax(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      apiKey
    );

    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    let analysis;
    try {
      analysis = JSON.parse(jsonStr);
    } catch {
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        analysis = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
      } else {
        throw new Error('AI 返回格式无法解析');
      }
    }

    cachedTips[cacheKey] = analysis;
    const videoDir = path.join(CONTENT_DIR, videoId);
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(cachedTips, null, 2), 'utf-8');

    return NextResponse.json({ analysis, fromCache: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '分析失败';
    console.error('[shadow-speak/analyze]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
