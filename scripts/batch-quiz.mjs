// 批量生成 quiz-bank.json：找到所有缺少 quiz-bank.json 的视频并生成
// 用法: node scripts/batch-quiz.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const API_TIMEOUT_MS = 180_000;
const VALID_DIFFICULTIES = ['easy', 'medium', 'hard'];

const dryRun = process.argv.includes('--dry-run');

// parse VTT
function parseVtt(raw) {
  const lines = raw.split(/\r?\n/);
  const cues = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}:)?(\d{2}):(\d{2})\.(\d{3})/);
    if (m) {
      const toSec = (h, m2, s, ms) => (parseInt(h||'0')*3600 + parseInt(m2)*60 + parseInt(s) + parseInt(ms)/1000);
      const start = toSec(m[1], m[2], m[3], m[4]);
      const end = toSec(m[5], m[6], m[7], m[8]);
      i++;
      const textLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const t = lines[i].trim();
        if (!t.startsWith('<') || (t.includes('>') && t.indexOf('>') < t.length - 1)) {
          const clean = t.replace(/<[^>]+>/g, '').trim();
          if (clean) textLines.push(clean);
        }
        i++;
      }
      const text = textLines.join(' ');
      if (text) cues.push({ startTime: start, endTime: end, text });
    }
    i++;
  }
  return cues;
}

async function callMiniMax(messages, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'MiniMax-M3', messages }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function generateQuiz(videoId, apiKey) {
  const vttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(vttPath)) throw new Error('VTT missing');

  const raw = fs.readFileSync(vttPath, 'utf-8');
  const subs = parseVtt(raw);
  if (subs.length < 5) throw new Error('Too few subtitles');

  const sampled = subs
    .filter(s => s.text && s.text.trim().length > 3)
    .sort(() => Math.random() - 0.5)
    .slice(0, 50);

  const subtitleText = sampled.map((s, i) =>
    `[${i + 1}] [${s.startTime.toFixed(1)}s-${s.endTime.toFixed(1)}s] ${s.text}`
  ).join('\n');

  const sysPrompt = `# 视频英语测试题库生成系统

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
5. **explanation**: 中文解析
6. **referenceAnswer**: 口语题参考答案要点，选择题留空字符串
7. **hint**: 口语题提示，选择题留空字符串
8. **startTime**: 对应视频片段起始时间（秒）
9. **endTime**: 对应视频片段结束时间（秒）
10. **difficulty**: "easy" / "medium" / "hard"
11. **relatedWords**: 与这道题相关的关键英文单词数组（2-5个）

### 出题规则
1. 每道题必须基于字幕中的实际内容
2. 题目覆盖视频中不同时间段的内容
3. 难度层次：easy 约30%、medium 约50%、hard 约20%
4. 4个选项必须完整有意义，干扰项要有迷惑性
5. explanation 用中文详细解释
6. 片段长度建议在 5-30 秒之间

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

  const userPrompt = `视频标题：${videoId}

以下是视频的部分字幕内容（已随机采样）：

${subtitleText}

请根据以上内容生成20-25道测试题，构成一个完整的题库。`;

  const content = await callMiniMax(
    [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey
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
      throw new Error('AI 返回的格式无法解析');
    }
  }

  if (!parsed.questions || !Array.isArray(parsed.questions)) {
    throw new Error('AI 返回缺少 questions 字段');
  }

  const questions = parsed.questions.map((q, idx) => {
    const diff = String(q.difficulty || '').toLowerCase();
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
      difficulty: VALID_DIFFICULTIES.includes(diff) ? diff : 'medium',
      relatedWords: Array.isArray(q.relatedWords) ? q.relatedWords.map(String).filter(w => w.length > 0) : ['general'],
    };
  });

  if (questions.length < 12) {
    throw new Error(`只生成了${questions.length}道题，至少需要12道`);
  }

  const bankData = {
    videoId,
    title: videoId,
    generatedAt: new Date().toISOString(),
    version: 1,
    totalQuestions: questions.length,
    stats: {
      easy: questions.filter(q => q.difficulty === 'easy').length,
      medium: questions.filter(q => q.difficulty === 'medium').length,
      hard: questions.filter(q => q.difficulty === 'hard').length,
      choice: questions.filter(q => q.type === 'choice').length,
      speaking: questions.filter(q => q.type === 'speaking').length,
    },
    questions,
  };

  const outPath = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
  if (!dryRun) {
    fs.writeFileSync(outPath, JSON.stringify(bankData, null, 2), 'utf-8');
  }

  return bankData;
}

// ---------- main ----------
const missing = [];
for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'test-video') continue;
  const dir = path.join(CONTENT_DIR, entry.name);
  const hasVtt = fs.existsSync(path.join(dir, 'video.en.vtt'));
  const hasQuiz = fs.existsSync(path.join(dir, 'quiz-bank.json'));
  if (hasVtt && !hasQuiz) missing.push(entry.name);
}

console.log(`待生成 quiz: ${missing.length} 个视频\n`);
if (missing.length === 0) process.exit(0);

if (dryRun) {
  console.log('[DRY RUN] 不会实际生成');
  for (const id of missing) console.log(`  ${id}`);
  process.exit(0);
}

// load env
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apiKey = process.env.MINIMAX_API_KEY;
if (!apiKey) {
  console.error('MINIMAX_API_KEY 缺失');
  process.exit(1);
}

const DELAY_MS = 15_000;
let done = 0;
let ok = 0;
let fail = 0;

for (const videoId of missing) {
  done++;
  process.stdout.write(`[${done}/${missing.length}] ${videoId} ... `);
  try {
    const bank = await generateQuiz(videoId, apiKey);
    console.log(`OK (${bank.totalQuestions} 题, ${bank.stats.choice}c/${bank.stats.speaking}s)`);
    ok++;
  } catch (e) {
    console.log(`FAIL: ${e instanceof Error ? e.message.slice(0, 100) : String(e)}`);
    fail++;
  }

  if (done < missing.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n=== Quiz 生成完成 ===`);
console.log(`成功: ${ok}, 失败: ${fail}`);
