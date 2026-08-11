// One-shot script: import AI-generated draft flashcards from public/content/*/flashcards.json
// into data/flashcards.json. Deduplicates by card id.
// Run: node scripts/import-draft-flashcards.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const contentDir = path.join(root, 'public', 'content');
const dbPath = path.join(root, 'data', 'flashcards.json');

// Read existing DB
const existing = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
const existingIds = new Set(existing.map(c => c.id));
console.log(`Existing cards: ${existing.length}`);

// Scan all draft files
const dirs = fs.readdirSync(contentDir).filter(d => {
  const p = path.join(contentDir, d, 'flashcards.json');
  return fs.existsSync(p) && fs.statSync(p).isFile();
});

let imported = 0;
let skipped = 0;
const byVideo = {};

for (const dir of dirs) {
  const draftPath = path.join(contentDir, dir, 'flashcards.json');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(draftPath, 'utf-8'));
  } catch (e) {
    console.warn(`  SKIP ${dir}: parse error - ${e.message}`);
    continue;
  }
  const cards = Array.isArray(data?.cards) ? data.cards : Array.isArray(data) ? data : [];
  let videoCount = 0;
  for (const card of cards) {
    if (!card.id) {
      console.warn(`  SKIP card in ${dir}: missing id`);
      continue;
    }
    if (existingIds.has(card.id)) {
      skipped++;
      continue;
    }
    // Ensure required fields
    existing.push({
      ...card,
      owner: card.owner || '__shared__',
      source: card.source || 'ai',
      reviewedByAdmin: card.reviewedByAdmin ?? true, // AI cards are pre-reviewed
      createdAt: card.createdAt || new Date().toISOString(),
      tags: Array.isArray(card.tags) ? card.tags : [],
      dimension: card.dimension || 'vocab',
      type: card.type || 'recognition',
      front: card.front || '',
      back: card.back || '',
      context: card.context || '',
    });
    existingIds.add(card.id);
    imported++;
    videoCount++;
  }
  if (videoCount > 0) byVideo[dir] = videoCount;
}

// Write back
fs.writeFileSync(dbPath, JSON.stringify(existing, null, 2), 'utf-8');
console.log(`\nImported: ${imported} cards from ${Object.keys(byVideo).length} videos`);
console.log(`Skipped (already in DB): ${skipped}`);
console.log(`New total: ${existing.length} cards`);

// Show per-video breakdown
const entries = Object.entries(byVideo).sort((a, b) => b[1] - a[1]);
for (const [vid, count] of entries) {
  console.log(`  ${vid}: +${count}`);
}
