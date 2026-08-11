// 对第二批缺失 ASR 的视频运行 Whisper 转录
// 用法: node scripts/whisper-batch2.mjs [--dry-run]
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');

const dryRun = process.argv.includes('--dry-run');

// Find videos with mp4 but no .vtt.old (never had ASR)
const pending = [];
for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'test-video') continue;
  const dir = path.join(CONTENT_DIR, entry.name);
  const hasMp4 = fs.existsSync(path.join(dir, 'video.mp4'));
  const hasOld = fs.existsSync(path.join(dir, 'video.en.vtt.old'));
  if (hasMp4 && !hasOld) pending.push(entry.name);
}

console.log(`待 ASR: ${pending.length} 个视频\n`);
if (pending.length === 0) process.exit(0);

if (dryRun) {
  console.log('[DRY RUN] 不会实际执行');
  for (const id of pending) console.log(`  ${id}`);
  process.exit(0);
}

// Groq free tier is heavily rate-limited. Use 120s delay between videos.
// Each video takes ~2-5 min to transcribe + rate limit backoff.
const DELAY_MS = 180_000;

let done = 0;
let ok = 0;
let fail = 0;

for (const videoId of pending) {
  done++;
  const startTime = Date.now();
  process.stdout.write(`[${done}/${pending.length}] ${videoId} ... `);
  try {
    execSync(
      `npx tsx "D:\\油管学习\\vibe-english\\scripts\\whisper-transcribe.mjs" ${videoId}`,
      { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 1800_000 }
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`OK (${elapsed}s)`);
    ok++;
  } catch (e) {
    const stderr = e.stderr?.toString() || '';
    const shortErr = stderr.split('\n').filter(l => l.includes('[whisper]')).slice(-1)[0] || e.message?.slice(0, 100);
    console.log(`FAIL: ${shortErr}`);
    fail++;
  }

  if (done < pending.length) {
    console.log(`  等待 ${DELAY_MS / 1000}s ...`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n=== ASR 完成 ===`);
console.log(`成功: ${ok}, 失败: ${fail}`);
if (fail > 0) {
  console.log(`失败视频: 等几小时后重新运行此脚本即可续传`);
}
