// 字幕单词预热 + 词典覆盖率统计
//
// 在用户打开视频时（或后台任务）扫描字幕的去重词表，
// 把还没缓存到 vocab-db（owner='__system__'）的词批量送到 AI batch-lookup 翻译并写回，
// 这样后续用户点 tooltip / 生成 flashcard 时几乎都是命中本地缓存，
// 不再触发 MiniMax 实时请求。
//
// listVideoWords  / getWordsCoverage 是同步的，看板和实时统计可直接用。
// preheatVideoWords 是异步的，由 /api/vocab/preheat 后台触发。

import fs from 'fs';
import path from 'path';
import { parseVtt } from '@/lib/vtt-parser';
import { getWordByName, addWord } from '@/lib/vocab-db';
import { hasLocalDictEntry } from '@/lib/local-dict';
import { AI_MODELS } from '@/lib/ai-models';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const SYSTEM_OWNER = '__system__';
const PREHEAT_VIDEO_ID = '__preheat__';

export interface PreheatResult {
  videoId: string;
  total: number;
  cached: number;
  fetched: number;
  failed: number;
}

// 英语高频停用词（约 260 个），覆盖功能词 / 助动词 / 常用副词 / 数字英文 / 寒暄等。
// 这些词要么没必要查（the/a），要么 local-dict 已经收录，预热阶段过滤掉避免浪费 API 额度。
const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'mine', 'yours', 'hers', 'ours', 'theirs',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'yourselves', 'themselves',
  'this', 'that', 'these', 'those',
  'who', 'whom', 'whose', 'which', 'what',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having',
  'do', 'does', 'did', 'doing', 'done',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against',
  'between', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'from', 'up', 'down', 'over', 'under', 'again', 'further', 'then', 'once',
  'here', 'there', 'when', 'where', 'why', 'how',
  'as', 'but', 'or', 'and', 'if', 'while', 'because', 'so', 'although', 'though',
  'than', 'until', 'unless', 'whether', 'since',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
  'another', 'every', 'no', 'nor', 'not', 'only', 'own', 'same',
  'too', 'very', 'just', 'now', 'also', 'back', 'still', 'even', 'yet', 'already',
  'really', 'quite', 'rather', 'somewhat',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'hundred', 'thousand', 'million',
  'first', 'second', 'third', 'last', 'next',
  'today', 'yesterday', 'tomorrow', 'tonight',
  'yes', 'no', 'ok', 'okay', 'hi', 'hello', 'hey', 'bye', 'goodbye',
  'please', 'thanks', 'thank', 'welcome', 'sorry', 'oh', 'ah', 'um', 'uh', 'huh', 'wow',
  'like', 'well', 'right', 'sure', 'fine',
  'get', 'gets', 'got', 'gotten', 'getting',
  'go', 'goes', 'went', 'gone', 'going',
  'come', 'comes', 'came', 'coming',
  'say', 'says', 'said', 'saying',
  'see', 'sees', 'saw', 'seen', 'seeing',
  'make', 'makes', 'made', 'making',
  'know', 'knows', 'knew', 'known', 'knowing',
  'take', 'takes', 'took', 'taken', 'taking',
  'think', 'thinks', 'thought', 'thinking',
  'want', 'wants', 'wanted', 'wanting',
  'let', 'lets', 'letting',
  'put', 'puts', 'putting',
  'gonna', 'wanna', 'gotta', 'kinda', 'sorta', 'lemme', 'gimme', 'cuz', 'cause',
  'whoever', 'whatever', 'whenever', 'wherever', 'however',
  'everyone', 'everybody', 'everything', 'somewhere', 'someone', 'somebody', 'something',
  'anywhere', 'anyone', 'anybody', 'anything',
  'nowhere', 'noone', 'nobody', 'nothing',
  'into', 'onto', 'upon', 'within', 'without',
]);

function isAllDigits(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * 解析视频字幕，返回去重 + 过滤停用词后的英文词列表。
 * 同步，无副作用，可在 UI / 看板里直接调用。
 */
export function listVideoWords(videoId: string): string[] {
  if (!videoId) return [];
  const vttPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  if (!fs.existsSync(vttPath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(vttPath, 'utf-8');
  } catch {
    return [];
  }

  let subs;
  try {
    subs = parseVtt(raw);
  } catch {
    return [];
  }

  const text = subs.map(s => s.text).join(' ');
  const seen = new Set<string>();
  const result: string[] = [];

  const matches = text.match(/\b[a-zA-Z][a-zA-Z'-]*\b/g);
  if (!matches) return [];

  for (const raw of matches) {
    const w = raw.toLowerCase();
    if (w.length < 2) continue;
    if (isAllDigits(w)) continue;
    if (STOP_WORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    result.push(w);
  }

  return result;
}

/**
 * 查一个词在系统层（local-dict 或 owner='__system__' vocab-db）是否已缓存。
 */
function isWordCached(word: string): boolean {
  if (hasLocalDictEntry(word)) return true;
  const inDb = getWordByName(word, SYSTEM_OWNER);
  return !!(inDb && inDb.definition);
}

/**
 * 同步：返回某视频的词典覆盖率，给看板用。
 * total = 字幕去重词数；cached = 已在 local-dict 或 system vocab-db 里的；
 * coverage = cached / total。total=0 时 coverage 视为 1（视为"已完整覆盖"）。
 */
export function getWordsCoverage(videoId: string): { total: number; cached: number; coverage: number } {
  const words = listVideoWords(videoId);
  const total = words.length;
  if (total === 0) return { total: 0, cached: 0, coverage: 1 };
  let cached = 0;
  for (const w of words) {
    if (isWordCached(w)) cached++;
  }
  return { total, cached, coverage: cached / total };
}

interface AiEntry {
  phonetic?: string;
  definition: string;
  pos?: string;
}

/**
 * 直接调 MiniMax 翻译一批单词。复用 batch-lookup 里的 prompt 设计但限批 200。
 */
async function aiTranslateBatch(words: string[]): Promise<Record<string, AiEntry>> {
  if (words.length === 0) return {};
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    console.warn('[preheat] MINIMAX_API_KEY not configured');
    return {};
  }

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

  const BATCH_SIZE = 30;
  const out: Record<string, AiEntry> = {};

  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    const slice = words.slice(i, i + BATCH_SIZE);
    const userMsg = slice.map((w, idx) => `${idx + 1}. ${w}`).join('\n');
    try {
      const resp = await fetch(AI_MODELS.minimax_chat.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: AI_MODELS.minimax_chat.id,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
        }),
      });
      if (!resp.ok) {
        console.error(`[preheat] AI batch error ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) continue;
      const parsed = JSON.parse(m[0]);
      if (parsed?.words && Array.isArray(parsed.words)) {
        for (const w of parsed.words) {
          const key = (w.word || '').toLowerCase().trim();
          if (key && w.definition) {
            out[key] = {
              phonetic: w.phonetic || undefined,
              definition: String(w.definition),
              pos: w.pos || undefined,
            };
          }
        }
      }
    } catch (e) {
      console.error('[preheat] AI batch failed:', (e as Error).message);
    }
  }

  return out;
}

/**
 * 预热某视频：解析字幕 → 找出未缓存的词 → 批量翻译 → 写回 vocab-db (owner=__system__)。
 * 异步，可能耗时几十秒到几分钟。失败的词不写入，仅记到 failed 计数。
 */
export async function preheatVideoWords(videoId: string): Promise<PreheatResult> {
  const words = listVideoWords(videoId);
  const total = words.length;
  let cachedCount = 0;
  const needsFetch: string[] = [];

  for (const w of words) {
    if (isWordCached(w)) {
      cachedCount++;
    } else {
      needsFetch.push(w);
    }
  }

  if (needsFetch.length === 0) {
    return { videoId, total, cached: cachedCount, fetched: 0, failed: 0 };
  }

  // 限批 200/请求，并发 1，避免压垮上游
  let fetched = 0;
  let failed = 0;
  const CHUNK = 200;
  for (let i = 0; i < needsFetch.length; i += CHUNK) {
    const chunk = needsFetch.slice(i, i + CHUNK);
    const ai = await aiTranslateBatch(chunk);
    for (const w of chunk) {
      const entry = ai[w];
      if (!entry || !entry.definition) {
        failed++;
        continue;
      }
      try {
        addWord({
          word: w,
          phonetic: entry.phonetic || '',
          definition: entry.definition,
          example: '',
          context: '预热缓存',
          videoId: PREHEAT_VIDEO_ID,
          videoTitle: '',
          timestamp: 0,
          category: entry.pos || '',
          owner: SYSTEM_OWNER,
        });
        fetched++;
      } catch (e) {
        console.warn('[preheat] addWord failed for', w, (e as Error).message);
        failed++;
      }
    }
  }

  return { videoId, total, cached: cachedCount, fetched, failed };
}
