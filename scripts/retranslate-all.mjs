// 批量强制重翻译所有 ASR 视频（删除旧 zh 后按新 en.vtt 粒度重新翻译）
// 用法: node scripts/retranslate-all.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'public', 'content');
const RAW_DIR = path.join(ROOT, 'data', 'whisper-raw');

const dryRun = process.argv.includes('--dry-run');

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

const { translateVideoFromRawVtt } = await import('../lib/translate/pipeline.js');

// 只重翻译有 raw JSON 的（即 en.vtt 被重建过的）视频
const ids = fs.readdirSync(RAW_DIR)
  .filter(f => f.endsWith('.json'))
  .map(f => f.replace(/\.json$/, ''))
  .filter(id => fs.existsSync(path.join(CONTENT_DIR, id, 'video.en.vtt')));

console.log(`待重翻译: ${ids.length} 个视频`);

if (dryRun) {
  for (const id of ids) console.log(`  ${id}`);
  process.exit(0);
}

const CONCURRENCY = 3;
let ok = 0, fail = 0, done = 0;
const failed = [];

async function processOne(id) {
  const zhJson = path.join(CONTENT_DIR, id, 'video.zh-Hans.json');
  const zhVtt = path.join(CONTENT_DIR, id, 'video.zh-Hans.vtt');
  try { fs.unlinkSync(zhJson); } catch {}
  try { fs.unlinkSync(zhVtt); } catch {}
  try {
    const subs = await translateVideoFromRawVtt(id);
    ok++;
    process.stdout.write(`[${done + 1}/${ids.length}] ${id} OK(${subs.length})\n`);
  } catch (e) {
    fail++;
    failed.push(`${id}: ${e instanceof Error ? e.message.slice(0, 80) : e}`);
    process.stdout.write(`[${done + 1}/${ids.length}] ${id} FAIL\n`);
  }
  done++;
}

let idx = 0;
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (idx < ids.length) {
    const i = idx++;
    await processOne(ids[i]);
  }
});
await Promise.all(workers);

console.log(`\nDONE ok=${ok} fail=${fail}`);
if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
