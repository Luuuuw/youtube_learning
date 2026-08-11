// AI 闪卡生成器：从字幕 / 中文翻译 / quiz-bank 抽取 3 维度闪卡草稿
//
// 输出到 public/content/<videoId>/flashcards.json（草稿，未进 data/flashcards.json）
// 不调 flashcardDb.addCard——由审核台审过后单独入库。
//
// 三批并行 DeepSeek 调用：词汇 / 听力 / 句型。任一失败兜底空数组，不一锅端。

import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { parseVtt, type Subtitle } from '@/lib/vtt-parser';
import { SHARED_OWNER, type Flashcard } from '@/lib/flashcard-db';
import { AI_MODELS } from '@/lib/ai-models';

// ---------- 类型 ----------

interface VocabRaw {
  word: string;
  pos: string;
  cefr: string;
  definition_zh: string;
  context_sentence: string;
  context_start: number;
  context_end: number;
}

interface ListeningRaw {
  id: number;
  front_with_blank: string;
  correct: string;
  distractors: string[];
}

interface SentenceRaw {
  pattern: string;       // 句型名称，仅用作 hint
  fills: string[];       // 精确指定挖空的词（按顺序，每个至少 3 字符）
  context_sentence: string;
  context_start: number;
  context_end: number;
}

interface QuizQuestion {
  id: number;
  type: string;
  question: string;
  options?: string[];
  answer?: string;
  startTime?: number;
  endTime?: number;
}

interface QuizBank {
  questions?: QuizQuestion[];
}

// ---------- DeepSeek 调用 helper ----------

async function callDS(sys: string, user: string, apiKey: string): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
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
    const content = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 工具 ----------

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function nowIso(): string {
  return new Date().toISOString();
}

// 中文翻译 map：key="start-end" -> 中文字符串。
// 字幕 cue 时间戳可能落在中文区间内部，按 startTime ∈ [k_start, k_end] 模糊匹配。
function buildZhLookup(zhMap: Record<string, string>): (startTime: number) => string {
  interface Bucket { start: number; end: number; text: string }
  const buckets: Bucket[] = [];
  for (const key of Object.keys(zhMap)) {
    const m = key.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    buckets.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), text: zhMap[key] });
  }
  buckets.sort((a, b) => a.start - b.start);

  return (startTime: number) => {
    // 优先包含 startTime 的桶
    for (const b of buckets) {
      if (startTime >= b.start && startTime < b.end) return b.text;
    }
    // 找最近的
    let best: Bucket | null = null;
    let bestDist = Infinity;
    for (const b of buckets) {
      const d = Math.min(Math.abs(b.start - startTime), Math.abs(b.end - startTime));
      if (d < bestDist) { bestDist = d; best = b; }
    }
    return best?.text || '';
  };
}

// 把 word 在 sentence 里加 **markdown 高亮**（大小写不敏感，全词匹配优先）
function highlightWord(sentence: string, word: string): string {
  if (!sentence || !word) return sentence;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 词形可能不一致（procrastinating vs procrastinate），先全词匹配，失败用 prefix
  const wordRe = new RegExp(`\\b(${escaped})\\b`, 'i');
  if (wordRe.test(sentence)) {
    return sentence.replace(wordRe, '**$1**');
  }
  const stem = escaped.slice(0, Math.max(4, Math.floor(escaped.length * 0.7)));
  const stemRe = new RegExp(`\\b(${stem}\\w*)\\b`, 'i');
  if (stemRe.test(sentence)) {
    return sentence.replace(stemRe, '**$1**');
  }
  return sentence;
}

// 短功能词绝对不能作为挖空词
const FILLER_WORDS = new Set(['to', 'be', 'in', 'at', 'on', 'of', 'by', 'a', 'an', 'the', 'it', 'is', 'are', 'was', 'were', 'for', 'or', 'and', 'but', 'not', 'no']);

function applyFills(sentence: string, fills: string[]): { front_cloze: string; matched: string[] } {
  let front = sentence;
  const matched: string[] = [];
  for (const w of fills) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(front)) {
      front = front.replace(re, '___');
      matched.push(w);
    }
  }
  return { front_cloze: front, matched };
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 从字幕里找包含某词的 cue → 得到时间戳
function findCueContaining(subs: Subtitle[], word: string): Subtitle | null {
  const lower = word.toLowerCase();
  const stem = lower.slice(0, Math.max(4, Math.floor(lower.length * 0.7)));
  // 先全词
  for (const s of subs) {
    const re = new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(s.text)) return s;
  }
  // prefix
  for (const s of subs) {
    if (s.text.toLowerCase().includes(stem)) return s;
  }
  return null;
}

// ---------- Prompt 构造 ----------

function buildVocabPrompt(enFullText: string, zhFullText: string): { sys: string; user: string } {
  const sys = `你是英语学习闪卡生成助手。从字幕中抽取 CEFR B1-C1 难度的生词（最多 12 个），排除 A1-A2 常见词（the/is/have/go 等）、专有名词、纯介词/连词。每个词给出词性、CEFR 等级、中文释义、原句、原句起止时间。

只输出严格的 JSON：
{"cards":[{"word":"procrastinate","pos":"verb","cefr":"B2","definition_zh":"拖延","context_sentence":"...","context_start":45.3,"context_end":48.1}]}`;
  const user = `英文字幕全文：
${enFullText}

中文翻译参考：
${zhFullText}

请抽取 8-12 个 CEFR B1-C1 的实用生词，按重要性排序。`;
  return { sys, user };
}

function buildListeningPrompt(items: Array<{ id: number; sentence: string }>): { sys: string; user: string } {
  const sys = `你是英语听力填空闪卡生成助手。给定若干英文句子，从每句挑 1 个关键内容词（名词/动词/形容词/副词）挖空，生成填空题。要求：
- correct 是从原句精确摘取的单词（保持原形态、大小写）
- 给 3 个干扰项（distractors），同词性、有迷惑性、但放回原句不通顺
- front_with_blank 是把 correct 替换为 ___（三个下划线）后的整句

只输出严格的 JSON：
{"cards":[{"id":1,"front_with_blank":"I'd rather grab a quick bite than go to a ___ restaurant","correct":"fancy","distractors":["expensive","big","new"]}]}`;
  const user = `句子列表：
${items.map(it => `[${it.id}] ${it.sentence}`).join('\n')}

每一条都要生成一张填空卡（id 必须对应输入的 id）。`;
  return { sys, user };
}

function buildSentencePrompt(enFullText: string, zhFullText: string): { sys: string; user: string } {
  const sys = `你是英语句型分析助手。从字幕中找**真正有价值的语法句型**做成填空卡。

## 目标句型类别
- 虚拟语气: if only / I wish / as if / would rather sb did / it's time sb did
- 倒装结构: not only ... but also / hardly ... when / no sooner ... than / only when
- 强调句式: it is ... that / what ... is / the reason why
- 复杂时态语态: should have done / must have been / needn't have / would have been
- 地道衔接: given that / provided that / now that / as far as / when it comes to
- 比较结构: the more ... the more / rather ... than / as ... as

## 挖空规则 (非常重要！)
- fills 数组里每个词长度至少 3 个字符（to/be/in/at/on/of/by/a/an 绝对不要放入 fills）
- fills 必须是句子的**语法骨架词**，不是普通动词/名词
- 例如 "would have been able to appreciate" → fills: ["would","have","been","able"]（不挖 to）
- 例如 "the more I practice the better I get" → fills: ["the","more","the","better"]
- 至少挖 2 个词、最多 5 个词

## 质量要求
- 找不到合适句型就返回空数组 []，别凑数
- 最多 5 个实例

只输出 JSON：
{"cards":[{"pattern":"if only had","fills":["if","only","had"],"context_sentence":"if only I had more time here in Santa Barbara","context_start":10.0,"context_end":15.0}]}
context_sentence 必须从上方英文字幕原文逐字复制，禁止自行编造。`;
  const user = `英文字幕（带时间戳）：
${enFullText}

中文翻译参考：
${zhFullText}

挑出真正有教学价值的语法句型，没把握的宁可跳过。fills 只放语法结构词。`;
  return { sys, user };
}

// ---------- 解析 AI 返回 ----------

function asArray<T = unknown>(raw: unknown, key = 'cards'): T[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const v = obj[key];
  return Array.isArray(v) ? (v as T[]) : [];
}

function vocabToFlashcard(v: VocabRaw, videoId: string, subs: Subtitle[]): Flashcard | null {
  if (!v?.word || !v?.definition_zh) return null;
  // 时间戳兜底：AI 给的不准就从字幕里 grep
  let start = typeof v.context_start === 'number' ? v.context_start : undefined;
  let end = typeof v.context_end === 'number' ? v.context_end : undefined;
  let contextSentence = v.context_sentence || '';
  if (start === undefined || end === undefined || start >= end) {
    const cue = findCueContaining(subs, v.word);
    if (cue) {
      start = cue.startTime;
      end = cue.endTime;
      if (!contextSentence) contextSentence = cue.text;
    }
  }
  const highlighted = highlightWord(contextSentence, v.word);
  const tags = [`CEFR-${v.cefr || 'B1'}`];
  if (v.pos) tags.push(v.pos);

  return {
    id: generateId(),
    videoId,
    dimension: 'vocab',
    type: 'recognition',
    front: v.word,
    back: `${v.definition_zh} (${v.pos || '?'}, ${v.cefr || 'B1'})`,
    context: highlighted,
    audioStart: start,
    audioEnd: end,
    word: v.word.toLowerCase(),
    tags,
    owner: SHARED_OWNER,
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: nowIso(),
  };
}

function listeningToFlashcard(
  l: ListeningRaw,
  videoId: string,
  src: { sentence: string; startTime: number; endTime: number },
): Flashcard | null {
  if (!l?.front_with_blank || !l?.correct) return null;
  if (!l.front_with_blank.includes('___')) return null; // AI 没挖空，丢弃
  const choices = [l.correct, ...(l.distractors || [])].filter(Boolean);
  const hint = `选项：${shuffle(choices).join(' / ')}`;

  return {
    id: generateId(),
    videoId,
    dimension: 'listening',
    type: 'audio_fill',
    front: `(听音频) ${l.front_with_blank}`,
    back: l.correct,
    context: src.sentence,
    audioStart: src.startTime,
    audioEnd: src.endTime,
    hint,
    tags: ['fill-in-blank'],
    owner: SHARED_OWNER,
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: nowIso(),
  };
}

// 从字幕里找包含某段文本的 cue，返回该 cue 及其前后相邻 cues（用于中文匹配）
function findCueForSentence(subs: Subtitle[], sentence: string): Subtitle | null {
  if (!sentence) return null;
  const normalized = sentence.toLowerCase().trim();
  // 尝试前 6、5、4 词逐步缩短匹配
  for (const n of [6, 5, 4]) {
    const prefix = normalized.split(/\s+/).slice(0, n).join(' ');
    if (prefix.length < 10) continue;
    for (const s of subs) {
      if (s.text.toLowerCase().includes(prefix)) return s;
    }
  }
  return null;
}

// 找到句子后获取对应的中文翻译（只取该 cue + 前一条的中文）
function findChineseForSentence(
  subs: Subtitle[],
  sentence: string,
  zhLookup: (startTime: number) => string,
): string {
  const cue = findCueForSentence(subs, sentence);
  if (!cue) return '';
  const idx = subs.indexOf(cue);
  const texts: string[] = [];
  // 前一条 cue
  if (idx > 0) {
    const t = zhLookup(subs[idx - 1].startTime);
    if (t) texts.push(t);
  }
  // 当前 cue
  const t = zhLookup(cue.startTime);
  if (t) texts.push(t);
  return texts.join(' ');
}

function sentenceToFlashcard(
  s: SentenceRaw,
  videoId: string,
  subs: Subtitle[],
  zhLookup: (startTime: number) => string,
): Flashcard | null {
  if (!s?.context_sentence) return null;

  // 使用 AI 指定的 fills（新格式）或从 pattern 推导（兼容旧格式）
  let fills: string[];
  if (s.fills && Array.isArray(s.fills) && s.fills.length >= 2) {
    // 新格式：AI 直接指定 fills，过滤废词
    fills = s.fills.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
    if (fills.length !== s.fills.length) {
      // 有些词被过滤了，跳过此卡
      return null;
    }
  } else if (s.pattern) {
    // 兼容旧格式
    const words = s.pattern.split(/\s+/).filter(Boolean);
    // 过滤废词
    fills = words.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
    if (fills.length < 2) return null;
  } else {
    return null;
  }

  if (fills.length < 2 || fills.length > 5) return null;

  // 用 fills 在句子里精确挖空
  const { front_cloze, matched } = applyFills(s.context_sentence, fills);
  if (matched.length < 2) return null;

  // 用文本匹配找字幕 cue → 得到正确时间戳。找不到则说明 AI 编造的句子，丢弃。
  const cue = findCueForSentence(subs, s.context_sentence);
  if (!cue) return null;
  const start = cue.startTime;
  const end = cue.endTime;

  // 中文翻译：优先精确匹配，失败用 AI 时间戳兜底
  let zhText = findChineseForSentence(subs, s.context_sentence, zhLookup);
  if (!zhText && s.context_start !== undefined && s.context_end !== undefined) {
    zhText = zhLookup(s.context_start);
  }
  const zhPrefix = zhText ? `${zhText}\n` : '';

  return {
    id: generateId(),
    videoId,
    dimension: 'sentence',
    type: 'cloze',
    front: `${zhPrefix}${front_cloze}`,
    back: fills.join(' / '),
    context: s.context_sentence || '',
    audioStart: start,
    audioEnd: end,
    hint: s.pattern || fills.join(' '),
    tags: ['pattern'],
    owner: SHARED_OWNER,
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: nowIso(),
  };
}

// ---------- 主导出 ----------

export async function generateFlashcards(videoId: string): Promise<{
  cards: Flashcard[];
  stats: { vocab: number; listening: number; sentence: number };
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 缺失');

  const baseDir = path.join(process.cwd(), 'public', 'content', videoId);
  const vttPath = path.join(baseDir, 'video.en.vtt');
  const zhPath = path.join(baseDir, 'video.zh-Hans.json');
  const quizPath = path.join(baseDir, 'quiz-bank.json');

  let vttRaw: string;
  let zhRaw: string;
  let quizRaw: string;
  try {
    vttRaw = fs.readFileSync(vttPath, 'utf-8');
    zhRaw = fs.readFileSync(zhPath, 'utf-8');
    quizRaw = fs.readFileSync(quizPath, 'utf-8');
  } catch {
    throw new Error('视频文件不全');
  }

  const subs = parseVtt(vttRaw);
  if (subs.length === 0) throw new Error('视频文件不全');

  let zhMap: Record<string, string> = {};
  try { zhMap = JSON.parse(zhRaw); } catch { /* 容忍空 */ }
  const zhLookup = buildZhLookup(zhMap);

  let quizBank: QuizBank;
  try { quizBank = JSON.parse(quizRaw); } catch { throw new Error('视频文件不全'); }
  const quizQuestions = Array.isArray(quizBank.questions) ? quizBank.questions : [];

  // 构造文本上下文
  const enFullText = subs
    .map(s => `[${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}] ${s.text}`)
    .join('\n');
  const zhFullText = subs
    .map(s => zhLookup(s.startTime))
    .filter(Boolean)
    .join(' / ');

  // ---- 听力题源：从 quiz-bank 筛 endTime-startTime ∈ [3,8] 的 choice 题，取前 8
  const listeningSources = quizQuestions
    .filter(q =>
      typeof q.startTime === 'number' &&
      typeof q.endTime === 'number' &&
      q.endTime - q.startTime >= 3 &&
      q.endTime - q.startTime <= 8,
    )
    .slice(0, 8)
    .map(q => {
      // 找该时间段内的英文句子作为原文（拼接落区间内的字幕）
      const within = subs.filter(s =>
        s.startTime >= (q.startTime as number) - 0.5 &&
        s.endTime <= (q.endTime as number) + 0.5,
      );
      const sentence = within.length > 0
        ? within.map(s => s.text).join(' ')
        : (subs.find(s =>
            s.startTime >= (q.startTime as number) - 0.5 &&
            s.startTime <= (q.endTime as number) + 0.5,
          )?.text || '');
      return {
        id: q.id,
        sentence,
        startTime: q.startTime as number,
        endTime: q.endTime as number,
      };
    })
    .filter(it => it.sentence && it.sentence.split(/\s+/).length >= 4);

  // ---- 三批并行
  const vocabPromise = (async (): Promise<Flashcard[]> => {
    const { sys, user } = buildVocabPrompt(enFullText, zhFullText);
    const raw = await callDS(sys, user, apiKey);
    const list = asArray<VocabRaw>(raw).slice(0, 12);
    return list.map(v => vocabToFlashcard(v, videoId, subs)).filter((c): c is Flashcard => c !== null);
  })();

  const listeningPromise = (async (): Promise<Flashcard[]> => {
    if (listeningSources.length === 0) return [];
    const { sys, user } = buildListeningPrompt(
      listeningSources.map(s => ({ id: s.id, sentence: s.sentence })),
    );
    const raw = await callDS(sys, user, apiKey);
    const list = asArray<ListeningRaw>(raw);
    const byId = new Map(listeningSources.map(s => [s.id, s]));
    const out: Flashcard[] = [];
    for (const l of list) {
      const src = byId.get(l.id);
      if (!src) continue;
      const card = listeningToFlashcard(l, videoId, src);
      if (card) out.push(card);
    }
    return out;
  })();

  const sentencePromise = (async (): Promise<Flashcard[]> => {
    const { sys, user } = buildSentencePrompt(enFullText, zhFullText);
    const raw = await callDS(sys, user, apiKey);
    const list = asArray<SentenceRaw>(raw).slice(0, 8);
    return list.map(s => sentenceToFlashcard(s, videoId, subs, zhLookup)).filter((c): c is Flashcard => c !== null);
  })();

  const results = await Promise.allSettled([vocabPromise, listeningPromise, sentencePromise]);
  const labels = ['vocab', 'listening', 'sentence'] as const;
  const buckets: Flashcard[][] = [[], [], []];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      buckets[i] = r.value;
    } else {
      console.warn(`[flashcard-gen] ${labels[i]} 生成失败:`, (r.reason as Error)?.message || r.reason);
    }
  });

  const [vocabCards, listeningCards, sentenceCards] = buckets;
  const cards: Flashcard[] = [...vocabCards, ...listeningCards, ...sentenceCards];

  const stats = {
    vocab: vocabCards.length,
    listening: listeningCards.length,
    sentence: sentenceCards.length,
  };

  // 草稿落盘
  const outPath = path.join(baseDir, 'flashcards.json');
  atomicWriteJsonSync(outPath, {
    videoId,
    generatedAt: nowIso(),
    cards,
  });

  return { cards, stats };
}
