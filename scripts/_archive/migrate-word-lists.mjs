#!/usr/bin/env node
// One-shot：把 lib/word-classify.ts 里 4 个硬编码 Set → data/word-lists/*.json
//
// 用法: node scripts/migrate-word-lists.mjs

import fs from 'fs';
import vm from 'vm';
import path from 'path';

const tsPath = path.join(process.cwd(), 'lib', 'word-classify.ts');
const outDir = path.join(process.cwd(), 'data', 'word-lists');
fs.mkdirSync(outDir, { recursive: true });

const src = fs.readFileSync(tsPath, 'utf-8');

// 提取 const X = new Set([...]) 字面量
function extractSet(name) {
  const re = new RegExp(`const ${name}\\s*=\\s*new Set\\(`);
  const m = re.exec(src);
  if (!m) { console.error(`找不到 ${name}`); return null; }
  // 找到 `(` 后面的 `[`
  const arrStart = src.indexOf('[', m.index + m[0].length - 1);
  let depth = 0;
  let arrEnd = -1;
  for (let i = arrStart; i < src.length; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
  }
  if (arrEnd < 0) { console.error(`${name} 找不到 ]`); return null; }
  const arrSrc = src.slice(arrStart, arrEnd + 1);
  const sandbox = {};
  vm.createContext(sandbox);
  return vm.runInContext(`(${arrSrc})`, sandbox);
}

const lists = {
  stop: extractSet('STOP_WORDS'),
  basic: extractSet('BASIC_WORDS'),
  cet4: extractSet('CET4_WORDS'),
  cet6: extractSet('CET6_WORDS'),
  ielts: extractSet('IELTS_WORDS'),
};

for (const [name, arr] of Object.entries(lists)) {
  if (!arr) { console.error(`${name} 提取失败`); process.exit(1); }
  // 去重 + 排序，写 JSON 数组
  const uniq = Array.from(new Set(arr.filter(w => typeof w === 'string'))).sort();
  const out = path.join(outDir, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(uniq, null, 0), 'utf-8');
  console.log(`${name}: ${arr.length} → 去重 ${uniq.length}, 写入 ${out} (${fs.statSync(out).size} bytes)`);
}
