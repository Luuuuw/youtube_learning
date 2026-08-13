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
  expression: string;    // 完整地道表达，如 "ended up"
  meaning_zh: string;    // 表达的中文释义，如 "最终，结果"
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
    // 优先包含 startTime 的桶；重叠时选 start 最靠后的（刚开始的 cue）
    let best: Bucket | null = null;
    for (const b of buckets) {
      if (startTime >= b.start && startTime < b.end) {
        if (!best || b.start > best.start) best = b;
      }
    }
    if (best) return best.text;
    // 找最近的
    let nearest: Bucket | null = null;
    let bestDist = Infinity;
    for (const b of buckets) {
      const d = Math.min(Math.abs(b.start - startTime), Math.abs(b.end - startTime));
      if (d < bestDist) { bestDist = d; nearest = b; }
    }
    return nearest?.text || '';
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

// 把完整表达（如 "ended up" / "at the end of the day"）整段挖空
function blankPhrase(sentence: string, phrase: string): string | null {
  const trimmed = phrase.trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  if (!re.test(sentence)) return null;  // 表达不在句子里（AI 编造），丢弃
  return sentence.replace(re, '___');
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
  const sys = `你是英语口语搭配分析助手。从字幕中找**地道、高频、实用的口语表达/固定搭配**做成填空卡，帮助中文母语者学习自然英语。

## 目标表达类型（按优先级）
- 动词短语 phrasal verb: figure out / end up / come up with / give up / turn out / put off / get along / look forward to / run out of / set up / catch up
- 固定搭配 collocation: make sense / take a break / pay attention / do my best / a couple of / a bunch of / kind of / sort of / at least / so far
- 惯用表达 idiom/chunk: it's been a minute / at the end of the day / no worries / to be honest / by the way / after all / for now / as far as
- 自然口语衔接 discourse marker: you know / I mean / you know what / the thing is / here's the thing

## 挖空规则（重要）
- expression 是**完整的关键表达**，2~6 个词，从字幕原文逐字复制
- meaning_zh 是该表达的中文释义（简短，2~8 字）
- 把整段表达当作一个整体挖空，不拆词、不单独挖 to/the/of 等虚词

## 排除
- 纯语法句型（would have done / I wish + 过去式 / 虚拟语气 / 倒装）除非本身是高频口语
- 太简单的问候/客套（good morning / thank you / how are you / nice to meet you）
- 单词量只有 1 的单词（那是生词卡的职责）

## 质量要求
- 只挑中国学生真正需要学的地道表达，宁缺毋滥
- 找不到合适的就返回空数组 []
- 最多 5 个实例

只输出 JSON：
{"cards":[{"expression":"ended up","meaning_zh":"最终，结果","context_sentence":"I ended up not going.","context_start":10.0,"context_end":15.0}]}
context_sentence 必须从上方英文字幕原文逐字复制，禁止自行编造。`;
  const user = `英文字幕（带时间戳）：
${enFullText}

中文翻译参考：
${zhFullText}

挑出真正地道、中国学生需要学的口语搭配，没把握的宁可跳过。`;
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

// 找到句子后获取对应的中文翻译（只取当前 cue，避免前一条串味）
function findChineseForSentence(
  subs: Subtitle[],
  sentence: string,
  zhLookup: (startTime: number) => string,
): string {
  const cue = findCueForSentence(subs, sentence);
  if (!cue) return '';
  return zhLookup(cue.startTime);
}

function sentenceToFlashcard(
  s: SentenceRaw,
  videoId: string,
  subs: Subtitle[],
  zhLookup: (startTime: number) => string,
): Flashcard | null {
  const expression = s.expression?.trim();
  if (!s?.context_sentence || !expression) return null;
  const wordCount = expression.split(/\s+/).length;
  if (wordCount < 2 || wordCount > 6) return null;

  // 整段表达挖空；表达不在句子里（AI 编造）则丢弃
  const frontCloze = blankPhrase(s.context_sentence, expression);
  if (!frontCloze) return null;

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
    front: `${zhPrefix}${frontCloze}`,
    back: expression,
    context: s.context_sentence || '',
    audioStart: start,
    audioEnd: end,
    hint: s.meaning_zh || '',
    tags: ['collocation'],
    owner: SHARED_OWNER,
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: nowIso(),
  };
}

// ---------- 主导出 ----------

export interface GenerateFlashcardsOptions {
  dimensions?: ('vocab' | 'listening' | 'sentence')[];
  writeDraft?: boolean;
}

export async function generateFlashcards(
  videoId: string,
  options: GenerateFlashcardsOptions = {},
): Promise<{
  cards: Flashcard[];
  stats: { vocab: number; listening: number; sentence: number };
}> {
  const want = new Set(options.dimensions ?? ['vocab', 'listening', 'sentence']);
  const writeDraft = options.writeDraft ?? true;
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

  // ---- 三批并行（按需）
  const builders: Array<{ label: 'vocab' | 'listening' | 'sentence'; run: () => Promise<Flashcard[]> }> = [];

  if (want.has('vocab')) {
    builders.push({
      label: 'vocab',
      run: async (): Promise<Flashcard[]> => {
        const { sys, user } = buildVocabPrompt(enFullText, zhFullText);
        const raw = await callDS(sys, user, apiKey);
        const list = asArray<VocabRaw>(raw).slice(0, 12);
        return list.map(v => vocabToFlashcard(v, videoId, subs)).filter((c): c is Flashcard => c !== null);
      },
    });
  }

  if (want.has('listening')) {
    builders.push({
      label: 'listening',
      run: async (): Promise<Flashcard[]> => {
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
      },
    });
  }

  if (want.has('sentence')) {
    builders.push({
      label: 'sentence',
      run: async (): Promise<Flashcard[]> => {
        const { sys, user } = buildSentencePrompt(enFullText, zhFullText);
        const raw = await callDS(sys, user, apiKey);
        const list = asArray<SentenceRaw>(raw).slice(0, 8);
        return list.map(s => sentenceToFlashcard(s, videoId, subs, zhLookup)).filter((c): c is Flashcard => c !== null);
      },
    });
  }

  const results = await Promise.allSettled(builders.map(b => b.run()));
  const buckets: Record<'vocab' | 'listening' | 'sentence', Flashcard[]> = {
    vocab: [],
    listening: [],
    sentence: [],
  };
  results.forEach((r, i) => {
    const label = builders[i].label;
    if (r.status === 'fulfilled') {
      buckets[label] = r.value;
    } else {
      console.warn(`[flashcard-gen] ${label} 生成失败:`, (r.reason as Error)?.message || r.reason);
    }
  });

  const vocabCards = buckets.vocab;
  const listeningCards = buckets.listening;
  const sentenceCards = buckets.sentence;
  const cards: Flashcard[] = [...vocabCards, ...listeningCards, ...sentenceCards];

  const stats = {
    vocab: vocabCards.length,
    listening: listeningCards.length,
    sentence: sentenceCards.length,
  };

  // 草稿落盘
  if (writeDraft) {
    const outPath = path.join(baseDir, 'flashcards.json');
    atomicWriteJsonSync(outPath, {
      videoId,
      generatedAt: nowIso(),
      cards,
    });
  }

  return { cards, stats };
}
