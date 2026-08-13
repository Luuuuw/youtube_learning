// Whisper 标点 + 大小写恢复
// Whisper（尤其 Groq 长音频）输出的 text 常缺失标点、全小写、句子边界丢失。
// 用 DeepSeek 做标点恢复，但严格保持词序不变，便于后续对齐到词级时间戳。

import { AI_MODELS } from '@/lib/ai-models';

const API_URL = AI_MODELS.deepseek_chat.endpoint;
const MODEL = AI_MODELS.deepseek_chat.id;
const API_TIMEOUT_MS = 180_000;

const SYSTEM_PROMPT = `你是英语字幕标点恢复专家。给定一段缺少标点、可能全小写的英语转录文本，恢复正确的标点和大小写。

【严格规则 — 必须逐条遵守】
1. 只做两件事：添加标点（句号 . 逗号 , 问号 ? 感叹号 ! 冒号 : 分号 ;）和调整字母大小写。
2. 绝对禁止：增删任何单词、改变单词顺序、改写/替换单词、合并或拆分单词、纠正拼写。
3. 每个单词的字母必须与原文完全一致，只允许调整大小写（如 tom → Tom、i'm → I'm）。
4. 句首字母大写；专有名词（人名/地名/品牌/作品名）首字母大写。
5. 根据语义在从句、插入语、列举处加逗号；疑问句加问号，感叹句加感叹号。
6. 保留原文的填充词（uh/um/you know 等）和重复词，不要删除或合并。

【输出】直接输出恢复标点后的完整文本，不要任何解释、不要 markdown 围栏、不要前后注释。`;

async function callDeepSeekText(
  userInput: string,
  apiKey: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userInput },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

// 在空格处切块，尽量不拆词，每块约 maxChars 字符
function chunkText(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);
    if (end < trimmed.length) {
      // 回退到最近的空格，避免拆词
      const spaceIdx = trimmed.lastIndexOf(' ', end);
      if (spaceIdx > start) end = spaceIdx;
    }
    chunks.push(trimmed.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

/**
 * 对标点缺失的转录文本做标点 + 大小写恢复。
 * 返回恢复后的完整文本（词序与原文严格一致，仅多了标点和大小写变化）。
 * 无 DEEPSEEK_API_KEY 时原样返回（不阻塞转录主流程）。
 */
export async function restorePunctuation(
  text: string,
  apiKey: string | undefined,
): Promise<string> {
  if (!apiKey || !text || !text.trim()) return text;

  const chunks = chunkText(text, 4000);
  const restored: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    try {
      const out = await callDeepSeekText(chunks[i], apiKey);
      restored.push(out || chunks[i]);
    } catch (err) {
      console.error(`[punctuate] chunk ${i + 1}/${chunks.length} 失败，回退原文:`, (err as Error).message);
      restored.push(chunks[i]);
    }
  }

  return restored.join(' ').trim();
}
