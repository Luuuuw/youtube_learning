// 从 data/whisper-raw/<id>.json 批量重新生成 video.en.vtt（DeepSeek 标点恢复 + 按句断句）
// 用法: node scripts/regen-vtt.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'public', 'content');
const RAW_DIR = path.join(ROOT, 'data', 'whisper-raw');

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const { restorePunctuation } = await import('../lib/whisper-punctuate.js');
const { buildVttFromWhisper, buildVttFromWords } = await import('../lib/whisper-vtt-builder.js');

const CONCURRENCY = 4;
const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.json'));

let ok = 0, skip = 0, fail = 0, done = 0;
const failed = [];

async function processOne(file) {
  const id = file.replace(/\.json$/, '');
  const vttPath = path.join(CONTENT_DIR, id, 'video.en.vtt');
  if (!fs.existsSync(path.join(CONTENT_DIR, id))) { skip++; return; }
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, file), 'utf-8'));
    const words = raw.words || [];
    const text = raw.text || '';
    const restored = await restorePunctuation(text, process.env.DEEPSEEK_API_KEY);
    const vtt = restored && restored !== text ? buildVttFromWhisper(restored, words) : buildVttFromWords(words);
    if (!vtt) throw new Error('empty vtt');
    const bakPath = path.join(CONTENT_DIR, id, 'video.en.vtt.old');
    if (!fs.existsSync(bakPath) && fs.existsSync(vttPath)) fs.copyFileSync(vttPath, bakPath);
    fs.writeFileSync(vttPath, vtt);
    ok++;
  } catch (e) {
    fail++;
    failed.push(`${id}: ${e.message}`);
  }
  done++;
  if (done % 10 === 0) console.log(`[regen] ${done}/${files.length} ok=${ok} skip=${skip} fail=${fail}`);
}

let idx = 0;
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (idx < files.length) {
    const i = idx++;
    await processOne(files[i]);
  }
});
await Promise.all(workers);

console.log(`\nDONE ok=${ok} skip=${skip} fail=${fail}`);
if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
