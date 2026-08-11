// 翻译质量 AI 二审 + 单段重译
//
// reviewVideoTranslation：拿 public/content/<videoId>/video.zh-Hans.json 的 {key: zh}
//   配上 video.en.vtt 同窗口内去重后的英文，分批 (20/批) 调 DeepSeek 判 pass/partial/wrong。
//   并发 2 批；单批失败兜底为 partial（不整体 throw）。
//
// retranslateSegment：单段重新翻译一次，写回 zh-Hans.json + 重建 zh-Hans.vtt + invalidate cache。

import fs from 'fs';
import path from 'path';
import { parseVtt } from '@/lib/vtt-parser';
import { atomicWriteJsonSync, atomicWriteTextSync } from '@/lib/atomic-write';
import { invalidateVideoCache } from '@/lib/videos';
import { AI_MODELS } from '@/lib/ai-models';
import { safeAiWrite, buildProposal } from '@/lib/safe-ai-write';
import { mustHaveChinese, mustNotBeEmpty, mustRecordModel } from '@/lib/ai-invariants';

// ---------- 导出类型 ----------

export type TranslationVerdict = 'pass' | 'partial' | 'wrong';

export interface SegmentReview {
  key: string;
  start: number;
  end: number;
  en_full: string;
  zh: string;
  verdict: TranslationVerdict;
  reason?: string;
  missing_info?: string;
}

export interface ReviewCacheFile {
  videoId: string;
  reviewedAt: string;
  segments: SegmentReview[];
  stats: { pass: number; partial: number; wrong: number };
}

// ---------- 路径 helper ----------

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

function zhJsonPath(videoId: string): string {
  return path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');
}
function zhVttPath(videoId: string): string {
  return path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
}
function enVttPath(videoId: string): string {
  return path.join(CONTENT_DIR, videoId, 'video.en.vtt');
}
export function reviewCachePath(videoId: string): string {
  return path.join(CONTENT_DIR, videoId, '.translation-review.json');
}

// ---------- 通用 ----------

function parseSegmentKey(key: string): { start: number; end: number } | null {
  const m = key.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const start = parseFloat(m[1]);
  const end = parseFloat(m[2]);
  if (!isFinite(start) || !isFinite(end)) return null;
  return { start, end };
}

function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// 从 vtt 里抽 [start-0.05, end+0.05] 窗口内 cue,
// 去重 (相邻相同/前缀只取增量), 拼成 en_full
function extractEnFull(videoId: string, start: number, end: number): string {
  const file = enVttPath(videoId);
  if (!fs.existsSync(file)) return '';
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
  const cues = parseVtt(raw, { preserveCues: true });
  if (cues.length === 0) return '';

  const lo = start - 0.05;
  const hi = end + 0.05;
  const inWindow = cues.filter(c => c.startTime >= lo && c.endTime <= hi);
  // 兜底：若 0 cue, 放宽到 overlap
  const picked = inWindow.length > 0
    ? inWindow
    : cues.filter(c => c.startTime < hi && c.endTime > lo);

  const pieces: string[] = [];
  for (const cue of picked) {
    const t = cleanText(cue.text);
    if (!t) continue;
    const last = pieces[pieces.length - 1];
    if (!last) {
      pieces.push(t);
      continue;
    }
    if (t === last) continue;
    // 当前是上一句的前缀（按字符）→ 跳过
    if (last.startsWith(t)) continue;
    // 当前以上一句为前缀 → 用增量替换 last
    if (t.startsWith(last)) {
      pieces[pieces.length - 1] = t;
      continue;
    }
    pieces.push(t);
  }
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

// ---------- DeepSeek 调用 helper (inline，参考 flashcard-ai-review.ts) ----------

interface DSReviewItem {
  key?: string;
  verdict?: string;
  reason?: string;
  missing_info?: string;
}

async function callDSReview(
  sys: string,
  user: string,
  apiKey: string,
): Promise<DSReviewItem[]> {
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
    return Array.isArray(parsed.reviews) ? (parsed.reviews as DSReviewItem[]) : [];
  } finally {
    clearTimeout(timer);
  }
}

async function callDSTranslate(
  sys: string,
  user: string,
  apiKey: string,
): Promise<string> {
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
    return typeof parsed.zh === 'string' ? parsed.zh.trim() : '';
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Prompts ----------

const REVIEW_SYS = `你是中英字幕翻译审核专家。审核每段中文翻译，**只标显著问题**，不要苛求字字对应。

【判定标准】
- pass: 中文传达了英文的核心意思即可。**允许概括、缩减、口语化改写、去填充词**
- partial: 中文**确实遗漏了独立有价值的信息**（如完整一句话、人名、数字、关键动作）
- wrong: 中文跑题、严重错译、与英文意思相反

【重要规则 — 这些情况是 pass，不是 partial】
- 中文比英文短：字幕翻译就该简洁，中文表达更紧凑
- 漏译填充词（uh, um, you know, like, well, oh, I mean, kind of, sort of）
- 漏译重复词（"good, good, good" 翻一次）
- 漏译口头语（如客套话、感叹）
- 风格调整（如 "I think" 省略变直陈句）
- 把多句英文合并成一句中文表达

【只有这些情况才算 partial】
- 英文里有**一句独立内容**的句子完全没翻（不是修饰词缺漏）
- 漏了具体人名、数字、地名、关键动作（如 "John said three things" → 中文只说"他说"）
- 英文里两个独立的论点，中文只翻其中一个

【示例】

EN: "You know, balance is good. And having all your ducks in a row is good, obviously."
ZH: "做好充分准备是好的，但别因此止步"
verdict: partial — 漏了 "balance is good"（独立信息）

EN: "Uh, I think, like, you know, it's really, really hard"
ZH: "我觉得很难"
verdict: pass — 只是去填充词和重复，核心意思在

EN: "Hello everyone, today I'll talk about three things: love, work, and growth."
ZH: "大家好，今天聊三件事：爱、工作和成长"
verdict: pass — 精炼但完整

EN: "John said he would call, and Mary agreed."
ZH: "John 说会打电话来"
verdict: partial — 漏了 Mary agreed 这个独立动作

EN: "It's so beautiful, oh my god, like, just incredible."
ZH: "太美了，难以置信"
verdict: pass — 感叹的精炼合并

输出严格 JSON：{"reviews":[{"key":"...","verdict":"pass|partial|wrong","reason":"简短","missing_info":"具体哪句独立信息缺了"}]}
missing_info 只在 verdict='partial' 时填，pass/wrong 可空。
必须返回输入的全部 N 段。`;

const TRANSLATE_SYS = `你是专业字幕翻译。把英文翻译成自然口语化中文。15-50 字，按中文语序，保留专有名词英文。输出 JSON: {"zh":"..."}`;

// ---------- 主：reviewVideoTranslation ----------

function normalizeVerdict(v: string | undefined): TranslationVerdict {
  if (v === 'pass' || v === 'partial' || v === 'wrong') return v;
  return 'partial';
}

const BATCH_SIZE = 20;
const PARALLEL = 2;

interface BatchInput {
  key: string;
  start: number;
  end: number;
  en_full: string;
  zh: string;
}

async function reviewBatch(batch: BatchInput[], apiKey: string): Promise<SegmentReview[]> {
  if (batch.length === 0) return [];
  const userPayload = JSON.stringify(
    batch.map(s => ({ key: s.key, en: s.en_full, zh: s.zh })),
  );

  let raw: DSReviewItem[] = [];
  try {
    raw = await callDSReview(REVIEW_SYS, userPayload, apiKey);
  } catch (e) {
    console.warn('[translation-review] DeepSeek 调用失败:', (e as Error)?.message || e);
    return batch.map(s => ({
      key: s.key,
      start: s.start,
      end: s.end,
      en_full: s.en_full,
      zh: s.zh,
      verdict: 'partial' as TranslationVerdict,
      reason: 'AI 审核失败需手动审',
    }));
  }

  const map = new Map<string, DSReviewItem>();
  for (const r of raw) {
    if (typeof r.key === 'string') map.set(r.key, r);
  }

  return batch.map(s => {
    const got = map.get(s.key);
    if (!got) {
      return {
        key: s.key,
        start: s.start,
        end: s.end,
        en_full: s.en_full,
        zh: s.zh,
        verdict: 'partial' as TranslationVerdict,
        reason: 'AI 漏审',
      };
    }
    const verdict = normalizeVerdict(got.verdict);
    return {
      key: s.key,
      start: s.start,
      end: s.end,
      en_full: s.en_full,
      zh: s.zh,
      verdict,
      reason: typeof got.reason === 'string' ? got.reason : undefined,
      missing_info:
        verdict === 'partial' && typeof got.missing_info === 'string'
          ? got.missing_info
          : undefined,
    };
  });
}

export async function reviewVideoTranslation(videoId: string): Promise<{
  segments: SegmentReview[];
  stats: { pass: number; partial: number; wrong: number };
}> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 缺失');

  const jsonFile = zhJsonPath(videoId);
  if (!fs.existsSync(jsonFile)) throw new Error('中文翻译不存在');
  let zhMap: Record<string, string>;
  try {
    zhMap = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  } catch {
    throw new Error('中文翻译解析失败');
  }

  // 构造每段输入
  const inputs: BatchInput[] = [];
  for (const key of Object.keys(zhMap)) {
    const parsed = parseSegmentKey(key);
    if (!parsed) continue;
    const zh = zhMap[key];
    if (typeof zh !== 'string' || !zh.trim()) continue;
    inputs.push({
      key,
      start: parsed.start,
      end: parsed.end,
      en_full: extractEnFull(videoId, parsed.start, parsed.end),
      zh,
    });
  }

  // 切批
  const batches: BatchInput[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
    batches.push(inputs.slice(i, i + BATCH_SIZE));
  }

  // 并发 PARALLEL 批
  const all: SegmentReview[] = [];
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const slice = batches.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(slice.map(b => reviewBatch(b, apiKey)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        all.push(...r.value);
      } else {
        // reviewBatch 内部已兜底，这里再加一道保险
        console.warn('[translation-review] batch 失败兜底:', (r.reason as Error)?.message || r.reason);
        for (const s of slice[idx]) {
          all.push({
            key: s.key,
            start: s.start,
            end: s.end,
            en_full: s.en_full,
            zh: s.zh,
            verdict: 'partial',
            reason: 'AI 审核失败需手动审',
          });
        }
      }
    });
  }

  // 按 start 排序
  all.sort((a, b) => a.start - b.start);

  const stats = { pass: 0, partial: 0, wrong: 0 };
  for (const r of all) stats[r.verdict]++;

  return { segments: all, stats };
}

// ---------- 主：retranslateSegment ----------

function formatVttTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function rebuildZhVtt(videoId: string, zhMap: Record<string, string>): void {
  type Entry = { start: number; end: number; text: string };
  const entries: Entry[] = [];
  for (const key of Object.keys(zhMap)) {
    const parsed = parseSegmentKey(key);
    if (!parsed) continue;
    const text = zhMap[key];
    if (typeof text !== 'string') continue;
    entries.push({ start: parsed.start, end: parsed.end, text });
  }
  entries.sort((a, b) => a.start - b.start);

  const lines: string[] = ['WEBVTT', ''];
  for (const e of entries) {
    lines.push(`${formatVttTime(e.start)} --> ${formatVttTime(e.end)}`);
    lines.push(e.text);
    lines.push('');
  }
  atomicWriteTextSync(zhVttPath(videoId), lines.join('\n'));
}

export async function retranslateSegment(
  videoId: string,
  segmentKey: string,
): Promise<{ newZh: string; enFull: string }> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 缺失');

  const jsonFile = zhJsonPath(videoId);
  if (!fs.existsSync(jsonFile)) throw new Error('中文翻译不存在');
  let zhMap: Record<string, string>;
  try {
    zhMap = JSON.parse(fs.readFileSync(jsonFile, 'utf-8'));
  } catch {
    throw new Error('中文翻译解析失败');
  }

  if (!(segmentKey in zhMap)) throw new Error('段落 key 不存在');

  const parsed = parseSegmentKey(segmentKey);
  if (!parsed) throw new Error('段落 key 格式非法');

  const enFull = extractEnFull(videoId, parsed.start, parsed.end);
  if (!enFull) throw new Error('未找到对应英文片段');

  const newZh = await callDSTranslate(TRANSLATE_SYS, enFull, apiKey);
  if (!newZh) throw new Error('重译结果为空');

  // Safe-Mutation：admin 主动触发的单段重译走 HITL（high），先入 staging 等审批
  const proposal = buildProposal({
    operation: 'translate-segment',
    targetFile: jsonFile,
    before: zhMap[segmentKey],
    after: newZh,
    metadata: {
      model: AI_MODELS.deepseek_chat.id,
      videoId,
      key: segmentKey,
    },
    actor: 'admin:translation-review',
  });

  const result = await safeAiWrite(
    proposal,
    {
      riskLevel: 'high',
      invariants: [mustHaveChinese, mustNotBeEmpty(2), mustRecordModel],
    },
    () => {
      zhMap[segmentKey] = newZh;
      atomicWriteJsonSync(jsonFile, zhMap);
      rebuildZhVtt(videoId, zhMap);
      invalidateVideoCache(videoId);
      return { newZh, enFull };
    },
  );

  if (result.status === 'applied' && result.result) return result.result;
  if (result.status === 'pending') {
    throw new Error(`HITL_PENDING:${result.proposalId}`);
  }
  throw new Error(`重译失败: ${result.reason}`);
}

// ---------- 自动化：review + 顺序重译标红段 ----------
//
// 给新视频翻译流水线末尾 hook 用。AUTO_REVIEW_TRANSLATION=0 时跳过。
// 单段只重译一次（不递归），重译后**不**再 review，信任 DeepSeek。
// 整体 try/catch silent，不阻塞主翻译流程。

export interface AutoReviewResult {
  reviewed: number;        // 总段数
  problemFound: number;    // partial + wrong
  fixed: number;           // 成功重译
  failed: number;          // 重译失败
}

export async function autoReviewAndFix(videoId: string): Promise<AutoReviewResult> {
  if (process.env.AUTO_REVIEW_TRANSLATION === '0') {
    return { reviewed: 0, problemFound: 0, fixed: 0, failed: 0 };
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn(`[auto-review] ${videoId}: DEEPSEEK_API_KEY 未配置，跳过`);
    return { reviewed: 0, problemFound: 0, fixed: 0, failed: 0 };
  }

  console.log(`[auto-review] ${videoId}: 开始 AI 二审...`);
  let segments: SegmentReview[];
  try {
    const out = await reviewVideoTranslation(videoId);
    segments = out.segments;
  } catch (err) {
    console.warn(`[auto-review] ${videoId} review 失败:`, (err as Error).message);
    return { reviewed: 0, problemFound: 0, fixed: 0, failed: 0 };
  }

  const problems = segments.filter(s => s.verdict !== 'pass');
  console.log(`[auto-review] ${videoId}: ${segments.length} 段，${problems.length} 段需要修`);

  let fixed = 0;
  let failed = 0;
  for (const seg of problems) {
    try {
      await retranslateSegment(videoId, seg.key);
      fixed++;
    } catch (err) {
      failed++;
      console.warn(`[auto-review] ${videoId} 段 ${seg.key} 重译失败:`, (err as Error).message);
    }
  }

  // 同步更新 review 缓存：把 fixed 的段标 verdict=pass
  try {
    const cacheFile = reviewCachePath(videoId);
    if (fs.existsSync(cacheFile)) {
      const cache: ReviewCacheFile = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const fixedKeys = new Set(problems.slice(0, fixed).map(s => s.key));
      cache.segments = cache.segments.map(s =>
        fixedKeys.has(s.key) ? { ...s, verdict: 'pass' as TranslationVerdict, reason: '已自动重译', missing_info: undefined } : s,
      );
      cache.stats = {
        pass: cache.segments.filter(s => s.verdict === 'pass').length,
        partial: cache.segments.filter(s => s.verdict === 'partial').length,
        wrong: cache.segments.filter(s => s.verdict === 'wrong').length,
      };
      atomicWriteJsonSync(cacheFile, cache);
    }
  } catch (err) {
    console.warn(`[auto-review] ${videoId} 缓存更新失败:`, (err as Error).message);
  }

  console.log(`[auto-review] ${videoId} 完成: reviewed=${segments.length} fixed=${fixed} failed=${failed}`);
  return { reviewed: segments.length, problemFound: problems.length, fixed, failed };
}
