#!/usr/bin/env node
// 端到端测试：MiniMax 初翻 → DeepSeek 审校。
// 只读不写，抽取 12 条字幕，打印 before/after。
// 用法: node scripts/test-pipeline-e2e.mjs [videoId]

import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const minimaxKey = process.env.MINIMAX_API_KEY;
const deepseekKey = process.env.DEEPSEEK_API_KEY;
if (!minimaxKey || !deepseekKey) {
  console.error('MINIMAX_API_KEY or DEEPSEEK_API_KEY missing');
  process.exit(1);
}

const videoId = process.argv[2] || 'Ligna8lb3WA';
const SAMPLE_SIZE = 12;
const enVtt = path.join(process.cwd(), 'public', 'content', videoId, 'video.en.vtt');
if (!fs.existsSync(enVtt)) {
  console.error('en.vtt not found:', enVtt);
  process.exit(1);
}

// --- 1. 解析 + 去重（与 fix-translation-gaps.mjs 一致）---
function parseVtt(text) {
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
      if (!lines[j].trim() || lines[j].match(pat)) break;
      txt += (txt ? '\n' : '') + lines[j];
    }
    cues.push({ start: s, end: e, text: txt });
  }
  return cues;
}

function clean(t) {
  return t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

const allCues = parseVtt(fs.readFileSync(enVtt, 'utf-8'));
const cleaned = [];
let prev = '';
for (const c of allCues) {
  const t = clean(c.text);
  if (!t || t === prev) continue;
  if (prev && t.startsWith(prev + ' ')) {
    const added = t.slice(prev.length).trim();
    if (added) { cleaned.push({ ...c, text: added }); prev = t; }
    continue;
  }
  if (!/^\[[^\]]+\]$/.test(t) && !/^\([^)]+\)$/.test(t)) {
    cleaned.push({ ...c, text: t });
    prev = t;
  }
}

// 取中段 SAMPLE_SIZE 条
const startIdx = Math.floor(cleaned.length / 3);
const sample = cleaned.slice(startIdx, startIdx + SAMPLE_SIZE).map((c, i) => ({ id: i + 1, text: c.text }));
console.log(`视频: ${videoId}`);
console.log(`总条: ${allCues.length} → 去重: ${cleaned.length} → 抽取: ${sample.length} 条（第 ${startIdx} 起）\n`);

// --- 2. MiniMax 初翻（模拟 translate.ts: batch=8, JSON 格式）---
async function callMinimax(items) {
  const sys = `你是专业视频字幕翻译，把每条英文翻译成自然口语化中文。
【输出格式】严格 JSON 数组，每项 { "id": 数字, "zh": "中文" }。
【必须】
- 必须返回输入的全部 ${items.length} 条
- 中文 15-25 字，按中文语序
- 专有名词保留英文
- 只输出 JSON 数组`;
  const res = await fetch('https://api.minimaxi.com/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${minimaxKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'MiniMax-M2.5',
      messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(items) }],
    }),
  });
  if (!res.ok) throw new Error(`MiniMax ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const m = content.match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : [];
  const map = new Map();
  for (const o of arr) {
    if (o && 'id' in o && 'zh' in o) {
      const zh = String(o.zh || '').trim();
      if (zh) map.set(Number(o.id), zh);
    }
  }
  return map;
}

console.log('=== Step 1: MiniMax 初翻 ===');
const t0 = Date.now();
const mmResult = await callMinimax(sample);
console.log(`耗时 ${Date.now() - t0}ms，拿到 ${mmResult.size}/${sample.length} 条\n`);

// --- 3. DeepSeek 审校（与 lib/deepseek.ts 同 prompt）---
async function callDeepSeek(items) {
  const sys = `你是专业字幕审校。任务：检查 MiniMax 初翻，对【缺失】或【质量明显差】的条目重译，对【已合格】的条目原样保留。

【输入】JSON 数组，每项 { "id": 数字, "en": "英文原文", "zh": "MiniMax 初翻（可能为空）" }
【输出】严格 JSON 对象 { "items": [{ "id": 数字, "zh": "最终中文" }] }，必须包含全部 ${items.length} 条。

【判定规则】
- zh 为空字符串 → 必须翻译
- zh 含未翻译的英文片段、明显误译、与 en 语义不符 → 重译
- zh 自然流畅且语义正确 → 原样返回（不要画蛇添足改写）

【翻译要求】
- 自然口语化中文，按中文语序
- 单条 15-25 字
- 专有名词保留英文
- 忽略 uh/um/you know 等填充词

输出必须是合法 JSON。`;

  const input = items.map(it => ({ id: it.id, en: it.text, zh: mmResult.get(it.id) || '' }));
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${deepseekKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: sys }, { role: 'user', content: JSON.stringify(input) }],
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = JSON.parse(content);
  const arr = parsed.items || parsed.results || (Array.isArray(parsed) ? parsed : []);
  const map = new Map();
  for (const o of arr) {
    if (o && 'id' in o && 'zh' in o) {
      const zh = String(o.zh || '').trim();
      if (zh) map.set(Number(o.id), zh);
    }
  }
  return { map, model: data.model };
}

console.log('=== Step 2: DeepSeek 审校 ===');
const t1 = Date.now();
const { map: dsResult, model: dsModel } = await callDeepSeek(sample);
console.log(`耗时 ${Date.now() - t1}ms，model=${dsModel}，拿到 ${dsResult.size}/${sample.length} 条\n`);

// --- 4. 对比 ---
console.log('=== 对比结果 ===');
let kept = 0, revised = 0, filled = 0, missing = 0;
for (const s of sample) {
  const mm = mmResult.get(s.id) || '';
  const ds = dsResult.get(s.id) || '';
  let tag, marker;
  if (!ds) { tag = '[MISSING ]'; missing++; marker = '!'; }
  else if (!mm) { tag = '[FILLED  ]'; filled++; marker = '+'; }
  else if (ds === mm) { tag = '[KEPT    ]'; kept++; marker = ' '; }
  else { tag = '[REVISED ]'; revised++; marker = '~'; }
  console.log(`${tag} ${marker} #${s.id}`);
  console.log(`    en: ${s.text}`);
  console.log(`    mm: ${mm || '(空)'}`);
  if (ds !== mm) console.log(`    ds: ${ds}`);
}
console.log(`\n汇总: kept=${kept}, revised=${revised}, filled=${filled}, missing=${missing}`);
console.log(`总耗时: ${Date.now() - t0}ms`);
console.log(dsResult.size === sample.length ? '\n[OK] 端到端管线打通' : '\n[WARN] DeepSeek 漏了条');
