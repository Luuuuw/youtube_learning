// 清理垃圾卡（__preheat__ / 空 videoId）+ 重新生成句型卡（只跑 sentence 维度，省 token）
// 用法:
//   node scripts/regen-sentence-cards.mjs           # dry-run：生成句型卡存临时文件，不落库
//   node scripts/regen-sentence-cards.mjs --apply   # 应用：读临时文件，删垃圾卡+旧句型卡，写入新句型卡
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'public', 'content');
const DATA_DIR = path.join(ROOT, 'data');

const apply = process.argv.includes('--apply');

// ---------- env ----------
const envPath = path.join(ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const dbFile = path.join(DATA_DIR, 'flashcards.json');
const pendingFile = path.join(DATA_DIR, '_regen-sentence-pending.json');

const isGarbage = c =>
  (c.owner === '__system__' && c.videoId === '__preheat__') ||
  (c.owner === 'system' && !c.videoId);

// ---------- apply 模式：读临时文件，秒级落库 ----------
if (apply) {
  if (!fs.existsSync(pendingFile)) {
    console.error('找不到临时文件 ' + pendingFile + '，请先跑 dry-run。');
    process.exit(1);
  }
  const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf-8'));
  const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  const before = db.length;

  const keep = db.filter(c => !isGarbage(c) && c.dimension !== 'sentence');
  const keys = new Set();
  let added = 0;
  for (const c of pending.cards) {
    if (c.dimension !== 'sentence') continue;
    const key = (c.back || '').toLowerCase().trim();
    if (!key || keys.has(key)) continue;
    keep.push(c);
    keys.add(key);
    added++;
  }

  fs.writeFileSync(dbFile, JSON.stringify(keep, null, 2), 'utf-8');
  fs.unlinkSync(pendingFile);

  console.log(`删除垃圾卡: ${pending.garbageCount}`);
  console.log(`删除旧句型卡: ${pending.sentenceCount}`);
  console.log(`新增句型卡: ${added} (临时文件 ${pending.cards.length} 张, 去重后 ${added})`);
  console.log(`最终卡数: ${keep.length} (原 ${before})`);
  console.log('已写入 data/flashcards.json');
  process.exit(0);
}

// ---------- dry-run 模式 ----------
const { generateFlashcards } = await import('../lib/flashcard-gen.js');

const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
const before = db.length;

const garbage = db.filter(isGarbage);
const sentences = db.filter(c => c.dimension === 'sentence');
const keep = db.filter(c => !isGarbage(c) && c.dimension !== 'sentence');

console.log('=== Step 1: 清理（静态） ===');
console.log(`  垃圾卡删除: ${garbage.length} 张`);
console.log(`  旧句型卡删除: ${sentences.length} 张`);
console.log(`  保留: ${keep.length} 张 (原 ${before} 张)`);

const videos = fs.readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .filter(id => {
    const dir = path.join(CONTENT_DIR, id);
    return fs.existsSync(path.join(dir, 'video.en.vtt')) &&
      fs.existsSync(path.join(dir, 'video.zh-Hans.json')) &&
      fs.existsSync(path.join(dir, 'quiz-bank.json'));
  });

console.log(`\n=== Step 2: 生成句型卡 (${videos.length} 个视频) ===`);

const allNewCards = [];
const existingKeys = new Set();
let ok = 0;
const failed = [];

const exprKey = c => (c.back || '').toLowerCase().trim();

for (let i = 0; i < videos.length; i++) {
  const id = videos[i];
  try {
    const { cards, stats } = await generateFlashcards(id, { dimensions: ['sentence'], writeDraft: false });
    let added = 0;
    for (const c of cards) {
      if (c.dimension !== 'sentence') continue;
      const key = exprKey(c);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      allNewCards.push(c);
      added++;
    }
    ok++;
    console.log(`[${i + 1}/${videos.length}] ${id} OK (句型 ${stats.sentence}, +${added})`);
  } catch (e) {
    failed.push(`${id}: ${e instanceof Error ? e.message : e}`);
    console.log(`[${i + 1}/${videos.length}] ${id} FAIL: ${e instanceof Error ? e.message : e}`);
  }
  if (i < videos.length - 1) await new Promise(r => setTimeout(r, 1500));
}

console.log(`\n=== 结果 (dry-run) ===`);
console.log(`  删除垃圾卡: ${garbage.length}`);
console.log(`  删除旧句型卡: ${sentences.length}`);
console.log(`  新增句型卡: ${allNewCards.length}`);
console.log(`  最终卡数: ${keep.length + allNewCards.length} (原 ${before})`);

fs.writeFileSync(pendingFile, JSON.stringify({
  garbageCount: garbage.length,
  sentenceCount: sentences.length,
  cards: allNewCards,
}, null, 2), 'utf-8');
console.log(`\n已存临时文件 ${pendingFile}`);
console.log('确认无误后运行: node scripts/regen-sentence-cards.mjs --apply');

if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
