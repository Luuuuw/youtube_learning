// 从 DATA_DIR/vocab.json 提取系统级词汇（owner='system' 自动查词 / '__system__' 预热缓存）
// 到 data/vocab-system.json，作为公共资产提交 git，供 seed-data.ts 在空盘首次启动时播种。
// 用户自建词（owner 为具体用户名或 'undefined'）不会被提取。
//
// 用法：node scripts/extract-vocab-system.mjs

import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SRC = path.join(DATA_DIR, 'vocab.json');
const DEST = path.join(process.cwd(), 'data', 'vocab-system.json');

const SYSTEM_OWNERS = new Set(['system', '__system__']);

if (!fs.existsSync(SRC)) {
  console.error(`[extract] 找不到 ${SRC}`);
  process.exit(1);
}

let all;
try {
  all = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
} catch (e) {
  console.error('[extract] vocab.json 解析失败:', e.message);
  process.exit(1);
}

const systemEntries = all.filter((w) => SYSTEM_OWNERS.has(w.owner));
const userCount = all.length - systemEntries.length;

// 去重：同 (word.toLowerCase(), owner) 只保留一条
const seen = new Set();
const deduped = [];
for (const w of systemEntries) {
  const key = `${String(w.word).toLowerCase()}::${w.owner}`;
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(w);
}
deduped.sort((a, b) => String(a.word).toLowerCase().localeCompare(String(b.word).toLowerCase()));

fs.writeFileSync(DEST, JSON.stringify(deduped, null, 2), 'utf-8');
console.log(`[extract] 系统词 ${deduped.length} 条（跳过用户词 ${userCount} 条）→ ${DEST}`);
