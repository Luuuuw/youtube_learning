// 批量翻译：找到所有缺少 video.zh-Hans.json 的视频并翻译
// 用法: node scripts/batch-translate.mjs [--dry-run]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');

const dryRun = process.argv.includes('--dry-run');

// find videos with VTT but no zh-Hans.json
const missing = [];
for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'test-video') continue;
  const dir = path.join(CONTENT_DIR, entry.name);
  const hasVtt = fs.existsSync(path.join(dir, 'video.en.vtt'));
  const hasZh = fs.existsSync(path.join(dir, 'video.zh-Hans.json'));
  if (hasVtt && !hasZh) missing.push(entry.name);
}

console.log(`待翻译: ${missing.length} 个视频\n`);
if (missing.length === 0) process.exit(0);

if (dryRun) {
  console.log('[DRY RUN] 不会实际翻译');
  for (const id of missing) console.log(`  ${id}`);
  process.exit(0);
}

// load env
const envPath = path.join(PROJECT_ROOT, '.env.local');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { translateVideoFromRawVtt } = await import('../lib/translate/pipeline.js');

const DELAY_MS = 10_000; // 10s between videos
let done = 0;
let ok = 0;
let fail = 0;

for (const videoId of missing) {
  done++;
  process.stdout.write(`[${done}/${missing.length}] ${videoId} ... `);
  try {
    const subs = await translateVideoFromRawVtt(videoId);
    if (subs.length > 0) {
      console.log(`OK (${subs.length} 条)`);
      ok++;
    } else {
      console.log('SKIP (覆盖率不足)');
      fail++;
    }
  } catch (e) {
    console.log(`FAIL: ${e instanceof Error ? e.message.slice(0, 80) : String(e)}`);
    fail++;
  }

  if (done < missing.length) {
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n=== 翻译完成 ===`);
console.log(`成功: ${ok}, 失败/跳过: ${fail}`);
