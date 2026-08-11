// AI 二审：拿到 public/content/<videoId>/flashcards.json 的草稿，
// 按维度（vocab / listening / sentence）分组并行调 DeepSeek，
// 每张卡判 pass / review / reject + reason。
//
// 不直接 approve 落库——只输出 verdicts，前端拿到后再标记 approveSet/rejectSet。
//
// 三批 Promise.allSettled 并行：单维度失败 → 该维度 cards 默认 verdict='review'，不一锅端。

import fs from 'fs';
import path from 'path';
import { type Flashcard, type Dimension } from '@/lib/flashcard-db';
import { AI_MODELS } from '@/lib/ai-models';

// ---------- 导出类型 ----------

export type Verdict = 'pass' | 'review' | 'reject';

export interface CardVerdict {
  cardId: string;
  verdict: Verdict;
  reason?: string;
}

// ---------- DeepSeek 调用 helper（与 flashcard-gen.ts 解耦，单独写一份）----------

async function callDS(sys: string, user: string, apiKey: string): Promise<{ verdicts: CardVerdict[] }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch(AI_MODELS.deepseek_chat.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODELS.deepseek_chat.id,
        temperature: 0.2,
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
    const parsed = JSON.parse(content);
    return { verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [] };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 草稿读取 ----------

interface DraftFile {
  videoId: string;
  generatedAt?: string;
  cards: Flashcard[];
}

function readDraft(videoId: string): DraftFile {
  const file = path.join(process.cwd(), 'public', 'content', videoId, 'flashcards.json');
  if (!fs.existsSync(file)) throw new Error('视频草稿不存在');
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    throw new Error('视频草稿不存在');
  }
  let data: Partial<DraftFile>;
  try {
    data = JSON.parse(raw) as Partial<DraftFile>;
  } catch {
    throw new Error('视频草稿不存在');
  }
  const cards = Array.isArray(data.cards) ? (data.cards as Flashcard[]) : [];
  return {
    videoId,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : undefined,
    cards,
  };
}

// ---------- Prompt 构造（每个维度独立）----------

const VOCAB_SYS = `你是英语教学审核专家。审核词汇闪卡，每张卡判 pass / review / reject。

判定标准：
- pass：词在 CEFR B1-C1 范围、定义准确、例句完整通顺
- review：可能太常见（接近 A2）、定义略偏、例句有歧义 → admin 看一眼
- reject：词太常见（A1-A2 如 the/go/eat）、专有名词、定义错误、例句截断不完整

输出严格 JSON：{"verdicts":[{"id":"xxx","verdict":"pass|review|reject","reason":"原因（review/reject 必填，pass 可空）"}]}
必须返回输入的全部 N 张卡。`;

const LISTENING_SYS = `你是英语听力题审核专家。审核听力填空卡，每张卡判 pass / review / reject。

判定标准：
- pass：填空有唯一正确答案、distractors 合理（同词性、长度接近）、原句完整
- review：答案略有歧义、distractors 一个过于明显
- reject：填空有多个合理答案、distractors 都是同义词、原句残缺、blank 位置错

输出严格 JSON：{"verdicts":[{"id":"xxx","verdict":"pass|review|reject","reason":"..."}]}
必须返回输入的全部 N 张卡。`;

const SENTENCE_SYS = `你是英语语法审核专家。审核句型 cloze 闪卡。

判定标准：
- pass：cloze 能从原句精确还原、句型名称（pattern）准确、解释清晰
- review：cloze 有多种合理填法、pattern 命名略不准
- reject：cloze 跟原句不一致、pattern 错误、解释跑题

输出严格 JSON：{"verdicts":[{"id":"xxx","verdict":"pass|review|reject","reason":"..."}]}
必须返回输入的全部 N 张卡。`;

interface VocabUserItem {
  id: string;
  word: string;
  definition_back: string;
  context: string;
}

interface ListeningUserItem {
  id: string;
  front_with_blank: string;
  correct: string;
  hint: string;
  context: string;
}

interface SentenceUserItem {
  id: string;
  front_cloze: string;
  correct_fills_back: string;
  pattern_hint: string;
  context: string;
}

function buildVocabUser(cards: Flashcard[]): string {
  const items: VocabUserItem[] = cards.map(c => ({
    id: c.id,
    word: c.word || c.front,
    definition_back: c.back,
    context: c.context,
  }));
  return JSON.stringify(items);
}

function buildListeningUser(cards: Flashcard[]): string {
  const items: ListeningUserItem[] = cards.map(c => ({
    id: c.id,
    front_with_blank: c.front,
    correct: c.back,
    hint: c.hint || '',
    context: c.context,
  }));
  return JSON.stringify(items);
}

function buildSentenceUser(cards: Flashcard[]): string {
  const items: SentenceUserItem[] = cards.map(c => ({
    id: c.id,
    front_cloze: c.front,
    correct_fills_back: c.back,
    pattern_hint: c.hint || '',
    context: c.context,
  }));
  return JSON.stringify(items);
}

// ---------- AI 返回 → 内部 verdicts（注意 AI 返回 id，我们要对回 cardId）----------

interface RawVerdict {
  id?: string;
  cardId?: string;
  verdict?: string;
  reason?: string;
}

function normalizeVerdict(v: string | undefined): Verdict {
  if (v === 'pass' || v === 'review' || v === 'reject') return v;
  return 'review';
}

// 对一组卡走一次 DeepSeek，失败 / 漏审都兜底
async function reviewBucket(
  cards: Flashcard[],
  sys: string,
  userPayload: string,
  apiKey: string,
  label: Dimension,
): Promise<CardVerdict[]> {
  if (cards.length === 0) return [];
  let aiVerdicts: CardVerdict[] = [];
  try {
    const { verdicts } = await callDS(sys, userPayload, apiKey);
    aiVerdicts = (verdicts as unknown as RawVerdict[])
      .map(v => ({
        cardId: (v.cardId || v.id || '').toString(),
        verdict: normalizeVerdict(v.verdict),
        reason: typeof v.reason === 'string' ? v.reason : undefined,
      }))
      .filter(v => v.cardId);
  } catch (e) {
    // 整组失败 → 全部 review
    console.warn(`[flashcard-ai-review] ${label} 调用失败:`, (e as Error)?.message || e);
    return cards.map(c => ({
      cardId: c.id,
      verdict: 'review' as Verdict,
      reason: 'AI 审核失败，需手动审',
    }));
  }

  // 按 cardId 索引；AI 没返回的卡兜底
  const aiMap = new Map(aiVerdicts.map(v => [v.cardId, v]));
  return cards.map(c => {
    const got = aiMap.get(c.id);
    if (got) return got;
    return {
      cardId: c.id,
      verdict: 'review' as Verdict,
      reason: 'AI 漏审',
    };
  });
}

// ---------- 主导出 ----------

export async function aiReviewFlashcards(videoId: string): Promise<{
  verdicts: CardVerdict[];
  stats: { pass: number; review: number; reject: number };
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 缺失');

  const draft = readDraft(videoId);
  const cards = draft.cards;

  const vocabCards = cards.filter(c => c.dimension === 'vocab');
  const listeningCards = cards.filter(c => c.dimension === 'listening');
  const sentenceCards = cards.filter(c => c.dimension === 'sentence');

  const vocabPromise = reviewBucket(vocabCards, VOCAB_SYS, buildVocabUser(vocabCards), apiKey, 'vocab');
  const listeningPromise = reviewBucket(listeningCards, LISTENING_SYS, buildListeningUser(listeningCards), apiKey, 'listening');
  const sentencePromise = reviewBucket(sentenceCards, SENTENCE_SYS, buildSentenceUser(sentenceCards), apiKey, 'sentence');

  const results = await Promise.allSettled([vocabPromise, listeningPromise, sentencePromise]);
  const labels: Dimension[] = ['vocab', 'listening', 'sentence'];
  const sources = [vocabCards, listeningCards, sentenceCards];

  const verdicts: CardVerdict[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      verdicts.push(...r.value);
    } else {
      // 理论上 reviewBucket 内部已捕获，这里再加一道保险
      console.warn(`[flashcard-ai-review] ${labels[i]} 失败兜底:`, (r.reason as Error)?.message || r.reason);
      for (const c of sources[i]) {
        verdicts.push({
          cardId: c.id,
          verdict: 'review',
          reason: 'AI 审核失败，需手动审',
        });
      }
    }
  });

  const stats = { pass: 0, review: 0, reject: 0 };
  for (const v of verdicts) stats[v.verdict]++;

  return { verdicts, stats };
}
