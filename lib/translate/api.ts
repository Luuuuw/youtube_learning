import { AI_MODELS } from '@/lib/ai-models';
import type { SubtitleItem } from './utils';

const API_TIMEOUT_MS = 120_000;
const MAX_BATCH_RETRIES = 3;

export async function callMiniMax(messages: { role: string; content: string }[], apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(AI_MODELS.minimax_chat.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: AI_MODELS.minimax_chat.id, messages }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`MiniMax API 错误: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

export function parseTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();

  const cleanedContent = content
    .replace(/```(?:json)?\s*[\s\S]*?```/gi, '')
    .replace(/^\s*[\r\n]+/gm, '');

  const lines = cleanedContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const doubleBracketMatch = trimmed.match(/^\[\[ID:(\d+)\]\]\s*(.+)$/);
    if (doubleBracketMatch) {
      const id = parseInt(doubleBracketMatch[1], 10);
      const text = doubleBracketMatch[2].trim();
      if (!isNaN(id) && text) {
        result.set(id, text);
      }
      continue;
    }

    const singleBracketMatch = trimmed.match(/^\[(\d+)\]\s*(.+)$/);
    if (singleBracketMatch) {
      const id = parseInt(singleBracketMatch[1], 10);
      const text = singleBracketMatch[2].trim();
      if (!isNaN(id) && text) {
        result.set(id, text);
      }
    }
  }

  return result;
}

export function parseJsonTranslationResponse(content: string): Map<number, string> {
  const result = new Map<number, string>();

  const blockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = (blockMatch?.[1] || content).trim();
  if (!jsonCandidate) return result;

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (!Array.isArray(parsed)) return result;

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const id = Number((item as { id?: unknown }).id);
      const zh = String((item as { zh?: unknown }).zh || '').trim();
      if (!Number.isNaN(id) && zh) {
        result.set(id, zh);
      }
    }
  } catch {
    return result;
  }

  return result;
}

export async function requestBatchTranslation(
  subtitles: SubtitleItem[],
  apiKey: string,
  mode: 'translate' | 'review'
): Promise<Map<number, string>> {
  // 优先用 JSON 数组格式（比 [[ID:N]] 文本稳定得多），fallback 回旧的文本格式
  const items = subtitles.map((s) => ({ id: s.id, text: s.text }));

  const systemPrompt =
    mode === 'translate'
      ? `你是专业视频字幕翻译，把每条英文翻译成自然口语化中文。

【输出格式】严格 JSON 数组，每项格式 { "id": 数字, "zh": "中文" }。
【必须】
- 必须返回输入的全部 ${items.length} 条，按 id 一一对应
- 每条独立翻译，但要参考上下文理解语义
- 中文 15-25 字以内，按中文语序，不要逐词直译
- 专有名词（人名/地名/品牌如 Sally, Copenhagen, YouTube）保留英文原样
- 忽略 "uhm/uh/um/you know" 等填充词
- 只输出 JSON 数组，不要任何解释、markdown、代码块`
      : `你是专业字幕审校专家，修正机器翻译质量。

【输出格式】严格 JSON 数组，每项 { "id": 数字, "zh": "修正后的中文" }。
【必须】
- 必须返回输入的全部 ${items.length} 条
- 修正语序、误译、漏译、生硬直译
- 保留专有名词的英文原样
- 只输出 JSON 数组，无任何解释`;

  const userPrompt = JSON.stringify(items);

  const content = await callMiniMax(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    apiKey
  );

  // 先尝试 JSON 解析（新格式），失败回退到 [[ID:N]] 文本解析（兼容老 prompt 偶尔遗留）
  const jsonResult = parseJsonTranslationResponse(content);
  if (jsonResult.size > 0) return jsonResult;
  return parseTranslationResponse(content);
}

export async function translateBatch(
  subtitles: SubtitleItem[],
  apiKey: string
): Promise<Map<number, string>> {
  const translated = new Map<number, string>();

  // 1) 整批翻译，重试 MAX_BATCH_RETRIES 次直到全 / 收益边际
  for (let attempt = 0; attempt < MAX_BATCH_RETRIES; attempt++) {
    const missing = subtitles.filter((s) => !translated.has(s.id));
    if (missing.length === 0) return translated;
    try {
      const result = await requestBatchTranslation(missing, apiKey, 'translate');
      result.forEach((text, id) => {
        if (text) translated.set(id, text);
      });
      if (translated.size === subtitles.length) return translated;
    } catch (err) {
      console.error(`[translate] batch attempt ${attempt + 1} failed:`, (err as Error).message);
    }
  }

  // 2) 单条 fallback：批仍不全的最后兜底，保证每条都尝试过单独翻译
  const stillMissing = subtitles.filter((s) => !translated.has(s.id));
  if (stillMissing.length > 0) {
    console.warn(`[translate] falling back to per-item translation for ${stillMissing.length} cues`);
    for (const sub of stillMissing) {
      try {
        const single = await requestBatchTranslation([sub], apiKey, 'translate');
        const text = single.get(sub.id);
        if (text) translated.set(sub.id, text);
      } catch (err) {
        console.error(`[translate] per-item ${sub.id} failed:`, (err as Error).message);
      }
    }
  }

  return translated;
}
