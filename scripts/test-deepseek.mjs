#!/usr/bin/env node
// 端到端 smoke test：跑一次真实 DeepSeek 调用，验证 prompt + JSON 解析
// 用法: node scripts/test-deepseek.mjs

import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error('DEEPSEEK_API_KEY missing in .env.local');
  process.exit(1);
}

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

// 三种典型情况：1) 已合格 2) 缺失 3) 含未翻译英文残留
const samples = [
  { id: 1, en: 'Hello everyone, welcome back to my channel.', zh: '大家好，欢迎回到我的频道。' },
  { id: 2, en: 'Today I want to share my morning routine.', zh: '' },
  { id: 3, en: 'I had a productive day yesterday.', zh: 'I had 富有成效的 day 昨天。' },
];

const systemPrompt = `你是专业字幕审校。任务：检查 MiniMax 初翻，对【缺失】或【质量明显差】的条目重译，对【已合格】的条目原样保留。

【输入】JSON 数组，每项 { "id": 数字, "en": "英文原文", "zh": "MiniMax 初翻（可能为空）" }
【输出】严格 JSON 对象 { "items": [{ "id": 数字, "zh": "最终中文" }] }，必须包含全部 ${samples.length} 条。

【判定规则】
- zh 为空字符串 → 必须翻译
- zh 含未翻译的英文片段、明显误译、与 en 语义不符 → 重译
- zh 自然流畅且语义正确 → 原样返回（不要画蛇添足改写）

【翻译要求】
- 自然口语化中文，按中文语序，不要逐词直译
- 单条 15-25 字以内
- 专有名词保留英文

输出必须是合法 JSON，禁止任何解释、markdown 围栏。`;

const t0 = Date.now();
const res = await fetch(DEEPSEEK_API_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(samples) },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }),
});

if (!res.ok) {
  console.error('HTTP', res.status, await res.text());
  process.exit(2);
}

const data = await res.json();
const content = data.choices?.[0]?.message?.content || '';
const elapsed = Date.now() - t0;

console.log(`\n--- DeepSeek 响应（${elapsed}ms，model=${data.model}） ---`);
console.log(content);

let parsed;
try {
  parsed = JSON.parse(content);
} catch (e) {
  console.error('\n[FAIL] JSON 解析失败:', e.message);
  process.exit(3);
}

const arr = Array.isArray(parsed) ? parsed : parsed.items || parsed.results || parsed.data || [];
if (!Array.isArray(arr) || arr.length === 0) {
  console.error('\n[FAIL] 未拿到 items 数组');
  process.exit(4);
}

console.log('\n--- 解析结果 ---');
const idMap = new Map();
for (const it of arr) idMap.set(Number(it.id), String(it.zh || ''));

for (const s of samples) {
  const ds = idMap.get(s.id) || '<MISSING>';
  const label =
    !s.zh ? '[需补译]'
      : /[a-zA-Z]{3,}/.test(s.zh) ? '[需重译]'
      : '[已合格]';
  console.log(`  #${s.id} ${label}`);
  console.log(`    en: ${s.en}`);
  console.log(`    in: ${s.zh || '(空)'}`);
  console.log(`    out: ${ds}`);
}

const allCovered = samples.every(s => idMap.has(s.id) && idMap.get(s.id));
if (!allCovered) {
  console.error('\n[FAIL] 部分 id 未返回');
  process.exit(5);
}

console.log('\n[OK] smoke test 通过：3 条全部拿到中文，DeepSeek 接入可用。');
