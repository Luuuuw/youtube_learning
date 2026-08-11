// 批量审批所有 AI draft 闪卡 → 直接写入 data/flashcards.json
// 用法: node scripts/auto-approve-all.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const FLASHCARDS_FILE = path.join(DATA_DIR, 'flashcards.json');

const dryRun = process.argv.includes('--dry-run');

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return []; }
}

function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FLASHCARDS_FILE)) fs.writeFileSync(FLASHCARDS_FILE, '[]', 'utf-8');

  const existingCards = readJson(FLASHCARDS_FILE);
  console.log(`现有闪卡: ${existingCards.length} 张`);

  // 建立已有卡的去重索引
  const existingKeys = new Set();
  for (const c of existingCards) {
    if (c.dimension === 'vocab' && c.word) {
      existingKeys.add(`vocab::${c.videoId}::${c.word.toLowerCase()}`);
    }
    existingKeys.add(`${c.type}::${c.videoId}::${c.front}`);
  }

  const videoDirs = fs.readdirSync(CONTENT_DIR).filter(d => {
    const p = path.join(CONTENT_DIR, d);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'flashcards.json'));
  });

  console.log(`找到 ${videoDirs.length} 个有闪卡草稿的视频\n`);

  let totalAdded = 0;
  const report = [];

  for (const videoId of videoDirs) {
    const draftPath = path.join(CONTENT_DIR, videoId, 'flashcards.json');
    let draft;
    try { draft = JSON.parse(fs.readFileSync(draftPath, 'utf-8')); } catch { continue; }
    const cards = Array.isArray(draft.cards) ? draft.cards : [];
    if (cards.length === 0) continue;

    const newCards = [];
    for (const c of cards) {
      const vocabKey = c.dimension === 'vocab' && c.word
        ? `vocab::${c.videoId}::${c.word.toLowerCase()}`
        : null;
      const genericKey = `${c.type}::${c.videoId}::${c.front}`;

      if ((vocabKey && existingKeys.has(vocabKey)) || existingKeys.has(genericKey)) {
        continue;
      }

      const card = {
        ...c,
        id: generateId(),
        owner: '__shared__',
        source: c.source || 'ai',
        reviewedByAdmin: true,
        createdAt: new Date().toISOString(),
      };
      newCards.push(card);
      if (vocabKey) existingKeys.add(vocabKey);
      existingKeys.add(genericKey);
    }

    if (newCards.length > 0) {
      report.push({ videoId, added: newCards.length });
      totalAdded += newCards.length;
      existingCards.push(...newCards);
      console.log(`  ${videoId}: +${newCards.length} 张`);
    }
  }

  console.log(`\n总计新增: ${totalAdded} 张`);

  if (dryRun) {
    console.log('[DRY RUN] 未写入 data/flashcards.json');
    return;
  }

  if (totalAdded > 0) {
    fs.writeFileSync(FLASHCARDS_FILE, JSON.stringify(existingCards, null, 2), 'utf-8');
    console.log('已写入 data/flashcards.json');
  }
}

main();
