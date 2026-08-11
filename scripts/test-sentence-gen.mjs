// Test: generate sentence flashcards for one video
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFlashcards } from '../lib/flashcard-gen';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// load env
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const videoId = process.argv[2] || 'froOlG_yGZU';
console.log(`Testing: ${videoId}`);

const r = await generateFlashcards(videoId);
console.log(`vocab: ${r.stats.vocab}, listening: ${r.stats.listening}, sentence: ${r.stats.sentence}`);

const sc = r.cards.filter(c => c.dimension === 'sentence');
for (const c of sc) {
  console.log('---');
  console.log('pattern:', c.hint);
  console.log('front:', c.front.slice(0, 300));
  console.log('back:', c.back);
  console.log('context:', c.context);
}
