// 重新生成全部句型卡 + 坏听力卡
// 用法: node scripts/regenerate-flashcards.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');

const dryRun = process.argv.includes('--dry-run');

// ---------- env ----------
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_KEY) {
  console.error('DEEPSEEK_API_KEY 缺失');
  process.exit(1);
}

// ---------- Step 1: Clean DB ----------
console.log('=== Step 1: 清理旧数据 ===');
const dbFile = path.join(DATA_DIR, 'flashcards.json');
const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
const before = db.length;

// 删句型卡
const newDb = db.filter(c => {
  if (c.dimension === 'sentence') return false;
  // 删没挖空的听力卡
  if (c.dimension === 'listening' && c.front.includes('(听音频)') && !c.front.includes('___')) return false;
  return true;
});

const deletedSentence = before - newDb.filter(c => c.dimension === 'sentence').length - (before - newDb.length);
const deletedListening = db.filter(c => c.dimension === 'listening' && c.front.includes('(听音频)') && !c.front.includes('___')).length;
console.log(`  句型卡删除: ${db.filter(c => c.dimension === 'sentence').length} 张`);
console.log(`  坏听力卡删除: ${deletedListening} 张`);
console.log(`  剩余: ${newDb.length} 张 (原 ${before} 张)`);

if (!dryRun) {
  fs.writeFileSync(dbFile, JSON.stringify(newDb, null, 2), 'utf-8');
}

// ---------- Step 2: Delete drafts ----------
console.log('\n=== Step 2: 清理草稿文件 ===');
let draftCount = 0;
for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const fp = path.join(CONTENT_DIR, entry.name, 'flashcards.json');
  if (fs.existsSync(fp)) {
    if (!dryRun) fs.unlinkSync(fp);
    draftCount++;
  }
}
console.log(`  删除草稿: ${draftCount} 个视频`);

// ---------- Step 3: Regenerate ----------
console.log('\n=== Step 3: 重新生成 ===');

const { generateFlashcards } = await import('../lib/flashcard-gen.js');

function importToDb(cards) {
  if (dryRun) return 0;
  const existing = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
  const existingKeys = new Set();
  for (const c of existing) {
    if (c.dimension === 'vocab' && c.word) existingKeys.add(`vocab::${c.videoId}::${c.word.toLowerCase()}`);
    existingKeys.add(`${c.type}::${c.videoId}::${c.front}`);
  }

  let added = 0;
  for (const c of cards) {
    const vocabKey = c.dimension === 'vocab' && c.word ? `vocab::${c.videoId}::${c.word.toLowerCase()}` : null;
    const genericKey = `${c.type}::${c.videoId}::${c.front}`;
    if ((vocabKey && existingKeys.has(vocabKey)) || existingKeys.has(genericKey)) continue;
    existing.push(c);
    if (vocabKey) existingKeys.add(vocabKey);
    existingKeys.add(genericKey);
    added++;
  }

  if (added > 0) {
    fs.writeFileSync(dbFile, JSON.stringify(existing, null, 2), 'utf-8');
  }
  return added;
}

async function regenerateForVideo(videoId) {
  const { cards, stats } = await generateFlashcards(videoId);
  const imported = importToDb(cards);
  return { stats, imported };
}

// ---------- Main ----------
async function main() {
  // Get all videos with VTT
  const videos = [];
  for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const vp = path.join(CONTENT_DIR, entry.name, 'video.en.vtt');
    if (fs.existsSync(vp) && entry.name !== 'test-video') {
      videos.push(entry.name);
    }
  }

  console.log(`待重新生成: ${videos.length} 个视频\n`);

  if (dryRun) {
    console.log('[DRY RUN] 不会实际修改数据');
  }

  let totalSentence = 0;
  let totalListening = 0;
  let done = 0;

  for (const videoId of videos) {
    process.stdout.write(`[${++done}/${videos.length}] ${videoId} ... `);
    try {
      const { stats, imported } = await regenerateForVideo(videoId);
      console.log(`OK (${stats.sentence}s ${stats.listening}l, +${imported})`);
      totalSentence += stats.sentence;
      totalListening += stats.listening;
    } catch (e) {
      console.log(`FAIL: ${e instanceof Error ? e.message : e}`);
    }

    if (done < videos.length) {
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`句型: ${totalSentence} 张, 听力: ${totalListening} 张`);
  console.log(`总计新增: ${totalSentence + totalListening} 张`);

  if (dryRun) {
    console.log('\n[DRY RUN] 使用 --dry-run 跳过实际写入。去掉此参数以实际执行。');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
