import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '@/lib/data-dir';

// 内容数据（卡片库）随代码打包在 git 的 ./data 下，运行时数据（用户/复习进度）在 DATA_DIR。
// 当 DATA_DIR 指向独立磁盘（如 Render Disk /var/data）时，首次启动把内容数据从 git 拷贝过去。
const BUNDLED_DIR = path.join(process.cwd(), 'data');

function isEmptyArrayFile(file: string): boolean {
  try {
    const raw = fs.readFileSync(file, 'utf-8').trim();
    return raw === '' || raw === '[]';
  } catch {
    return true; // 不存在 / 不可读 → 视为空
  }
}

export function seedBundledFlashcards(): void {
  if (path.resolve(DATA_DIR) === path.resolve(BUNDLED_DIR)) return;

  const src = path.join(BUNDLED_DIR, 'flashcards.json');
  const dest = path.join(DATA_DIR, 'flashcards.json');
  if (!fs.existsSync(src)) return;

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (isEmptyArrayFile(dest)) {
      fs.copyFileSync(src, dest);
      console.log('[seed-data] 已从 git 拷贝 flashcards.json 到 DATA_DIR');
    }
  } catch (err) {
    console.warn('[seed-data] seed flashcards skipped:', (err as Error).message);
  }
}

// 系统级词汇（用户自动查词/预热缓存积累的公共词库）随代码打包在 git 的 ./data/vocab-system.json，
// 空盘首次启动时播种到 DATA_DIR/vocab.json。用户自建词在 DATA_DIR 持久盘，不会被覆盖。
export function seedBundledVocab(): void {
  if (path.resolve(DATA_DIR) === path.resolve(BUNDLED_DIR)) return;

  const src = path.join(BUNDLED_DIR, 'vocab-system.json');
  const dest = path.join(DATA_DIR, 'vocab.json');
  if (!fs.existsSync(src)) return;

  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (isEmptyArrayFile(dest)) {
      fs.copyFileSync(src, dest);
      console.log('[seed-data] 已从 git 拷贝 vocab-system.json 到 DATA_DIR/vocab.json');
    }
  } catch (err) {
    console.warn('[seed-data] seed vocab skipped:', (err as Error).message);
  }
}
