import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';
import fs from 'fs';
import path from 'path';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const API_TIMEOUT_MS = 90_000;
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
    const { videoId, title, subtitles } = await req.json() as {
      videoId?: string;
      title?: string;
      subtitles?: { id: number; text: string; startTime?: number; endTime?: number }[];
    };

    if (!videoId || !VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }
    if (!subtitles || !Array.isArray(subtitles) || subtitles.length < 5) {
      return NextResponse.json({ error: '字幕数据不足，无法生成题目' }, { status: 400 });
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'AI 服务未配置' }, { status: 500 });
    }

    const existingBankPath = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
    if (fs.existsSync(existingBankPath)) {
      try {
        const bank = JSON.parse(fs.readFileSync(existingBankPath, 'utf-8'));
        if (bank.questions && Array.isArray(bank.questions) && bank.questions.length >= 10) {
          return NextResponse.json({
            message: '题库已存在',
            fromCache: true,
            totalQuestions: bank.questions.length,
          });
        }
      } catch {}
    }

    const sampledSubs = subtitles
      .filter(s => s.text && s.text.trim().length > 3 && typeof s.startTime === 'number' && typeof s.endTime === 'number')
      .sort(() => Math.random() - 0.5)
      .slice(0, 50);

    const subtitleText = sampledSubs.map((s, i) =>
      `[${i + 1}] [${(s.startTime ?? 0).toFixed(1)}s-${(s.endTime ?? 0).toFixed(1)}s] ${s.text}`
    ).join('\n');

    const systemPrompt = `# 视频英语测试题库生成系统

## 身份
你是一位专业的英语教学出题专家，擅长根据真实视频内容设计有针对性的英语能力测试题库。

## 任务
根据提供的视频字幕内容，生成一个包含 **20-25道题目** 的静态题库。

## 题库结构要求

### 题目类型分布（约比例）
- **选择题（choice）**: 约16-20道 — 词汇辨析、短语含义、语法填空、情景理解、同义替换、听力理解
- **口语表达题（speaking）**: 约3-5道 — 开放式英语复述/回答问题

### 每道题必须包含的字段
1. **type**: "choice" 或 "speaking"
2. **question**: 题目文本（英文）
3. **options**: 选择题的4个选项 A/B/C/D（口语题为空数组）
4. **answer**: 正确答案字母（如"C"），口语题为"open"
5. **explanation**: 中文解析（为什么选这个答案）
6. **referenceAnswer**: 口语题参考答案要点，选择题留空字符串
7. **hint**: 口语题提示，选择题留空字符串
8. **startTime**: 对应视频片段起始时间（秒）
9. **endTime**: 对应视频片段结束时间（秒）
10. **difficulty**: 难度标签 — 必须是以下之一：
    - **"easy"**: 基础词汇、简单句型、直接理解
    - **"medium"**: 中级词汇、常用短语、需要一定语境推断
    - **"hard"**: 高级词汇、复杂句式、深层语义理解、习语/隐喻
11. **relatedWords**: 与这道题相关的关键英文单词数组（2-5个），用于标签展示

### 出题规则
1. 每道题必须基于字幕中的实际内容
2. 题目覆盖视频中不同时间段的内容，不要集中在同一区域
3. 难度要有层次：easy 约30%、medium 约50%、hard 约20%
4. relatedWords 应该是这道题考查的核心单词/短语
5. 4个选项必须完整有意义，干扰项要有迷惑性
6. explanation 用中文详细解释

### 时间戳规则
- startTime 和 endTime 基于输入字幕中的 [Xs-Ys]
- 片段长度建议在 5-30 秒之间
- 取题目最核心对应的那个片段时间范围

## 输出格式（严格JSON，不要markdown标记）
{
  "questions": [
    {
      "type": "choice",
      "question": "What does 'XXX' mean in this context?",
      "options": ["A) meaning1", "B) meaning2", "C) meaning3", "D) meaning4"],
      "answer": "C",
      "explanation": "中文解释...",
      "referenceAnswer": "",
      "hint": "",
      "startTime": 12.5,
      "endTime": 18.3,
      "difficulty": "medium",
      "relatedWords": ["vocabulary", "context", "meaning"]
    },
    {
      "type": "speaking",
      "question": "Describe what happened when...",
      "options": [],
      "answer": "open",
      "explanation": "",
      "referenceAnswer": "key answer points here",
      "hint": "Try to use phrases like...",
      "startTime": 45.0,
      "endTime": 55.0,
      "difficulty": "hard",
      "relatedWords": ["describe", "narrative", "sequence"]
    }
  ]
}`;

    const userPrompt = `视频标题：${title || 'Unknown Video'}

以下是视频的部分字幕内容（已随机采样）：

${subtitleText}

请根据以上内容生成20-25道测试题，构成一个完整的题库。`;

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

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const braceStart = jsonStr.indexOf('{');
      const braceEnd = jsonStr.lastIndexOf('}');
      if (braceStart >= 0 && braceEnd > braceStart) {
        parsed = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
      } else {
        throw new Error('AI 返回的格式无法解析');
      }
    }

    if (!parsed.questions || !Array.isArray(parsed.questions)) {
      throw new Error('AI 返回缺少 questions 字段');
    }

    const validDifficulties = ['easy', 'medium', 'hard'];
    const questions = parsed.questions.map((q: Record<string, unknown>, idx: number) => {
      const diff = String(q.difficulty || '').toLowerCase();
      const rawWords = q.relatedWords;
      let relatedWords: string[] = [];
      if (Array.isArray(rawWords)) {
        relatedWords = rawWords.map(String).filter(w => w.length > 0 && w.length < 30);
      } else if (typeof rawWords === 'string' && rawWords.length > 0) {
        relatedWords = rawWords.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      return {
        id: idx + 1,
        type: q.type === 'speaking' ? 'speaking' : 'choice',
        question: String(q.question || ''),
        options: Array.isArray(q.options) ? q.options.map(String) : [],
        answer: String(q.answer || ''),
        explanation: String(q.explanation || ''),
        referenceAnswer: String(q.referenceAnswer || ''),
        hint: String(q.hint || ''),
        startTime: typeof q.startTime === 'number' ? q.startTime : 0,
        endTime: typeof q.endTime === 'number' ? q.endTime : 0,
        difficulty: validDifficulties.includes(diff) ? diff : 'medium',
        relatedWords: relatedWords.length > 0 ? relatedWords : ['general'],
      };
    });

    if (questions.length < 12) {
      throw new Error(`只生成了${questions.length}道题，题库至少需要12道`);
    }

    const videoDir = path.join(CONTENT_DIR, videoId);
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    const bankData = {
      videoId,
      title: title || '',
      generatedAt: new Date().toISOString(),
      version: 1,
      totalQuestions: questions.length,
      stats: {
        easy: questions.filter((q: { difficulty: string }) => q.difficulty === 'easy').length,
        medium: questions.filter((q: { difficulty: string }) => q.difficulty === 'medium').length,
        hard: questions.filter((q: { difficulty: string }) => q.difficulty === 'hard').length,
        choice: questions.filter((q: { type: string }) => q.type === 'choice').length,
        speaking: questions.filter((q: { type: string }) => q.type === 'speaking').length,
      },
      questions,
    };

    fs.writeFileSync(existingBankPath, JSON.stringify(bankData, null, 2), 'utf-8');

    return NextResponse.json({
      message: '题库生成成功',
      fromCache: false,
      videoId,
      totalQuestions: questions.length,
      stats: bankData.stats,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '生成失败';
    console.error('[quiz/generate]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
