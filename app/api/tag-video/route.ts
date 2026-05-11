import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';
import { revalidatePath } from 'next/cache';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';

const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

const SYSTEM_PROMPT =
  '你是一个视频内容分析专家。根据视频的标题和描述，判断视频的【场景分类】和【难度等级】。\n\n' +
  '【场景分类（必须从中选一个）】\n' +
  '- beauty: 美妆护肤、化妆教程、产品测评\n' +
  '- tech: 科技、数码、编程、AI、硬件\n' +
  '- lifestyle: 日常生活、家居、Vlog\n' +
  '- education: 教育、学习、知识科普\n' +
  '- entertainment: 娱乐、电影、音乐、综艺\n' +
  '- business: 商业、财经、投资、创业\n' +
  '- travel: 旅行、旅游、探险\n' +
  '- food: 美食、烹饪、餐厅\n' +
  '- fitness: 健身、运动、健康\n' +
  '- vlog: 个人Vlog、日常记录\n' +
  '- other: 其他\n\n' +
  '【难度等级（必须从中选一个）】\n' +
  '- beginner: 简单词汇，慢速语速，适合初学者\n' +
  '- intermediate: 常用表达，正常语速，适合中级学习者\n' +
  '- advanced: 专业术语，快速语速，适合高级学习者\n\n' +
  '【输出格式】严格JSON，不要任何其他内容：\n' +
  '{"category":"分类key","difficulty":"难度key","reason":"简短理由（20字以内）"}';

const VALID_CATEGORIES = ['beauty', 'tech', 'lifestyle', 'education', 'entertainment', 'business', 'travel', 'food', 'fitness', 'vlog', 'other'];
const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

function verifyAdmin(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) return false;
  return session.role === 'admin';
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  try {
    const { videoId } = await req.json();
    if (!videoId || typeof videoId !== 'string') {
      return NextResponse.json({ error: '缺少 videoId 参数' }, { status: 400 });
    }

    if (!VALID_VIDEO_ID.test(videoId)) {
      return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
    }

    const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      return NextResponse.json({ error: '视频不存在' }, { status: 404 });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const title = meta.title || videoId;
    const description = meta.description || '';

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '未配置 MINIMAX_API_KEY' }, { status: 500 });
    }

    const userPrompt = `标题: ${title}\n描述: ${description}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    let aiContent: string;
    try {
      const response = await fetch(MINIMAX_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.5',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`MiniMax API 错误: ${response.status}`);
      }

      const data = await response.json();
      aiContent = data.choices?.[0]?.message?.content || '';
    } finally {
      clearTimeout(timer);
    }

    let parsed: { category?: string; difficulty?: string; reason?: string };
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('无法解析AI返回');
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return NextResponse.json({ error: 'AI返回格式异常', raw: aiContent }, { status: 500 });
    }

    const category = VALID_CATEGORIES.includes(parsed.category || '') ? parsed.category : 'other';
    const difficulty = VALID_DIFFICULTIES.includes(parsed.difficulty || '') ? parsed.difficulty : 'intermediate';

    meta.category = category;
    meta.difficulty = difficulty;

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    revalidatePath('/');
    revalidatePath(`/${videoId}`);

    return NextResponse.json({
      videoId,
      category,
      difficulty,
      reason: parsed.reason || '',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
