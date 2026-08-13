#!/usr/bin/env node
// One-shot：把 lib/local-dict.ts 里硬编码的 DICT 提取到 data/local-dict.json
// 跑完后改 lib/local-dict.ts 只剩 import 加载器
//
// 用法: node scripts/migrate-local-dict.mjs

import fs from 'fs';
import vm from 'vm';
import path from 'path';

const tsPath = path.join(process.cwd(), 'lib', 'local-dict.ts');
const jsonOut = path.join(process.cwd(), 'data', 'local-dict.json');

const src = fs.readFileSync(tsPath, 'utf-8');

// 找到 `const DICT: Record<string, DictEntry> = {` 之后到匹配 `};` 之间
const startIdx = src.indexOf('const DICT');
if (startIdx < 0) { console.error('找不到 const DICT'); process.exit(1); }
const eqIdx = src.indexOf('=', startIdx);
const objStart = src.indexOf('{', eqIdx);

// 跟踪大括号匹配
let depth = 0;
let objEnd = -1;
for (let i = objStart; i < src.length; i++) {
  const c = src[i];
  if (c === '{') depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) { objEnd = i; break; }
  }
}
if (objEnd < 0) { console.error('找不到 DICT 结束 }'); process.exit(1); }

const objSrc = src.slice(objStart, objEnd + 1);
console.log(`提取 DICT 字面量: ${objSrc.length} bytes`);

// 用 vm sandbox 求值（DICT 是纯字面量，无副作用）
const sandbox = {};
vm.createContext(sandbox);
const result = vm.runInContext(`(${objSrc})`, sandbox);

const entries = Object.keys(result);
console.log(`词条数: ${entries.length}`);
console.log(`样本: ${entries.slice(0, 5).join(', ')}, ..., ${entries.slice(-3).join(', ')}`);

fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2), 'utf-8');
console.log(`写入: ${jsonOut} (${fs.statSync(jsonOut).size} bytes)`);
