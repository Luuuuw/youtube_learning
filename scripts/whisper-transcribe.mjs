// Groq Whisper 转录脚本
// 用法: node scripts/whisper-transcribe.mjs <videoId> [--dry-run]
//
// 流程:
//   1. ffmpeg 提取音频 → 16kHz mono MP3
//   2. 调用 Groq Whisper API (whisper-large-v3)
//   3. 保存原始 JSON → data/whisper-raw/<videoId>.json
//   4. 构建 VTT → public/content/<videoId>/video.en.vtt
//   5. 备份旧 VTT → video.en.vtt.old

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');
const RAW_DIR = path.join(PROJECT_ROOT, 'data', 'whisper-raw');
const BIN_FFMPEG = path.join(PROJECT_ROOT, 'bin', 'ffmpeg.exe');
const TMP_DIR = path.join(PROJECT_ROOT, 'data', 'whisper-tmp');

const GROQ_API = 'https://api.groq.com/openai/v1/audio/transcriptions';
const MODEL = 'whisper-large-v3';

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

function loadProxy() {
  const proxyPath = path.join(PROJECT_ROOT, 'proxy_config.json');
  if (fs.existsSync(proxyPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(proxyPath, 'utf-8'));
      return cfg.proxy || null;
    } catch { return null; }
  }
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  const args = process.argv.slice(2);
  const videoId = args.find(a => !a.startsWith('--'));
  const isDryRun = args.includes('--dry-run');

  if (!videoId) {
    console.error('用法: node scripts/whisper-transcribe.mjs <videoId> [--dry-run]');
    process.exit(1);
  }

  loadEnv();
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('[whisper] GROQ_API_KEY 未配置（.env.local）');
    process.exit(1);
  }

  const videoDir = path.join(CONTENT_DIR, videoId);
  const videoPath = path.join(videoDir, 'video.mp4');
  if (!fs.existsSync(videoPath)) {
    console.error(`[whisper] 视频不存在: ${videoPath}`);
    process.exit(1);
  }

  ensureDir(RAW_DIR);
  ensureDir(TMP_DIR);

  // Step 1: 尝试不同码率，确保音频 ≤ 25MB
  const audioPath = path.join(TMP_DIR, `${videoId}.mp3`);
  let audioSize = Infinity;
  for (const bitrate of ['64k', '48k', '32k', '24k']) {
    console.log(`[whisper] 提取音频 (${bitrate}): ${videoId}`);
    execSync(
      `"${BIN_FFMPEG}" -i "${videoPath}" -f mp3 -vn -acodec libmp3lame -ac 1 -ar 16000 -b:a ${bitrate} "${audioPath}" -y`,
      { stdio: 'pipe', timeout: 300000 }
    );
    audioSize = fs.statSync(audioPath).size;
    const audioMB = (audioSize / (1024 * 1024)).toFixed(1);
    console.log(`[whisper] 音频: ${audioMB} MB`);
    if (audioSize <= 25 * 1024 * 1024) break;
    console.log(`[whisper] 超过 25MB，降低码率重试...`);
  }
  if (audioSize > 25 * 1024 * 1024) {
    console.error(`[whisper] 音频超过 25MB，已尝试最低码率。需分段处理。`);
    process.exit(1);
  }

  // Step 2: 调用 Groq API（429 自动重试）
  const proxy = loadProxy();
  const fetchOptions = {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: null, // set below
    signal: AbortSignal.timeout(180_000),
  };
  if (proxy) {
    fetchOptions.dispatcher = new ProxyAgent(proxy);
    console.log(`[whisper] 代理: ${proxy}`);
  }

  let resp;
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const formData = new FormData();
    const audioBuf = new Uint8Array(fs.readFileSync(audioPath));
    formData.append('file', new Blob([audioBuf], { type: 'audio/mp3' }), `${videoId}.mp3`);
    formData.append('model', MODEL);
    formData.append('response_format', 'verbose_json');
    formData.append('timestamp_granularities[]', 'word');
    fetchOptions.body = formData;
    fetchOptions.signal = AbortSignal.timeout(180_000);

    if (attempt === 0) {
      console.log(`[whisper] 调用 Groq Whisper API...`);
    }
    resp = await fetch(GROQ_API, fetchOptions);

    if (resp.ok) break;

    const errText = await resp.text();
    if (resp.status === 429) {
      let waitMs = 60_000; // 默认等 1 分钟
      try {
        const errJson = JSON.parse(errText);
        const msg = errJson.error?.message || '';
        const tryMatch = msg.match(/try again in (?:(\d+)m)?(\d+(?:\.\d+)?)s/);
        if (tryMatch) {
          const minutes = parseInt(tryMatch[1]) || 0;
          const seconds = parseFloat(tryMatch[2]) || 0;
          waitMs = (minutes * 60 + seconds) * 1000 + 3000; // +3s buffer
        }
      } catch {}
      const waitSec = Math.round(waitMs / 1000);
      console.log(`[whisper] 速率限制，等待 ${waitSec}s ... (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    console.error(`[whisper] API 错误 ${resp.status}: ${errText}`);
    process.exit(1);
  }

  if (!resp?.ok) {
    console.error(`[whisper] ${maxRetries} 次重试后仍失败`);
    process.exit(1);
  }

  const data = await resp.json();
  console.log(`[whisper] 转录完成: ${data.words?.length || 0} 词, ${data.duration?.toFixed(1) || '?'} 秒`);

  // Step 3: 保存原始 JSON
  const rawPath = path.join(RAW_DIR, `${videoId}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(data, null, 2));
  console.log(`[whisper] 原始 JSON → ${rawPath}`);

  // Step 4: 标点 + 大小写恢复（DeepSeek），再构建 VTT
  const { restorePunctuation } = await import('../lib/whisper-punctuate.js');
  const { buildVttFromWhisper, buildVttFromWords } = await import('../lib/whisper-vtt-builder.js');
  const restoredText = await restorePunctuation(data.text || '', process.env.DEEPSEEK_API_KEY);
  const vtt = restoredText && restoredText !== data.text
    ? buildVttFromWhisper(restoredText, data.words || [])
    : buildVttFromWords(data.words || []);
  if (!vtt) {
    console.error('[whisper] 构建 VTT 失败：无词数据');
    process.exit(1);
  }

  // Step 5: 备份旧 VTT 并写入新 VTT
  const enVttPath = path.join(videoDir, 'video.en.vtt');
  const bakPath = path.join(videoDir, 'video.en.vtt.old');

  if (isDryRun) {
    console.log(`[whisper] DRY RUN — 将写入 ${enVttPath}`);
    console.log(vtt.slice(0, 500));
  } else {
    // 只有 old backup 不存在时才备份（保护原始 YouTube 字幕）
    if (!fs.existsSync(bakPath) && fs.existsSync(enVttPath)) {
      fs.copyFileSync(enVttPath, bakPath);
      console.log(`[whisper] 备份 → ${bakPath}`);
    }
    fs.writeFileSync(enVttPath, vtt);
    console.log(`[whisper] VTT → ${enVttPath} (${vtt.length} bytes)`);
  }

  // 清理临时音频
  try { fs.unlinkSync(audioPath); } catch {}

  console.log('[whisper] 完成');
}

main().catch(err => {
  console.error('[whisper]', err);
  process.exit(1);
});
