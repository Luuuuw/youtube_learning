import { NextRequest, NextResponse } from 'next/server';
import { getWordByName, addWord } from '@/lib/vocab-db';
import { getLocalDictEntry } from '@/lib/local-dict';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';

interface WordResult {
  phonetic?: string;
  definition: string;
  pos?: string;
  source: 'local' | 'vocab-db' | 'ai';
}

/**
 * Call AI to batch-translate words that are not found in any local source.
 * Returns a map of word -> parsed definition.
 */
async function aiBatchLookup(words: string[]): Promise<Record<string, { phonetic?: string; definition: string; pos?: string }>> {
  if (words.length === 0) return {};

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn('[batch-lookup] MINIMAX_API_KEY not configured, skipping AI lookup');
    return {};
  }

  const BATCH_SIZE = 30;
  const systemPrompt =
    '你是专业英汉词典。用户会给你一组英语单词编号列表。\n\n' +
    '【任务】为每个单词提供音标和中文释义。\n\n' +
    '【输出格式】严格JSON，不要任何其他内容：\n' +
    '{"words":[{"word":"原词","phonetic":"/xxx/","pos":"词性缩写","definition":"中文释义"}]}\n\n' +
    '【严格规则】\n' +
    '- 每个单词必须出现在输出中\n' +
    '- 释义只给1个最常用意思，不超过15字\n' +
    '- 词性用英文缩写：n./v./adj./adv./prep./conj./pron./int.\n' +
    '- 音标用国际音标格式\n' +
    '- 不要输出多余解释、例句、词源等\n' +
    '- 不要用markdown格式';

  const batches: string[][] = [];
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    batches.push(words.slice(i, i + BATCH_SIZE));
  }

  type AiEntry = { phonetic?: string; definition: string; pos?: string };

  const runBatch = async (batch: string[]): Promise<Record<string, AiEntry>> => {
    const wordList = batch.map((w, idx) => `${idx + 1}. ${w}`).join('\n');
    const out: Record<string, AiEntry> = {};
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
            { role: 'system', content: systemPrompt },
            { role: 'user', content: wordList },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`[batch-lookup] AI API error: ${response.status}`);
        return out;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[batch-lookup] AI response is not valid JSON:', content.slice(0, 200));
        return out;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.words && Array.isArray(parsed.words)) {
        for (const w of parsed.words) {
          const key = (w.word || '').toLowerCase().trim();
          if (key && w.definition) {
            out[key] = {
              phonetic: w.phonetic || undefined,
              definition: w.definition,
              pos: w.pos || undefined,
            };
          }
        }
      }
    } catch (e) {
      console.error('[batch-lookup] AI batch lookup failed:', e);
    }
    return out;
  };

  const batchResults = await Promise.all(batches.map(runBatch));
  const results: Record<string, AiEntry> = {};
  for (const r of batchResults) {
    Object.assign(results, r);
  }
  return results;
}

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  try {
    const body = await req.json();
    const { words } = body as { words: string[] };

    if (!Array.isArray(words) || words.length === 0) {
      return NextResponse.json({ error: '缺少 words 参数' }, { status: 400 });
    }

    // Limit batch size
    const batch = words.slice(0, 200);

    const results: Record<string, WordResult | null> = {};
    const needAiLookup: string[] = [];

    for (const rawWord of batch) {
      const word = rawWord.toLowerCase().replace(/[.,!?;:'"()\[\]{}]/g, '').trim();
      if (!word || word.length < 2) continue;

      // 1. Check local-dict first
      const localEntry = getLocalDictEntry(word);
      if (localEntry) {
        results[word] = {
          phonetic: localEntry.phonetic,
          definition: localEntry.definition,
          pos: localEntry.definition.match(/^(v\.|n\.|adj\.|adv\.|prep\.|pron\.|conj\.|det\.|num\.|int\.|art\.)/)?.[1]?.replace('.', ''),
          source: 'local',
        };
        continue;
      }

      // 2. Check vocab-db (user's vocab book)
      const vocabEntry = getWordByName(word);
      if (vocabEntry && vocabEntry.definition) {
        results[word] = {
          phonetic: vocabEntry.phonetic || undefined,
          definition: vocabEntry.definition,
          pos: vocabEntry.category || undefined,
          source: 'vocab-db',
        };
        continue;
      }

      // 3. Need AI lookup
      needAiLookup.push(word);
    }

    // 4. AI batch lookup for remaining words
    if (needAiLookup.length > 0) {
      const aiResults = await aiBatchLookup(needAiLookup);

      for (const word of needAiLookup) {
        const aiEntry = aiResults[word];
        if (aiEntry) {
          results[word] = {
            ...aiEntry,
            source: 'ai',
          };

          // Save to vocab-db for cross-video reuse
          try {
            addWord({
              word,
              phonetic: aiEntry.phonetic || '',
              definition: aiEntry.definition,
              example: '',
              context: 'auto-lookup',
              videoId: '',
              videoTitle: '',
              timestamp: Date.now(),
              owner: 'system',
              category: aiEntry.pos || '',
            });
          } catch {
            // Word might already exist, ignore
          }
        } else {
          results[word] = null;
        }
      }
    }

    return NextResponse.json({ results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
