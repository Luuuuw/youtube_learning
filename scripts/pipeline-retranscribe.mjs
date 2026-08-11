// 统一流水线：ASR → 翻译 → Quiz → 闪卡
// 针对第二批缺少 ASR 的视频，完成全套内容生成
// 用法: npx tsx scripts/pipeline-retranscribe.mjs [--dry-run]
//
// 步骤:
//   0. 等待 ASR 批量完成（或先触发 ASR）
//   1. 删除旧的中文翻译（这些翻译基于低质量 YouTube 字幕）
//   2. 删除旧的 quiz-bank.json（题目基于旧字幕）
//   3. 批量子翻译（MiniMax + DeepSeek 二审）
//   4. 批量生成 Quiz
//   5. 重新生成闪卡（句型卡 + 听力卡）

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');

const dryRun = process.argv.includes('--dry-run');

// ---------- helpers ----------
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Find videos needing ASR (mp4 but no .vtt.old)
function findAsrNeeded() {
  const result = [];
  for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'test-video') continue;
    const dir = path.join(CONTENT_DIR, entry.name);
    if (fs.existsSync(path.join(dir, 'video.mp4')) && !fs.existsSync(path.join(dir, 'video.en.vtt.old'))) {
      result.push(entry.name);
    }
  }
  return result;
}

// ---------- Step 0: ASR ----------
async function stepAsr(videoIds) {
  console.log('=== Step 0: ASR (Whisper 转录) ===');

  const pending = videoIds.filter(id => {
    const dir = path.join(CONTENT_DIR, id);
    return !fs.existsSync(path.join(dir, 'video.en.vtt.old'));
  });

  if (pending.length === 0) {
    console.log('全部已完成 ASR，跳过\n');
    return;
  }

  console.log(`待 ASR: ${pending.length} 个视频\n`);

  if (dryRun) {
    console.log('[DRY RUN] 跳过实际 ASR\n');
    return;
  }

  const DELAY_MS = 120_000;
  let ok = 0, fail = 0;

  for (let i = 0; i < pending.length; i++) {
    const videoId = pending[i];
    process.stdout.write(`[${i + 1}/${pending.length}] ${videoId} ... `);
    const startTime = Date.now();
    try {
      execSync(
        `npx tsx "${path.join(__dirname, 'whisper-transcribe.mjs')}" ${videoId}`,
        { cwd: PROJECT_ROOT, stdio: 'pipe', timeout: 900_000 }
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

    if (i < pending.length - 1) {
      console.log(`  等待 ${DELAY_MS / 1000}s ...`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\nASR 完成: 成功 ${ok}, 失败 ${fail}\n`);
  if (fail > 0) {
    console.log('⚠️  有失败视频，继续后续步骤（失败视频会被跳过）\n');
  }
}

// ---------- Step 1: Clean old translations ----------
function stepCleanTranslations(videoIds) {
  console.log('=== Step 1: 清理旧中文翻译 ===');
  let cleaned = 0;
  for (const id of videoIds) {
    const files = ['video.zh-Hans.json', 'video.zh-Hans.vtt'];
    for (const f of files) {
      const fp = path.join(CONTENT_DIR, id, f);
      if (fs.existsSync(fp)) {
        const action = dryRun ? '[DRY RUN] 将删除' : '删除';
        console.log(`  ${action} ${id}/${f}`);
        if (!dryRun) fs.unlinkSync(fp);
        cleaned++;
      }
    }
  }
  if (cleaned === 0) console.log('  无需清理');
  console.log('');
}

// ---------- Step 2: Clean old quiz ----------
function stepCleanQuiz(videoIds) {
  console.log('=== Step 2: 清理旧 Quiz ===');
  let cleaned = 0;
  for (const id of videoIds) {
    const fp = path.join(CONTENT_DIR, id, 'quiz-bank.json');
    if (fs.existsSync(fp)) {
      const action = dryRun ? '[DRY RUN] 将删除' : '删除';
      console.log(`  ${action} ${id}/quiz-bank.json`);
      if (!dryRun) fs.unlinkSync(fp);
      cleaned++;
    }
  }
  if (cleaned === 0) console.log('  无需清理');
  console.log('');
}

// ---------- Step 3: Translation ----------
async function stepTranslate() {
  console.log('=== Step 3: 批量翻译 ===');

  if (dryRun) {
    // Count what would be translated
    const missing = [];
    for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'test-video') continue;
      const dir = path.join(CONTENT_DIR, entry.name);
      const hasVtt = fs.existsSync(path.join(dir, 'video.en.vtt'));
      const hasZh = fs.existsSync(path.join(dir, 'video.zh-Hans.json')) || fs.existsSync(path.join(dir, 'video.zh-Hans.vtt'));
      if (hasVtt && !hasZh) missing.push(entry.name);
    }
    console.log(`[DRY RUN] 将翻译 ${missing.length} 个视频: ${missing.join(', ')}\n`);
    return;
  }

  try {
    execSync(`npx tsx "${path.join(__dirname, 'batch-translate.mjs')}"`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 7200_000, // 2 hours
    });
  } catch (e) {
    console.error('翻译步骤失败:', e.message?.slice(0, 200));
    throw e;
  }
}

// ---------- Step 4: Quiz Generation ----------
async function stepQuiz() {
  console.log('\n=== Step 4: 批量生成 Quiz ===');

  if (dryRun) {
    const missing = [];
    for (const entry of fs.readdirSync(CONTENT_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'test-video') continue;
      const dir = path.join(CONTENT_DIR, entry.name);
      if (fs.existsSync(path.join(dir, 'video.en.vtt')) && !fs.existsSync(path.join(dir, 'quiz-bank.json'))) {
        missing.push(entry.name);
      }
    }
    console.log(`[DRY RUN] 将生成 ${missing.length} 个视频的 Quiz: ${missing.join(', ')}\n`);
    return;
  }

  try {
    execSync(`node "${path.join(__dirname, 'batch-quiz.mjs')}"`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 7200_000,
    });
  } catch (e) {
    console.error('Quiz 生成失败:', e.message?.slice(0, 200));
    throw e;
  }
}

// ---------- Step 5: Flashcards ----------
async function stepFlashcards() {
  console.log('\n=== Step 5: 重新生成闪卡 ===');

  if (dryRun) {
    console.log('[DRY RUN] 将重新生成所有视频的句型卡 + 听力卡\n');
    return;
  }

  try {
    execSync(`npx tsx "${path.join(__dirname, 'regenerate-flashcards.mjs')}"`, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      timeout: 7200_000,
    });
  } catch (e) {
    console.error('闪卡生成失败:', e.message?.slice(0, 200));
    throw e;
  }
}

// ---------- Main ----------
async function main() {
  console.log('╔════════════════════════════════╗');
  console.log('║  流水线: ASR → 翻译 → Quiz → 闪卡  ║');
  console.log('╚════════════════════════════════╝\n');

  if (dryRun) {
    console.log('🔍 DRY RUN 模式 — 不会实际修改文件\n');
  }

  loadEnv();

  // Find all videos needing ASR
  const asrVideos = findAsrNeeded();
  console.log(`发现 ${asrVideos.length} 个视频需要 ASR:\n${asrVideos.map(id => `  - ${id}`).join('\n')}\n`);

  // Step 0: ASR
  await stepAsr(asrVideos);

  // Step 1-2: Clean old data
  stepCleanTranslations(asrVideos);
  stepCleanQuiz(asrVideos);

  // Step 3: Translation
  await stepTranslate();

  // Step 4: Quiz
  await stepQuiz();

  // Step 5: Flashcards
  await stepFlashcards();

  console.log('\n╔════════════════════════════════╗');
  console.log('║        🎉 流水线完成！          ║');
  console.log('╚════════════════════════════════╝');
}

main().catch(e => { console.error('\n流水线失败:', e); process.exit(1); });
