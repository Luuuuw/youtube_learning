// 用 MiniMax 重新生成句型闪卡（新格式：中文 + 部分英文）
// 用法: node scripts/regen-sentence-minimax.mjs [videoId] [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const dryRun = process.argv.includes('--dry-run');
const targetVideo = process.argv.slice(2).find(a => !a.startsWith('--')) || null;

// ---------- env ----------
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const MINIMAX_KEY = process.env.MINIMAX_API_KEY;
if (!MINIMAX_KEY) {
  console.error('MINIMAX_API_KEY 缺失');
  process.exit(1);
}

// ---------- helpers ----------
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

function findCueContaining(subs, word) {
  const lower = word.toLowerCase();
  for (const s of subs) {
    if (s.text.toLowerCase().includes(lower)) return s;
  }
  return null;
}

// ---------- Proxy support ----------
let _proxyAgent = undefined;
function getProxyAgent() {
  if (_proxyAgent !== undefined) return _proxyAgent;
  const proxyPath = path.join(PROJECT_ROOT, 'proxy_config.json');
  if (fs.existsSync(proxyPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(proxyPath, 'utf-8'));
      if (cfg.proxy) {
        _proxyAgent = new ProxyAgent(cfg.proxy);
        console.log(`[minimax] 代理: ${cfg.proxy}`);
        return _proxyAgent;
      }
    } catch {}
  }
  _proxyAgent = null;
  return null;
}

// ---------- MiniMax call ----------
async function callMiniMax(sys, user, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const fetchOptions = {
      method: 'POST',
      headers: { Authorization: `Bearer ${MINIMAX_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M3',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
      }),
      signal: ctrl.signal,
    };

    const agent = getProxyAgent();
    if (agent) fetchOptions.dispatcher = agent;

    const res = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', fetchOptions);
    if (!res.ok) {
      const status = res.status;
      if ((status === 429 || status === 529) && attempt < 3) {
        const wait = status === 429 ? 30 : 10;
        console.log(`  MiniMax ${status}，${wait}s 后重试 (${attempt}/3)...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        return callMiniMax(sys, user, attempt + 1);
      }
      throw new Error(`MiniMax HTTP ${status}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '{}';
    // MiniMax may wrap JSON in ```json blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return JSON.parse(jsonMatch ? jsonMatch[1].trim() : text);
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Prompt ----------
function buildPrompt(enFull, zhFull) {
  return {
    sys: `你是英语句型闪卡生成助手。从字幕里找 5-8 个高频英语句型实例（如 would rather X than Y / so X that Y / used to / be supposed to / had better / if only / not only ... but also 等）。

要求：
- zh_sentence: 该句的中文翻译（从参考译文找，找不到就自己翻）
- front_cloze: 英文句子，仅把句型核心词替换成 ___（三个下划线），其他部分保留原样
- correct_fills: 按 cloze 顺序填回去的单词数组
- pattern: 句型名称（如 "would rather X than Y"）
- context_sentence: 完整原句
- context_start / context_end: 估算时间戳（从字幕中找）

只输出严格的 JSON：
{"cards":[{"pattern":"would rather X than Y","zh_sentence":"我宁愿随便吃点也不去高档餐厅。","front_cloze":"I'd ___ grab a quick bite ___ go to a fancy restaurant","correct_fills":["rather","than"],"context_sentence":"I'd rather grab a quick bite than go to a fancy restaurant","context_start":7.56,"context_end":12}]}`,
    user: `英文字幕（带时间戳）：\n${enFull}\n\n中文翻译参考：\n${zhFull}\n\n请挑 5-8 个高频实用句型实例。`,
  };
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sentenceToCard(s, videoId, subs) {
  if (!s?.front_cloze || !Array.isArray(s?.correct_fills) || s.correct_fills.length === 0) return null;
  let start = typeof s.context_start === 'number' ? s.context_start : undefined;
  let end = typeof s.context_end === 'number' ? s.context_end : undefined;
  if ((start === undefined || end === undefined || start >= end) && s.context_sentence) {
    const cue = findCueContaining(subs, s.correct_fills[0]);
    if (cue) { start = cue.startTime; end = cue.endTime; }
  }
  const zhPrefix = s.zh_sentence ? `${s.zh_sentence}\n` : '';
  return {
    id: generateId(),
    videoId,
    dimension: 'sentence',
    type: 'cloze',
    front: `${zhPrefix}${s.front_cloze}`,
    back: s.correct_fills.join(' ... '),
    context: s.context_sentence || '',
    audioStart: start,
    audioEnd: end,
    hint: s.pattern || undefined,
    tags: ['pattern'],
    owner: '__shared__',
    source: 'ai',
    reviewedByAdmin: false,
    createdAt: new Date().toISOString(),
  };
}

// ---------- Main ----------
async function regenOne(videoId) {
  const baseDir = path.join(CONTENT_DIR, videoId);
  const vttPath = path.join(baseDir, 'video.en.vtt');
  const zhPath = path.join(baseDir, 'video.zh-Hans.json');

  if (!fs.existsSync(vttPath)) throw new Error('video.en.vtt 缺失');
  const subs = parseVtt(fs.readFileSync(vttPath, 'utf-8'));
  if (subs.length === 0) throw new Error('字幕为空');

  let zhMap = {};
  if (fs.existsSync(zhPath)) {
    try { zhMap = JSON.parse(fs.readFileSync(zhPath, 'utf-8')); } catch {}
  }
  const zhLookup = buildZhLookup(zhMap);

  const enFull = subs.map(s => `[${s.startTime.toFixed(2)}-${s.endTime.toFixed(2)}] ${s.text}`).join('\n');
  const zhFull = subs.map(s => zhLookup(s.startTime)).filter(Boolean).join(' / ');

  const { sys, user } = buildPrompt(enFull, zhFull);
  const raw = await callMiniMax(sys, user);
  const list = (Array.isArray(raw?.cards) ? raw.cards : []).slice(0, 8);
  const cards = list.map(s => sentenceToCard(s, videoId, subs)).filter(Boolean);

  if (dryRun) {
    console.log(`\n=== ${videoId} [DRY RUN] ${cards.length} 张 ===`);
    for (const c of cards) {
      console.log(`\nfront: ${c.front.replace(/\n/g, '\\n')}`);
      console.log(`back: ${c.back}`);
      console.log(`hint: ${c.hint}`);
      console.log(`ctx: ${c.context}`);
    }
    return cards;
  }

  // Replace old sentence cards for this video in DB
  const dbFile = path.join(DATA_DIR, 'flashcards.json');
  const existing = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  const filtered = existing.filter(c => !(c.dimension === 'sentence' && c.videoId === videoId));
  const added = cards.length;
  filtered.push(...cards);
  fs.writeFileSync(dbFile, JSON.stringify(filtered, null, 2), 'utf-8');

  console.log(`  ${videoId}: 删除旧卡，入库 ${added} 张新句型卡`);
  return cards;
}

async function main() {
  if (targetVideo) {
    console.log(`测试: ${targetVideo}\n`);
    await regenOne(targetVideo);
    return;
  }

  // 全部视频
  const todos = [];
  for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const vtt = path.join(CONTENT_DIR, entry.name, 'video.en.vtt');
    const zh = path.join(CONTENT_DIR, entry.name, 'video.zh-Hans.json');
    if (fs.existsSync(vtt) && fs.existsSync(zh)) {
      todos.push(entry.name);
    }
  }

  console.log(`待生成: ${todos.length} 个视频\n`);

  let done = 0;
  for (const videoId of todos) {
    console.log(`[${++done}/${todos.length}] ${videoId} ...`);
    try {
      await regenOne(videoId);
    } catch (e) {
      console.log(`  FAIL: ${e.message}`);
    }
    if (done < todos.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\nDONE');
}

main().catch(e => { console.error(e); process.exit(1); });
