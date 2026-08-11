// 重试失败的 ASR 视频，90s 间隔避免速率限制
// 用法: node scripts/whisper-retry.mjs
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');

// 有 mp4 但没有 .vtt.old 的视频 → 需要 ASR
const failed = [];
for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dir = path.join(CONTENT_DIR, entry.name);
  const hasMp4 = fs.existsSync(path.join(dir, 'video.mp4'));
  const hasOld = fs.existsSync(path.join(dir, 'video.en.vtt.old'));
  if (hasMp4 && !hasOld) failed.push(entry.name);
}

console.log(`待重试: ${failed.length} 个视频\n`);
if (failed.length === 0) process.exit(0);

const DELAY_MS = 90_000; // 90s between videos

let done = 0;
let ok = 0;
let fail = 0;

for (const videoId of failed) {
  done++;
  process.stdout.write(`[${done}/${failed.length}] ${videoId} ... `);
  try {
    execSync(
      `npx tsx "D:\\油管学习\\vibe-english\\scripts\\whisper-transcribe.mjs" ${videoId}`,
      { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 900_000 }
    );
    console.log('OK');
    ok++;
  } catch (e) {
    console.log(`FAIL: ${e.message?.slice(0, 80)}`);
    fail++;
  }

  if (done < failed.length) {
    console.log(`  等待 ${DELAY_MS / 1000}s ...`);
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
}

console.log(`\n=== 重试完成 ===`);
console.log(`成功: ${ok}, 失败: ${fail}`);
if (fail > 0) {
  console.log(`失败视频应手动处理或等更长时间后重试`);
}
