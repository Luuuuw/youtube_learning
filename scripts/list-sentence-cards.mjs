import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(__dirname, '..', 'public', 'content');

const dirs = fs.readdirSync(CONTENT, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'test-video');

const results = [];
for (const d of dirs) {
  const fp = path.join(CONTENT, d.name, 'flashcards.json');
  if (!fs.existsSync(fp)) continue;
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const sentences = (data.cards || []).filter(c => c.dimension === 'sentence');
  if (sentences.length === 0) continue;

  let cues = 0;
  try {
    const vtt = fs.readFileSync(path.join(CONTENT, d.name, 'video.en.vtt'), 'utf-8');
    cues = vtt.split('\n').filter(l => /-->/.test(l)).length;
  } catch {}

  results.push({ id: d.name, s: sentences.length, cues });
}

results.sort((a, b) => b.cues - a.cues);
for (const r of results.slice(0, 20)) {
  console.log(`${r.id} | sentences: ${r.s} | cues: ${r.cues}`);
}
