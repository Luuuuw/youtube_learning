// 批量生成闪卡：直接调 DeepSeek API（不依赖 Next.js 服务器）
// 用法: node scripts/batch-generate-flashcards.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const dryRun = process.argv.includes('--dry-run');

// ---------- env ----------
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_KEY) {
  console.error('DEEPSEEK_API_KEY 缺失');
  process.exit(1);
}

// ---------- helpers ----------
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
}

// Minimal VTT parser: returns [{startTime, endTime, text}]
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
        // Skip VTT tags like <c> <00:00:00.000>
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

// Chinese lookup: key="start-end" -> text
function buildZhLookup(zhMap) {
  const buckets = [];
  for (const key of Object.keys(zhMap)) {
    const m = key.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (!m) continue;
    buckets.push({ start: parseFloat(m[1]), end: parseFloat(m[2]), text: zhMap[key] });
  }
  buckets.sort((a, b) => a.start - b.start);
  return (startTime) => {
    for (const b of buckets) {
      if (startTime >= b.start && startTime < b.end) return b.text;
    }
    let best = null, bestDist = Infinity;
    for (const b of buckets) {
      const d = Math.min(Math.abs(b.start - startTime), Math.abs(b.end - startTime));
      if (d < bestDist) { bestDist = d; best = b; }
    }
    return best?.text || '';
  };
}

function highlightWord(sentence, word) {
  if (!sentence || !word) return sentence;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRe = new RegExp(`\\b(${escaped})\\b`, 'i');
  if (wordRe.test(sentence)) return sentence.replace(wordRe, '**$1**');
  const stem = escaped.slice(0, Math.max(4, Math.floor(escaped.length * 0.7)));
  const stemRe = new RegExp(`\\b(${stem}\\w*)\\b`, 'i');
  if (stemRe.test(sentence)) return sentence.replace(stemRe, '**$1**');
  return sentence;
}

function findCueContaining(subs, word) {
  const lower = word.toLowerCase();
  for (const s of subs) {
    if (s.text.toLowerCase().includes(lower)) return s;
  }
  return null;
}

const FILLER_WORDS = new Set(['to', 'be', 'in', 'at', 'on', 'of', 'by', 'a', 'an', 'the', 'it', 'is', 'are', 'was', 'were', 'for', 'or', 'and', 'but', 'not', 'no']);

function applyFills(sentence, fills) {
  let front = sentence;
  const matched = [];
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

function makeSentenceCloze(sentence, pattern) {
  const words = pattern.split(/\s+/).filter(Boolean);
  let front = sentence;
  const fills = [];
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(front)) {
      front = front.replace(re, '___');
      fills.push(w);
    }
  }
  return { front_cloze: front, fills };
}

// 从字幕里找包含某段文本的 cue
function findCueForSentence(subs, sentence) {
  if (!sentence) return null;
  const normalized = sentence.toLowerCase().trim();
  for (const n of [6, 5, 4]) {
    const prefix = normalized.split(/\s+/).slice(0, n).join(' ');
    if (prefix.length < 10) continue;
    for (const s of subs) {
      if (s.text.toLowerCase().includes(prefix)) return s;
    }
  }
  return null;
}

function findChineseForSentence(subs, sentence, zhLookup) {
  const cue = findCueForSentence(subs, sentence);
  if (!cue) return '';
  const idx = subs.indexOf(cue);
  const texts = [];
  if (idx > 0) {
    const t = zhLookup(subs[idx - 1].startTime);
    if (t) texts.push(t);
  }
  const t = zhLookup(cue.startTime);
  if (t) texts.push(t);
  return texts.join(' ');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- DeepSeek call ----------
async function callDS(sys, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${DEEPSEEK_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
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
    return JSON.parse(data.choices?.[0]?.message?.content || '{}');
  } finally {
    clearTimeout(timer);
  }
}

function asArray(raw, key = 'cards') {
  if (!raw || typeof raw !== 'object') return [];
  const v = raw[key];
  return Array.isArray(v) ? v : [];
}

// ---------- Prompts ----------
function buildVocabPrompt(enFull, zhFull) {
  return {
    sys: `你是英语学习闪卡生成助手。从字幕中抽取 CEFR B1-C1 难度的生词（最多 12 个），排除 A1-A2 常见词（the/is/have/go 等）、专有名词、纯介词/连词。每个词给出词性、CEFR 等级、中文释义、原句、原句起止时间。

只输出严格的 JSON：
{"cards":[{"word":"procrastinate","pos":"verb","cefr":"B2","definition_zh":"拖延","context_sentence":"...","context_start":45.3,"context_end":48.1}]}`,
    user: `英文字幕全文：\n${enFull}\n\n中文翻译参考：\n${zhFull}\n\n请抽取 8-12 个 CEFR B1-C1 的实用生词，按重要性排序。`,
  };
}

function buildListeningPrompt(items) {
  return {
    sys: `你是英语听力填空闪卡生成助手。给定若干英文句子，从每句挑 1 个关键内容词（名词/动词/形容词/副词）挖空，生成填空题。要求：
- correct 是从原句精确摘取的单词（保持原形态、大小写）
- 给 3 个干扰项（distractors），同词性、有迷惑性、但放回原句不通顺
- front_with_blank 是把 correct 替换为 ___（三个下划线）后的整句

只输出严格的 JSON：
{"cards":[{"id":1,"front_with_blank":"I'd rather grab a quick bite than go to a ___ restaurant","correct":"fancy","distractors":["expensive","big","new"]}]}`,
    user: `句子列表：\n${items.map(it => `[${it.id}] ${it.sentence}`).join('\n')}\n\n每一条都要生成一张填空卡（id 必须对应输入的 id）。`,
  };
}

function buildSentencePrompt(enFull, zhFull) {
  return {
    sys: `你是英语句型分析助手。从字幕中找**真正有价值的语法句型**做成填空卡。

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
context_sentence 必须从上方英文字幕原文逐字复制，禁止自行编造。`,
    user: `英文字幕（带时间戳）：\n${enFull}\n\n中文翻译参考：\n${zhFull}\n\n挑出真正有教学价值的语法句型，没把握的宁可跳过。fills 只放语法结构词。`,
  };
}

// ---------- Converters ----------
function vocabToCard(v, videoId, subs) {
  if (!v?.word || !v?.definition_zh) return null;
  let start = typeof v.context_start === 'number' ? v.context_start : undefined;
  let end = typeof v.context_end === 'number' ? v.context_end : undefined;
  let ctx = v.context_sentence || '';
  if (start === undefined || end === undefined || start >= end) {
    const cue = findCueContaining(subs, v.word);
    if (cue) { start = cue.startTime; end = cue.endTime; if (!ctx) ctx = cue.text; }
  }
  return {
    id: generateId(),
    videoId,
    dimension: 'vocab',
    type: 'recognition',
    front: v.word,
    back: `${v.definition_zh} (${v.pos || '?'}, ${v.cefr || 'B1'})`,
    context: highlightWord(ctx, v.word),
    audioStart: start,
    audioEnd: end,
    word: v.word.toLowerCase(),
    tags: [`CEFR-${v.cefr || 'B1'}`, v.pos || ''].filter(Boolean),
    owner: '__shared__',
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

function listeningToCard(l, videoId, src) {
  if (!l?.front_with_blank || !l?.correct) return null;
  if (!l.front_with_blank.includes('___')) return null; // AI 没挖空，丢弃
  const choices = [l.correct, ...(l.distractors || [])].filter(Boolean);
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
    hint: `选项：${shuffle(choices).join(' / ')}`,
    tags: ['fill-in-blank'],
    owner: '__shared__',
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

function sentenceToCard(s, videoId, subs, zhLookup) {
  if (!s?.context_sentence) return null;

  // 使用 AI 指定的 fills（新格式）或从 pattern 推导（兼容旧格式）
  let fills;
  if (s.fills && Array.isArray(s.fills) && s.fills.length >= 2) {
    fills = s.fills.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
    if (fills.length !== s.fills.length) return null;
  } else if (s.pattern) {
    const words = s.pattern.split(/\s+/).filter(Boolean);
    fills = words.filter(w => !FILLER_WORDS.has(w.toLowerCase()));
    if (fills.length < 2) return null;
  } else {
    return null;
  }

  if (fills.length < 2 || fills.length > 5) return null;

  // 用 fills 在句子里精确挖空
  const { front_cloze, matched } = applyFills(s.context_sentence, fills);
  if (matched.length < 2) return null;

  // 用文本匹配找字幕 cue → 时间戳。找不到则说明 AI 编造的句子，丢弃。
  const cue = findCueForSentence(subs, s.context_sentence);
  if (!cue) return null;
  const start = cue.startTime;
  const end = cue.endTime;

  // 中文：优先精确匹配，失败用 AI 时间戳兜底
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
    owner: '__shared__',
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Import to DB ----------
function importToDb(cards) {
  const dbFile = path.join(DATA_DIR, 'flashcards.json');
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, '[]', 'utf-8');

  const existing = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  const existingKeys = new Set();
  for (const c of existing) {
    if (c.dimension === 'vocab' && c.word) existingKeys.add(`vocab::${c.videoId}::${c.word.toLowerCase()}`);
    existingKeys.add(`${c.type}::${c.videoId}::${c.front}`);
  }

  let added = 0;
  for (const c of cards) {
    const vocabKey = c.dimension === 'vocab' && c.word ? `vocab::${c.videoId}::${c.word.toLowerCase()}` : null;
    const genericKey = `${c.type}::${c.videoId}::${c.front}`;
    if ((vocabKey && existingKeys.has(vocabKey)) || existingKeys.has(genericKey)) continue;
    existing.push(c);
    if (vocabKey) existingKeys.add(vocabKey);
    existingKeys.add(genericKey);
    added++;
  }

  if (added > 0) {
    fs.writeFileSync(dbFile, JSON.stringify(existing, null, 2), 'utf-8');
  }
  return added;
}

// ---------- Main ----------
async function generateForVideo(videoId) {
  const baseDir = path.join(CONTENT_DIR, videoId);
  const vttPath = path.join(baseDir, 'video.en.vtt');
  const zhPath = path.join(baseDir, 'video.zh-Hans.json');
  const quizPath = path.join(baseDir, 'quiz-bank.json');

  if (!fs.existsSync(vttPath)) throw new Error('video.en.vtt 缺失');
  const vttRaw = fs.readFileSync(vttPath, 'utf-8');
  const subs = parseVtt(vttRaw);
  if (subs.length === 0) throw new Error('字幕为空');

  let zhMap = {};
  if (fs.existsSync(zhPath)) {
    try { zhMap = JSON.parse(fs.readFileSync(zhPath, 'utf-8')); } catch {}
  }
  const zhLookup = buildZhLookup(zhMap);

  let quizQuestions = [];
  if (fs.existsSync(quizPath)) {
    try {
      const qb = JSON.parse(fs.readFileSync(quizPath, 'utf-8'));
      quizQuestions = Array.isArray(qb.questions) ? qb.questions : [];
    } catch {}
  }

  const enFullText = subs.map(s => `[${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}] ${s.text}`).join('\n');
  const zhFullText = subs.map(s => zhLookup(s.startTime)).filter(Boolean).join(' / ');

  // Listening sources
  const listeningSources = quizQuestions
    .filter(q => typeof q.startTime === 'number' && typeof q.endTime === 'number'
      && q.endTime - q.startTime >= 3 && q.endTime - q.startTime <= 8)
    .slice(0, 8)
    .map(q => {
      const within = subs.filter(s =>
        s.startTime >= q.startTime - 0.5 && s.endTime <= q.endTime + 0.5);
      const sentence = within.length > 0
        ? within.map(s => s.text).join(' ')
        : (subs.find(s => s.startTime >= q.startTime - 0.5 && s.startTime <= q.endTime + 0.5)?.text || '');
      return { id: q.id, sentence, startTime: q.startTime, endTime: q.endTime };
    })
    .filter(it => it.sentence && it.sentence.split(/\s+/).length >= 4);

  // Three parallel batches
  const vocabPromise = (async () => {
    const { sys, user } = buildVocabPrompt(enFullText, zhFullText);
    const raw = await callDS(sys, user);
    return asArray(raw).slice(0, 12).map(v => vocabToCard(v, videoId, subs)).filter(Boolean);
  })();

  const listeningPromise = (async () => {
    if (listeningSources.length === 0) return [];
    const { sys, user } = buildListeningPrompt(listeningSources.map(s => ({ id: s.id, sentence: s.sentence })));
    const raw = await callDS(sys, user);
    const list = asArray(raw);
    const byId = new Map(listeningSources.map(s => [s.id, s]));
    return list.map(l => listeningToCard(l, videoId, byId.get(l.id))).filter(Boolean);
  })();

  const sentencePromise = (async () => {
    const { sys, user } = buildSentencePrompt(enFullText, zhFullText);
    const raw = await callDS(sys, user);
    return asArray(raw).slice(0, 8).map(s => sentenceToCard(s, videoId, subs, zhLookup)).filter(Boolean);
  })();

  const results = await Promise.allSettled([vocabPromise, listeningPromise, sentencePromise]);
  const labels = ['vocab', 'listening', 'sentence'];
  const buckets = [[], [], []];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') buckets[i] = r.value;
    else console.warn(`  ${labels[i]} 失败:`, r.reason?.message || r.reason);
  });

  const allCards = [...buckets[0], ...buckets[1], ...buckets[2]];
  const stats = { vocab: buckets[0].length, listening: buckets[1].length, sentence: buckets[2].length };

  // Write draft
  if (!dryRun) {
    const outPath = path.join(baseDir, 'flashcards.json');
    fs.writeFileSync(outPath, JSON.stringify({
      videoId,
      generatedAt: new Date().toISOString(),
      cards: allCards,
    }, null, 2), 'utf-8');

    // Import to main DB
    if (allCards.length > 0) {
      const imported = importToDb(allCards);
      return { cards: allCards, stats, imported };
    }
  }

  return { cards: allCards, stats, imported: 0 };
}

async function main() {
  const missing = [];
  for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fp = path.join(CONTENT_DIR, entry.name, 'flashcards.json');
    const vp = path.join(CONTENT_DIR, entry.name, 'video.en.vtt');
    if (!fs.existsSync(fp) && fs.existsSync(vp) && entry.name !== 'test-video') {
      missing.push(entry.name);
    }
  }

  if (missing.length === 0) {
    console.log('所有视频都已有闪卡草稿');
    return;
  }

  console.log(`待生成: ${missing.length} 个视频\n`);

  let done = 0;
  for (const videoId of missing) {
    console.log(`[${++done}/${missing.length}] ${videoId} ...`);

    if (dryRun) {
      console.log(`  [DRY RUN]`);
      continue;
    }

    try {
      const { stats, imported } = await generateForVideo(videoId);
      console.log(`  OK (${stats.vocab + stats.listening + stats.sentence} 张, 入库 ${imported}) [${stats.vocab}v ${stats.listening}l ${stats.sentence}s]`);
    } catch (e) {
      console.log(`  FAIL: ${e instanceof Error ? e.message : e}`);
    }

    if (done < missing.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('\nDONE');
}

main().catch(e => { console.error(e); process.exit(1); });
