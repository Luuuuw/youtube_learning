import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import authSessions from '@/lib/auth-sessions';
import { translateVideoFromRawVtt } from '@/lib/translate';
import { parseVtt } from '@/lib/vtt-parser';
import { revalidatePath } from 'next/cache';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const PROCESS_PROGRESS_FILE = path.join(process.cwd(), 'process-progress.json');
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

const VALID_CATEGORIES = ['beauty', 'tech', 'lifestyle', 'education', 'entertainment', 'business', 'travel', 'food', 'fitness', 'vlog', 'other'];
const VALID_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

const TAG_SYSTEM_PROMPT =
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

const QUIZ_SYSTEM_PROMPT = `# 视频英语测试题库生成系统

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
    }
  ]
}`;

function verifyAdmin(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) return false;
  return session.role === 'admin';
}

interface StepResult {
  step: string;
  status: 'skipped' | 'done' | 'error';
  message?: string;
}

interface ProcessProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  current: number;
  currentVideoId: string;
  currentStep: string;
  results: Record<string, StepResult[]>;
  logs: string[];
  updatedAt: string;
}

function getProgress(): ProcessProgress {
  if (!fs.existsSync(PROCESS_PROGRESS_FILE)) {
    return {
      status: 'idle',
      total: 0,
      current: 0,
      currentVideoId: '',
      currentStep: '',
      results: {},
      logs: [],
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    const data = JSON.parse(fs.readFileSync(PROCESS_PROGRESS_FILE, 'utf-8'));
    // 自动清理陈旧的 running 状态（>5 分钟无更新）
    if (data.status === 'running' && data.updatedAt) {
      const age = Date.now() - new Date(data.updatedAt).getTime();
      if (age > 5 * 60 * 1000) {
        return {
          ...data,
          status: 'error',
          logs: [...(data.logs || []), '[自动清理] 任务超时 5 分钟，状态已重置'],
          results: data.results || {},
        };
      }
    }
    return {
      ...data,
      results: data.results || {},
      logs: data.logs || [],
    };
  } catch {
    return {
      status: 'idle',
      total: 0,
      current: 0,
      currentVideoId: '',
      currentStep: '',
      results: {},
      logs: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

function setProgress(progress: ProcessProgress) {
  try {
    fs.writeFileSync(PROCESS_PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8');
  } catch {}
}

async function callMiniMax(messages: { role: string; content: string }[], apiKey: string, timeout = 90000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
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

function getVideoIdsNeedingProcessing(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  const dirs = fs.readdirSync(CONTENT_DIR);
  const videoIds: string[] = [];

  for (const dir of dirs) {
    const videoPath = path.join(CONTENT_DIR, dir, 'video.mp4');
    if (!fs.existsSync(videoPath)) continue;

    const metaPath = path.join(CONTENT_DIR, dir, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;

    videoIds.push(dir);
  }

  return videoIds;
}

function needsTagging(videoId: string): boolean {
  const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    return !meta.category || !meta.difficulty;
  } catch {
    return true;
  }
}

function needsTranslation(videoId: string): boolean {
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  return !fs.existsSync(zhVttPath);
}

function needsQuiz(videoId: string): boolean {
  const quizBankPath = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
  if (!fs.existsSync(quizBankPath)) return true;
  try {
    const bank = JSON.parse(fs.readFileSync(quizBankPath, 'utf-8'));
    return !bank.questions || !Array.isArray(bank.questions) || bank.questions.length < 10;
  } catch {
    return true;
  }
}

async function processTagVideo(videoId: string, apiKey: string): Promise<StepResult> {
  if (!needsTagging(videoId)) {
    return { step: '标签分类', status: 'skipped', message: '已有标签' };
  }

  const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const title = meta.title || videoId;
  const description = meta.description || '';

  const content = await callMiniMax(
    [
      { role: 'system', content: TAG_SYSTEM_PROMPT },
      { role: 'user', content: `标题: ${title}\n描述: ${description}` },
    ],
    apiKey,
    30000
  );

  let parsed: { category?: string; difficulty?: string; reason?: string };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('无法解析AI返回');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { step: '标签分类', status: 'error', message: 'AI返回格式异常' };
  }

  const category = VALID_CATEGORIES.includes(parsed.category || '') ? parsed.category : 'other';
  const difficulty = VALID_DIFFICULTIES.includes(parsed.difficulty || '') ? parsed.difficulty : 'intermediate';

  meta.category = category;
  meta.difficulty = difficulty;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  return { step: '标签分类', status: 'done', message: `${category} / ${difficulty}` };
}

async function processTranslate(videoId: string): Promise<StepResult> {
  if (!needsTranslation(videoId)) {
    return { step: '字幕翻译', status: 'skipped', message: '已有翻译' };
  }

  const enVttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(enVttPath)) {
    return { step: '字幕翻译', status: 'skipped', message: '无英文字幕' };
  }

  const result = await translateVideoFromRawVtt(videoId);
  if (result.length === 0) {
    return { step: '字幕翻译', status: 'error', message: '翻译失败' };
  }

  return { step: '字幕翻译', status: 'done', message: `翻译${result.length}条` };
}

async function processTranslateForce(videoId: string): Promise<StepResult> {
  const enVttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(enVttPath)) {
    return { step: '字幕翻译', status: 'skipped', message: '无英文字幕' };
  }

  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  const zhJsonPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');
  if (fs.existsSync(zhVttPath)) fs.unlinkSync(zhVttPath);
  if (fs.existsSync(zhJsonPath)) fs.unlinkSync(zhJsonPath);

  const result = await translateVideoFromRawVtt(videoId);
  if (result.length === 0) {
    return { step: '字幕翻译', status: 'error', message: '翻译失败' };
  }

  return { step: '字幕翻译', status: 'done', message: `重新翻译${result.length}条` };
}

async function processQuiz(videoId: string, apiKey: string): Promise<StepResult> {
  if (!needsQuiz(videoId)) {
    return { step: '题库生成', status: 'skipped', message: '已有题库' };
  }

  const enVttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(enVttPath)) {
    return { step: '题库生成', status: 'skipped', message: '无英文字幕' };
  }

  const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
  let title = videoId;
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    title = meta.title || videoId;
  } catch {}

  const subtitles = parseVtt(fs.readFileSync(enVttPath, 'utf-8'));
  if (subtitles.length < 5) {
    return { step: '题库生成', status: 'skipped', message: '字幕不足' };
  }

  const sampledSubs = subtitles
    .filter(s => s.text && s.text.trim().length > 3)
    .sort(() => Math.random() - 0.5)
    .slice(0, 50);

  const subtitleText = sampledSubs.map((s, i) =>
    `[${i + 1}] [${s.startTime.toFixed(1)}s-${s.endTime.toFixed(1)}s] ${s.text}`
  ).join('\n');

  const content = await callMiniMax(
    [
      { role: 'system', content: QUIZ_SYSTEM_PROMPT },
      { role: 'user', content: `视频标题：${title}\n\n以下是视频的部分字幕内容（已随机采样）：\n\n${subtitleText}\n\n请根据以上内容生成20-25道测试题，构成一个完整的题库。` },
    ],
    apiKey,
    90000
  );

  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      parsed = JSON.parse(jsonStr.slice(braceStart, braceEnd + 1));
    } else {
      return { step: '题库生成', status: 'error', message: 'AI返回格式异常' };
    }
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    return { step: '题库生成', status: 'error', message: 'AI返回缺少questions' };
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
    return { step: '题库生成', status: 'error', message: `只生成${questions.length}道题` };
  }

  const bankData = {
    videoId,
    title,
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

  const bankPath = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
  fs.writeFileSync(bankPath, JSON.stringify(bankData, null, 2), 'utf-8');

  return { step: '题库生成', status: 'done', message: `${questions.length}道题` };
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const forceRetag = body.force === true;
    const selectedIds: string[] | null = Array.isArray(body.videoIds) && body.videoIds.length > 0 ? body.videoIds : null;
    // step: 'all' | 'tag' | 'translate' | 'quiz' | 'vocab'
    const step: string = body.step || 'all';
    const videoIds = getVideoIdsNeedingProcessing();

    if (videoIds.length === 0) {
      return NextResponse.json({ message: '没有可处理的视频', total: 0 });
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: '未配置 MINIMAX_API_KEY' }, { status: 500 });
    }

    let toProcess: string[];
    if (step === 'all') {
      toProcess = selectedIds
        ? selectedIds.filter(id => videoIds.includes(id))
        : forceRetag
          ? videoIds
          : videoIds.filter(id => needsTagging(id) || needsTranslation(id) || needsQuiz(id));
    } else {
      // 单步模式：只处理需要该步骤的视频
      const filterFn = step === 'tag' ? needsTagging
        : step === 'translate' ? needsTranslation
        : step === 'quiz' ? needsQuiz
        : () => true; // vocab 等其他步骤
      toProcess = selectedIds
        ? (forceRetag ? selectedIds : selectedIds.filter(id => videoIds.includes(id)))
        : forceRetag
          ? videoIds
          : videoIds.filter(filterFn);
    }

    if (toProcess.length === 0) {
      return NextResponse.json({ message: '所有视频已处理完毕', total: videoIds.length, processed: 0 });
    }

    const stepLabel = step === 'all' ? '全部处理' : step === 'tag' ? '标签分类' : step === 'translate' ? '字幕翻译' : step === 'quiz' ? '题库生成' : step === 'vocab' ? '单词分类' : step;

    setProgress({
      status: 'running',
      total: toProcess.length,
      current: 0,
      currentVideoId: toProcess[0],
      currentStep: stepLabel,
      results: {},
      logs: [`开始${stepLabel} ${toProcess.length} 个视频...`],
      updatedAt: new Date().toISOString(),
    });

    (async () => {
      const allResults: Record<string, StepResult[]> = {};
      const logs: string[] = [`开始${stepLabel} ${toProcess.length} 个视频...`];

      for (let i = 0; i < toProcess.length; i++) {
        const videoId = toProcess[i];
        const steps: StepResult[] = [];

        let meta: Record<string, string> = {};
        try {
          meta = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, videoId, 'meta.json'), 'utf-8'));
        } catch {}

        const videoLabel = meta.title || videoId;
        logs.push(`[${i + 1}/${toProcess.length}] 处理: ${videoLabel}`);

        // 根据步骤决定执行哪些操作
        const doTag = step === 'all' || step === 'tag';
        const doTranslate = step === 'all' || step === 'translate';
        const doQuiz = step === 'all' || step === 'quiz';
        const doVocab = step === 'all' || step === 'vocab';

        if (doTag) {
          setProgress({
            status: 'running',
            total: toProcess.length,
            current: i + 1,
            currentVideoId: videoId,
            currentStep: '标签分类',
            results: allResults,
            logs: [...logs],
            updatedAt: new Date().toISOString(),
          });

          try {
            const tagResult = forceRetag
              ? await processTagVideoForce(videoId, apiKey)
              : await processTagVideo(videoId, apiKey);
            steps.push(tagResult);
            logs.push(`  标签分类: ${tagResult.status}${tagResult.message ? ' - ' + tagResult.message : ''}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '未知错误';
            steps.push({ step: '标签分类', status: 'error', message: msg });
            logs.push(`  标签分类: 错误 - ${msg}`);
          }
        }

        if (doTranslate) {
          setProgress({
            status: 'running',
            total: toProcess.length,
            current: i + 1,
            currentVideoId: videoId,
            currentStep: '字幕翻译',
            results: allResults,
            logs: [...logs],
            updatedAt: new Date().toISOString(),
          });

          try {
            const transResult = (forceRetag || selectedIds)
              ? await processTranslateForce(videoId)
              : await processTranslate(videoId);
            steps.push(transResult);
            logs.push(`  字幕翻译: ${transResult.status}${transResult.message ? ' - ' + transResult.message : ''}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '未知错误';
            steps.push({ step: '字幕翻译', status: 'error', message: msg });
            logs.push(`  字幕翻译: 错误 - ${msg}`);
          }
        }

        if (doQuiz) {
          setProgress({
            status: 'running',
            total: toProcess.length,
            current: i + 1,
            currentVideoId: videoId,
            currentStep: '题库生成',
            results: allResults,
            logs: [...logs],
            updatedAt: new Date().toISOString(),
          });

          try {
            const quizResult = await processQuiz(videoId, apiKey);
            steps.push(quizResult);
            logs.push(`  题库生成: ${quizResult.status}${quizResult.message ? ' - ' + quizResult.message : ''}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '未知错误';
            steps.push({ step: '题库生成', status: 'error', message: msg });
            logs.push(`  题库生成: 错误 - ${msg}`);
          }
        }

        if (doVocab) {
          setProgress({
            status: 'running',
            total: toProcess.length,
            current: i + 1,
            currentVideoId: videoId,
            currentStep: '单词分类',
            results: allResults,
            logs: [...logs],
            updatedAt: new Date().toISOString(),
          });

          try {
            const vocabResult = await processVocab(videoId);
            steps.push(vocabResult);
            logs.push(`  单词分类: ${vocabResult.status}${vocabResult.message ? ' - ' + vocabResult.message : ''}`);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '未知错误';
            steps.push({ step: '单词分类', status: 'error', message: msg });
            logs.push(`  单词分类: 错误 - ${msg}`);
          }
        }

        allResults[videoId] = steps;
      }

      setProgress({
        status: 'completed',
        total: toProcess.length,
        current: toProcess.length,
        currentVideoId: '',
        currentStep: '',
        results: allResults,
        logs: [...logs, `${stepLabel}完成`],
        updatedAt: new Date().toISOString(),
      });

      revalidatePath('/');
    })();

    return NextResponse.json({ success: true, total: toProcess.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function processVocab(videoId: string): Promise<StepResult> {
  // 单词分类是全局操作，这里只标记跳过（由独立的"单词分类"按钮触发全局构建）
  return { step: '单词分类', status: 'skipped', message: '请使用独立按钮构建词汇库' };
}

async function processTagVideoForce(videoId: string, apiKey: string): Promise<StepResult> {
  const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const title = meta.title || videoId;
  const description = meta.description || '';

  const content = await callMiniMax(
    [
      { role: 'system', content: TAG_SYSTEM_PROMPT },
      { role: 'user', content: `标题: ${title}\n描述: ${description}` },
    ],
    apiKey,
    30000
  );

  let parsed: { category?: string; difficulty?: string; reason?: string };
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('无法解析AI返回');
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { step: '标签分类', status: 'error', message: 'AI返回格式异常' };
  }

  const category = VALID_CATEGORIES.includes(parsed.category || '') ? parsed.category : 'other';
  const difficulty = VALID_DIFFICULTIES.includes(parsed.difficulty || '') ? parsed.difficulty : 'intermediate';

  meta.category = category;
  meta.difficulty = difficulty;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

  return { step: '标签分类', status: 'done', message: `${category} / ${difficulty}` };
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  return NextResponse.json(getProgress());
}
