// DeepSeek 审校 + 补译模块
// 分工：MiniMax 负责批量初翻；DeepSeek 在初翻后接管 review + 漏条补译。
// 单一对外入口 reviewAndFillGaps：输入英文条目 + MiniMax 初翻 Map，输出最终 Map。

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_MODEL = 'deepseek-chat';
const API_TIMEOUT_MS = 120_000;
const REVIEW_BATCH_SIZE = 20;
const MAX_BATCH_RETRIES = 3;
const MAX_CONCURRENT = 2;

interface ReviewItem {
  id: number;
  en: string;
  zh: string;
}

async function callDeepSeek(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

function parseReviewResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();
  if (!content) return result;

  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (blockMatch?.[1] || content).trim();
  if (!candidate) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const objMatch = candidate.match(/\{[\s\S]*\}/);
    const arrMatch = candidate.match(/\[[\s\S]*\]/);
    const fallback = objMatch?.[0] || arrMatch?.[0];
    if (!fallback) return result;
    try {
      parsed = JSON.parse(fallback);
    } catch {
      return result;
    }
  }

  let arr: unknown[] = [];
  if (Array.isArray(parsed)) {
    arr = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.items)) arr = obj.items;
    else if (Array.isArray(obj.results)) arr = obj.results;
    else if (Array.isArray(obj.data)) arr = obj.data;
  }

  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const id = Number((item as { id?: unknown }).id);
    const zh = String((item as { zh?: unknown }).zh ?? '').trim();
    if (!Number.isNaN(id) && zh) result.set(id, zh);
  }
  return result;
}

async function reviewBatchOnce(
  items: ReviewItem[],
  apiKey: string,
): Promise<Map<number, string>> {
  const systemPrompt = `你是专业字幕审校。任务：检查 MiniMax 初翻，对【缺失】或【质量明显差】的条目重译，对【已合格】的条目原样保留。

【输入】JSON 数组，每项 { "id": 数字, "en": "英文原文", "zh": "MiniMax 初翻（可能为空）" }
【输出】严格 JSON 对象 { "items": [{ "id": 数字, "zh": "最终中文" }] }，必须包含全部 ${items.length} 条。

【判定规则】
- zh 为空字符串 → 必须翻译
- zh 含未翻译的英文片段、明显误译、与 en 语义不符 → 重译
- zh 自然流畅且语义正确 → 原样返回（不要画蛇添足改写）

【翻译要求】
- 自然口语化中文，按中文语序，不要逐词直译
- 单条 15-25 字以内
- 专有名词（人名/地名/品牌如 Sally, Copenhagen, YouTube）保留英文原样
- 忽略 uh/um/uhm/you know 等填充词

输出必须是合法 JSON，禁止任何解释、markdown 围栏、前后注释。`;

  const userInput = JSON.stringify(items.map(it => ({ id: it.id, en: it.en, zh: it.zh })));
  const content = await callDeepSeek(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ],
    apiKey,
  );
  return parseReviewResponse(content);
}

async function runWithLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  const executing: Set<Promise<void>> = new Set();
  for (let i = 0; i < tasks.length; i++) {
    const idx = i;
    const p = tasks[idx]().then(r => { results[idx] = r; });
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

/**
 * 审校 + 补译。
 * 入参 enSubs 应已剔除非语音条目；miniMaxTranslations 是 MiniMax 初翻结果（可能不全）。
 * 返回 Map<id, 最终中文>，保证覆盖所有传入的 enSubs，除非 DeepSeek 多次都失败。
 */
export async function reviewAndFillGaps(
  enSubs: { id: number; text: string }[],
  miniMaxTranslations: Map<number, string>,
  apiKey: string,
): Promise<Map<number, string>> {
  const final = new Map<number, string>(miniMaxTranslations);
  if (!apiKey || enSubs.length === 0) return final;

  const items: ReviewItem[] = enSubs.map(s => ({
    id: s.id,
    en: s.text,
    zh: miniMaxTranslations.get(s.id) || '',
  }));

  const batches: ReviewItem[][] = [];
  for (let i = 0; i < items.length; i += REVIEW_BATCH_SIZE) {
    batches.push(items.slice(i, i + REVIEW_BATCH_SIZE));
  }

  const batchResults = await runWithLimit(
    batches.map(batch => async () => {
      const got = new Map<number, string>();
      for (let r = 0; r < MAX_BATCH_RETRIES; r++) {
        const missing = batch.filter(it => !got.has(it.id));
        if (missing.length === 0) break;
        try {
          const m = await reviewBatchOnce(missing, apiKey);
          m.forEach((v, k) => { if (v) got.set(k, v); });
          if (got.size === batch.length) break;
        } catch (err) {
          console.error(`[deepseek] batch attempt ${r + 1} failed:`, (err as Error).message);
        }
      }
      return { batch, got };
    }),
    MAX_CONCURRENT,
  );

  let revisedCount = 0;
  let filledCount = 0;
  let keptMiniMax = 0;
  let stillMissing = 0;

  for (const { batch, got } of batchResults) {
    for (const it of batch) {
      const ds = got.get(it.id);
      if (ds) {
        final.set(it.id, ds);
        if (!it.zh) filledCount++;
        else if (ds !== it.zh) revisedCount++;
      } else if (it.zh) {
        keptMiniMax++;
      } else {
        stillMissing++;
      }
    }
  }

  console.log(
    `[deepseek] review done: filled=${filledCount}, revised=${revisedCount}, kept-minimax-fallback=${keptMiniMax}, still-missing=${stillMissing}`,
  );

  return final;
}

export function hasDeepSeekKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}
