#!/usr/bin/env node
// 一次性脚本：补足翻译不完整视频的剩余部分
// 用法:
//   node scripts/fix-translation-gaps.mjs --dry-run
//   node scripts/fix-translation-gaps.mjs
//   node scripts/fix-translation-gaps.mjs 6C0orv4gc8E

import fs from 'fs';
import path from 'path';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';
const BATCH_SIZE = 8;
const MAX_BATCH_RETRIES = 5;
const RETRY_DELAY_BASE = 2000;
const MIN_COVERAGE_TO_WRITE = 0.90;

const isDryRun = process.argv.includes('--dry-run');
const argIds = process.argv.slice(2).filter(a => !a.startsWith('--'));

// load .env.local minimally
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const apiKey = process.env.MINIMAX_API_KEY;
if (!isDryRun && !apiKey) {
  console.error('MINIMAX_API_KEY missing in .env.local');
  process.exit(1);
}

function parseVttCues(text) {
  const cues = [];
  const lines = text.split(/\r?\n/);
  const pat = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pat);
    if (!m) continue;
    const s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    let txt = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) break;
      if (lines[j].match(pat)) break;
      txt += (txt ? '\n' : '') + lines[j];
    }
    cues.push({ start: s, end: e, text: txt });
  }
  return cues;
}

function cleanText(t) {
  return t
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonSpeech(t) {
  if (!t) return true;
  if (/^\[[^\]]+\]$/.test(t)) return true;
  if (/^\([^)]+\)$/.test(t)) return true;
  return false;
}

// roll-up 去重：相同跳过；当前以上一条为前缀则只取新增；否则保留
function dedupeRollup(cues) {
  const out = [];
  let prev = '';
  for (const c of cues) {
    const t = cleanText(c.text);
    if (!t) continue;
    if (t === prev) continue;
    if (prev && t.startsWith(prev + ' ')) {
      const added = t.slice(prev.length).trim();
      if (added) {
        out.push({ start: c.start, end: c.end, text: added });
        prev = t;
      }
      continue;
    }
    if (prev && prev.length > 30 && t.includes(prev.slice(-30))) {
      const idx = t.indexOf(prev.slice(-30));
      const added = t.slice(idx + 30).trim();
      if (added) {
        out.push({ start: c.start, end: c.end, text: added });
        prev = t;
      }
      continue;
    }
    out.push({ start: c.start, end: c.end, text: t });
    prev = t;
  }
  return out;
}

async function callMinimax(items, attempt) {
  const systemPrompt =
    '你是专业字幕翻译。把每条英文翻译成自然口语化中文。\n' +
    '【输出格式】严格 JSON 数组，每项 { "id": 数字, "zh": "中文" }。\n' +
    '【要求】\n' +
    '- 每条对应一个 id（按输入顺序 0..N-1）\n' +
    `- 必须返回全部 ${items.length} 条\n` +
    '- 中文自然流畅，控制在 15-25 字以内\n' +
    '- 专有名词（人名/地名/品牌）保留英文原样\n' +
    '- 不要任何解释、markdown、代码块';

  const userInput = JSON.stringify(items.map(it => ({ id: it.id, text: it.text })));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userInput },
        ],
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('no JSON array in response');
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) throw new Error('not array');
    const map = new Map();
    for (const o of parsed) {
      if (o && typeof o === 'object' && 'id' in o && 'zh' in o) {
        const zh = String(o.zh || '').trim();
        if (zh) map.set(Number(o.id), zh);
      }
    }
    return map;
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function translateBatch(items) {
  for (let r = 0; r < MAX_BATCH_RETRIES; r++) {
    try {
      const m = await callMinimax(items, r);
      if (m.size === items.length) return m;
      console.log(`    batch got ${m.size}/${items.length}, retry ${r + 1}/${MAX_BATCH_RETRIES}`);
    } catch (e) {
      console.log(`    batch err: ${e.message}, retry ${r + 1}/${MAX_BATCH_RETRIES}`);
    }
    await sleep(RETRY_DELAY_BASE * Math.pow(1.5, r));
  }
  // per-item fallback
  console.log(`    per-item fallback (${items.length} items)`);
  const out = new Map();
  for (const it of items) {
    try {
      const m = await callMinimax([{ id: it.id, text: it.text }], 0);
      if (m.has(it.id)) out.set(it.id, m.get(it.id));
    } catch (e) {
      console.log(`      item ${it.id}: ${e.message}`);
    }
    await sleep(400);
  }
  return out;
}

function formatVttTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

async function processVideo(videoId) {
  console.log(`\n=== ${videoId} ===`);
  const enPath = path.join(CONTENT_DIR, videoId, 'video.en.vtt');
  const zhJsonPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.json');
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');

  if (!fs.existsSync(enPath)) { console.log('  ! no en.vtt, skip'); return; }
  if (!fs.existsSync(zhJsonPath)) { console.log('  ! no zh-Hans.json, skip'); return; }

  const enCues = parseVttCues(fs.readFileSync(enPath, 'utf-8'));
  const deduped = dedupeRollup(enCues).filter(c => !isNonSpeech(c.text));

  const zhMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
  let zhEnd = 0;
  for (const k of Object.keys(zhMap)) {
    const parts = k.split('-');
    if (parts.length === 2) {
      const e = parseFloat(parts[1]);
      if (!isNaN(e) && e > zhEnd) zhEnd = e;
    }
  }

  const toTranslate = deduped.filter(c => c.start >= zhEnd - 0.5);
  console.log(`  en cues: ${enCues.length} -> dedupe: ${deduped.length}`);
  console.log(`  zh covered up to ${zhEnd.toFixed(1)}s; need to translate ${toTranslate.length} cues from ${(toTranslate[0]?.start ?? 0).toFixed(1)}s onwards`);

  if (toTranslate.length === 0) { console.log('  already complete'); return; }
  const batchCount = Math.ceil(toTranslate.length / BATCH_SIZE);

  if (isDryRun) {
    console.log(`  DRY-RUN: would call MiniMax ${batchCount} batches (each ${BATCH_SIZE} cues)`);
    console.log(`  estimated tokens: input ~${batchCount * 800}, output ~${batchCount * 400}`);
    return;
  }

  // 翻译
  const localized = new Map(); // global idx -> zh
  let done = 0;
  for (let bi = 0; bi < toTranslate.length; bi += BATCH_SIZE) {
    const slice = toTranslate.slice(bi, bi + BATCH_SIZE);
    const items = slice.map((c, i) => ({ id: bi + i, text: c.text }));
    process.stdout.write(`  batch ${Math.floor(bi / BATCH_SIZE) + 1}/${batchCount} (${done}/${toTranslate.length})...\n`);
    const m = await translateBatch(items);
    for (const [k, v] of m) localized.set(k, v);
    done += slice.length;
  }
  const coverage = localized.size / toTranslate.length;
  console.log(`  translated ${localized.size}/${toTranslate.length} (${(coverage * 100).toFixed(1)}%)`);

  if (coverage < MIN_COVERAGE_TO_WRITE) {
    console.log(`  !! coverage < ${MIN_COVERAGE_TO_WRITE * 100}%, NOT writing files; original kept`);
    return;
  }

  // 追加到 zh-Hans.json
  for (let i = 0; i < toTranslate.length; i++) {
    const zh = localized.get(i);
    if (!zh) continue;
    const key = `${toTranslate[i].start.toFixed(3)}-${toTranslate[i].end.toFixed(3)}`;
    zhMap[key] = zh;
  }

  // 重建 zh-Hans.vtt (按 start 排序)
  const sorted = Object.entries(zhMap)
    .map(([k, v]) => {
      const [s, e] = k.split('-').map(Number);
      return { start: s, end: e, text: v };
    })
    .filter(c => !isNaN(c.start) && !isNaN(c.end))
    .sort((a, b) => a.start - b.start);

  const vttLines = ['WEBVTT', ''];
  for (const c of sorted) {
    vttLines.push(`${formatVttTime(c.start)} --> ${formatVttTime(c.end)}`);
    vttLines.push(c.text);
    vttLines.push('');
  }

  fs.writeFileSync(zhJsonPath, JSON.stringify(zhMap, null, 2), 'utf-8');
  fs.writeFileSync(zhVttPath, vttLines.join('\n'), 'utf-8');
  console.log(`  wrote ${zhJsonPath}`);
  console.log(`  wrote ${zhVttPath}`);
}

const DEFAULT_VIDEOS = ['6C0orv4gc8E', 'Hrbq66XqtCo', '6ehvrGV53AU', 'EDap9qxb96k'];
const ids = argIds.length ? argIds : DEFAULT_VIDEOS;

console.log(`Mode: ${isDryRun ? 'DRY-RUN' : 'REAL'}`);
console.log(`Videos: ${ids.join(', ')}`);

(async () => {
  for (const id of ids) {
    try {
      await processVideo(id);
    } catch (e) {
      console.error(`[${id}] FAILED:`, e.message);
    }
  }
  console.log('\nDONE');
})();
