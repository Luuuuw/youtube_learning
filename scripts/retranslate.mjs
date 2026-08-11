// 强制重建中文翻译（删除旧翻译后调用 pipeline）
// 用法: node scripts/retranslate.mjs <videoId> [videoId...]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONTENT_DIR = path.join(PROJECT_ROOT, 'public', 'content');

const videoIds = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (videoIds.length === 0) {
  console.error('用法: node scripts/retranslate.mjs <videoId> [videoId...]');
  process.exit(1);
}

async function main() {
  // Load .env.local
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }

  // Dynamically import the pipeline
  const { translateVideoFromRawVtt } = await import('../lib/translate/pipeline.js');

  let done = 0;
  for (const id of videoIds) {
    const zhJson = path.join(CONTENT_DIR, id, 'video.zh-Hans.json');
    const zhVtt = path.join(CONTENT_DIR, id, 'video.zh-Hans.vtt');

    // Delete old translations to force full retranslation
    try { fs.unlinkSync(zhJson); } catch {}
    try { fs.unlinkSync(zhVtt); } catch {}

    console.log(`[${++done}/${videoIds.length}] ${id} ...`);
    try {
      const subs = await translateVideoFromRawVtt(id);
      console.log(`  OK (${subs.length} subtitles)`);
    } catch (e) {
      console.error(`  FAIL: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
