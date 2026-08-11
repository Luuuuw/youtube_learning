// 把 data/vocab.json 的 AI 释义合并到 data/local-dict.json
// 用法: node scripts/expand-local-dict.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const vocabPath = path.join(PROJECT_ROOT, 'data', 'vocab.json');
const dictPath = path.join(PROJECT_ROOT, 'data', 'local-dict.json');

const dryRun = process.argv.includes('--dry-run');

const vocabData = JSON.parse(fs.readFileSync(vocabPath, 'utf-8'));
const dictData = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));

let merged = 0;
let skippedNoDef = 0;
let skippedExists = 0;

for (const key of Object.keys(vocabData)) {
  const entry = vocabData[key];
  if (!entry.word || !entry.definition) {
    skippedNoDef++;
    continue;
  }
  const word = entry.word.toLowerCase().trim();
  if (dictData[word]) {
    skippedExists++;
    continue;
  }
  // Skip entries with just the word itself as definition (empty/malformed)
  const def = entry.definition?.trim();
  if (!def || def.length < 1 || def === entry.word) {
    skippedNoDef++;
    continue;
  }
  dictData[word] = {
    word: entry.word,
    phonetic: entry.phonetic || '',
    definition: def,
    example: entry.example || '',
  };
  merged++;
}

console.log(`vocab.json 总条目: ${Object.keys(vocabData).length}`);
console.log(`新增: ${merged}`);
console.log(`已有跳过: ${skippedExists}`);
console.log(`无释义跳过: ${skippedNoDef}`);
console.log(`local-dict.json: ${Object.keys(dictData).length} 词`);

if (!dryRun) {
  fs.writeFileSync(dictPath, JSON.stringify(dictData, null, 2), 'utf-8');
  const kb = (fs.statSync(dictPath).size / 1024).toFixed(0);
  console.log(`已写入 ${dictPath} (${kb} KB)`);
} else {
  console.log('[DRY RUN] 未实际写入');
}
