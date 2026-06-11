// 检查 import 路径与实际文件的大小写是否一致（Linux 上不一致会 build fail）
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SKIP = ['node_modules', '.next', '.git', 'public', 'data', 'logs', 'bin'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT);
// 建立 lower → actual 映射（相对于 ROOT，用 / 分隔）
const fileMap = new Map();
for (const f of allFiles) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  fileMap.set(rel.toLowerCase(), rel);
}

const importPat = /(?:from|import)\s+['"]([^'"]+)['"]/g;
const exts = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js'];

const mismatches = [];

for (const f of allFiles) {
  if (!/\.(ts|tsx|js|mjs)$/.test(f)) continue;
  const content = fs.readFileSync(f, 'utf-8');
  importPat.lastIndex = 0;
  let m;
  while ((m = importPat.exec(content)) !== null) {
    const imp = m[1];
    let candidate;
    if (imp.startsWith('@/')) {
      candidate = imp.slice(2);
    } else if (imp.startsWith('./') || imp.startsWith('../')) {
      const baseDir = path.dirname(f);
      candidate = path.relative(ROOT, path.resolve(baseDir, imp)).replace(/\\/g, '/');
    } else continue;

    for (const ext of exts) {
      const key = (candidate + ext).toLowerCase();
      if (fileMap.has(key)) {
        const actual = fileMap.get(key);
        const wantedPath = candidate + ext;
        if (actual !== wantedPath) {
          mismatches.push({ file: path.relative(ROOT, f).replace(/\\/g, '/'), import: imp, expected: actual });
        }
        break;
      }
    }
  }
}

if (mismatches.length === 0) {
  console.log('OK: no import case mismatch');
} else {
  console.log(`FOUND ${mismatches.length} mismatches:`);
  for (const m of mismatches.slice(0, 50)) {
    console.log(`  ${m.file}`);
    console.log(`    imports: "${m.import}"`);
    console.log(`    actual:  ${m.expected}`);
  }
}
