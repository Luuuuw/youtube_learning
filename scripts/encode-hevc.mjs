// 为所有 AV1 视频生成 iPad/旧 iPhone Safari 可解码的 HEVC(H.265) 副本 video.hevc.mp4
// HEVC Main profile + hvc1 tag，iOS Safari 从 iOS11 起支持。
// 用法（在仓库根目录运行）：
//   node scripts/encode-hevc.mjs                     # 全量，跳过已生成的
//   node scripts/encode-hevc.mjs <id> <id>...        # 只处理指定视频
//   node scripts/encode-hevc.mjs --dry-run           # 只列出将要编码的
//   node scripts/encode-hevc.mjs --encoder qsv       # 强制 qsv | libx265
//   node scripts/encode-hevc.mjs --gq 28             # 质量(仅硬件编码生效)
import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(__dirname, '..', 'public', 'content');
const LOCAL_BIN = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');

const args = process.argv.slice(2);
const idsArg = args.filter(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const encArg = (args.find(a => a.startsWith('--encoder=')) || '').split('=')[1] || 'auto';
const gqArg = Number((args.find(a => a.startsWith('--gq=')) || '--gq=28').split('=')[1]);

function ffBin() {
  if (process.env.FFMPEG && existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
  if (existsSync(LOCAL_BIN)) return LOCAL_BIN;
  return 'ffmpeg';
}
function ffprobeBin() {
  const f = ffBin();
  if (f !== 'ffmpeg') {
    const p = path.join(path.dirname(f), 'ffprobe.exe');
    if (existsSync(p)) return p;
  }
  return 'ffprobe';
}

const FFMPEG = ffBin();
const FFPROBE = ffprobeBin();

function run(cmd, inputArgs, opts = {}) {
  return spawnSync(cmd, inputArgs, { encoding: 'utf-8', ...opts });
}

// 探测可用的 HEVC 编码器（快测 15 帧），优先硬件，回退软件 libx265
function detectEncoder(prefer) {
  if (prefer && prefer !== 'auto') {
    if (prefer === 'libx265') return { enc: 'libx265', label: 'libx265 (软件)' };
    const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-frames:v', '15', '-c:v', `hevc_${prefer}`, '-f', 'null', '-']);
    if (r.status === 0) return { enc: `hevc_${prefer}`, label: `hevc_${prefer}` };
    console.warn(`hevc_${prefer} 不可用，回退自动检测`);
  }
  for (const hw of ['qsv', 'nvenc', 'amf']) {
    const r = run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-frames:v', '15', '-c:v', `hevc_${hw}`, '-f', 'null', '-']);
    if (r.status === 0) return { enc: `hevc_${hw}`, label: `hevc_${hw}` };
  }
  return { enc: 'libx265', label: 'libx265 (软件)' };
}

function buildVideoArgs(enc, q) {
  if (enc.startsWith('hevc_')) {
    return ['-c:v', enc, '-global_quality', String(q), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-tag:v', 'hvc1'];
  }
  return ['-c:v', 'libx265', '-crf', String(Math.max(24, q - 3)), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'];
}

function probeCodec(mp4) {
  const r = run(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', mp4]);
  return (r.stdout || '').trim();
}

function probeDuration(mp4) {
  const r = run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]);
  return parseFloat(r.stdout) || 0;
}

const dirs = existsSync(CONTENT)
  ? readdirSync(CONTENT, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
  : [];
const targets = (idsArg.length ? idsArg : dirs)
  .filter(id => existsSync(path.join(CONTENT, id, 'video.mp4')))
  .sort();

const encoder = detectEncoder(encArg === 'auto' ? null : encArg);
const quality = gqArg || 28;

let pending = 0;
for (const id of targets) {
  const mp4 = path.join(CONTENT, id, 'video.mp4');
  const out = path.join(CONTENT, id, 'video.hevc.mp4');
  const codec = probeCodec(mp4);
  if (codec !== 'av1') {
    if (codec === 'h264' || codec === '') console.log(`SKIP  ${id}  非 AV1 (${codec || '未知'})，无需转码`);
    else console.log(`SKIP  ${id}  编码 ${codec} 无需处理`);
    continue;
  }
  if (existsSync(out) && statSync(out).size > 0) {
    console.log(`SKIP  ${id}  已存在 video.hevc.mp4`);
    continue;
  }
  pending++;
  if (dryRun) { console.log(`TODO  ${id}  ${mp4}`); continue; }

  const dur = probeDuration(mp4);
  const t0 = Date.now();
  const r = run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', mp4,
    '-map', '0:v:0', '-map', '0:a:0?',
    ...buildVideoArgs(encoder.enc, quality),
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', '+faststart', out,
  ]);
  const sec = ((Date.now() - t0) / 1000).toFixed(0);
  if (r.status === 0) {
    const mb = (statSync(out).size / 1024 / 1024).toFixed(0);
    console.log(`DONE  ${id}  ${dur ? `时长${dur.toFixed(0)}s` : ''} ${sec}s -> ${mb}MB`);
  } else {
    console.log(`FAIL  ${id}  (${(r.stderr || r.error?.message || '').slice(0, 300)})`);
  }
}

console.log(`\n[encode-hevc] 编码器=${encoder.label} 质量=${quality} 待处理=${dryRun ? pending : '已跑完'}`);
