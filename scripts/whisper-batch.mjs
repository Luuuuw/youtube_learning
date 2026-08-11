// Groq Whisper 批量转录
// 用法: node scripts/whisper-batch.mjs [--dry-run]
//
// 流程:
//   1. 找到所有 public/content/*/video.mp4
//   2. 跳过已有 video.en.vtt.old 的视频（已处理过）
//   3. 逐个调用 whisper-transcribe.mjs
//   4. 每次 API 调用间隔至少 3 秒（Groq 限制 30次/分钟）

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const TRANSCRIBE_SCRIPT = path.join(__dirname, 'whisper-transcribe.mjs');

const DELAY_MS = 3500; // 3.5 秒间隔，安全低于 30次/分钟

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  // 收集所有视频 ID
  const entries = fs.readdirSync(CONTENT_DIR, { withFileTypes: true });
  const allIds = entries
    .filter(e => e.isDirectory())
    .map(e => e.name);

  // 分离待处理 / 已完成
  const pending = [];
  const done = [];
  for (const id of allIds) {
    const videoPath = path.join(CONTENT_DIR, id, 'video.mp4');
    const bakPath = path.join(CONTENT_DIR, id, 'video.en.vtt.old');
    if (!fs.existsSync(videoPath)) {
      continue; // 无视频，跳过
    }
    if (fs.existsSync(bakPath)) {
      done.push(id);
    } else {
      pending.push(id);
    }
  }

  console.log(`[batch] 总计: ${allIds.length} | 已完成: ${done.length} | 待处理: ${pending.length}`);
  if (pending.length === 0) {
    console.log('[batch] 全部已完成，退出');
    return;
  }
  console.log(`[batch] 间隔: ${DELAY_MS}ms (~${(60 / (DELAY_MS / 1000)).toFixed(0)} 次/分钟)`);
  console.log('');

  let success = 0;
  let fail = 0;
  const failedIds = [];

  for (let i = 0; i < pending.length; i++) {
    const id = pending[i];
    const label = `[${i + 1}/${pending.length}]`;
    console.log(`${label} ${id} ...`);

    try {
      const dryFlag = isDryRun ? ' --dry-run' : '';
      execSync(`npx tsx "${TRANSCRIBE_SCRIPT}" ${id}${dryFlag}`, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        timeout: 600_000, // 10 分钟超时
      });
      success++;
    } catch (err) {
      fail++;
      failedIds.push(id);
      console.error(`[batch] ${id} 失败: ${err.message?.slice(0, 200) || err}`);
    }

    // 最后一个不等待
    if (i < pending.length - 1) {
      console.log(`[batch] 等待 ${DELAY_MS / 1000}s ...`);
      await sleep(DELAY_MS);
    }
    console.log('');
  }

  console.log('='.repeat(50));
  console.log(`[batch] 完成! 成功: ${success} | 失败: ${fail}`);
  if (failedIds.length > 0) {
    console.log(`[batch] 失败列表: ${failedIds.join(', ')}`);
  }
}

main().catch(err => {
  console.error('[batch]', err);
  process.exit(1);
});
