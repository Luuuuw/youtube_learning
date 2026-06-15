// Cue-level 翻译状态持久化
// 目的：进程崩了 / Render 实例重启 / 用户重复点"一键处理"时，已翻译的 cue 不重复跑 API。
//
// 文件位置：public/content/<videoId>/.translate-state.json
// Key 形态：`${startTime.toFixed(3)}-${endTime.toFixed(3)}`，与 zh-Hans.json 一致
// 写入策略：每批 MiniMax / DeepSeek 完成后写一次（原子写入避免半截文件）。
//
// 文件生命周期：zh-Hans.vtt 存在时主路径会 early-return，state 文件自然不再被读取；
// 翻译失败/中断时 state 文件作为下次续译的恢复点，保留即可。

import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';

// 用函数而非顶层常量，方便测试切换 cwd，也避免模块加载顺序锁定 prod 目录
function contentDir(): string {
  return path.join(process.cwd(), 'public', 'content');
}

export type CueSource = 'minimax' | 'deepseek' | 'nonspeech';

export interface CueState {
  en: string;
  zh: string;
  source: CueSource;
  status: 'done' | 'failed';
  attempts?: number;
  updatedAt: string;
}

export interface TranslateState {
  videoId: string;
  startedAt: string;
  updatedAt: string;
  totalCues: number;
  cues: Record<string, CueState>;
}

export function cueKey(startTime: number, endTime: number): string {
  return `${startTime.toFixed(3)}-${endTime.toFixed(3)}`;
}

function statePath(videoId: string): string {
  return path.join(contentDir(), videoId, '.translate-state.json');
}

export function loadState(videoId: string): TranslateState | null {
  const p = statePath(videoId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as TranslateState;
    if (!parsed || typeof parsed !== 'object' || !parsed.cues) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function initState(videoId: string, totalCues: number, existing?: TranslateState | null): TranslateState {
  if (existing && existing.videoId === videoId) {
    return { ...existing, totalCues, updatedAt: new Date().toISOString() };
  }
  const now = new Date().toISOString();
  return { videoId, startedAt: now, updatedAt: now, totalCues, cues: {} };
}

export function saveState(state: TranslateState): void {
  state.updatedAt = new Date().toISOString();
  try {
    atomicWriteJsonSync(statePath(state.videoId), state);
  } catch (err) {
    // 状态写盘失败不阻塞翻译主流程，只记日志
    console.error(`[translate-state] saveState ${state.videoId} failed:`, (err as Error).message);
  }
}

export function markDone(
  state: TranslateState,
  key: string,
  en: string,
  zh: string,
  source: CueSource,
): void {
  const prev = state.cues[key];
  state.cues[key] = {
    en,
    zh,
    source,
    status: 'done',
    attempts: (prev?.attempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function markFailed(state: TranslateState, key: string, en: string): void {
  const prev = state.cues[key];
  state.cues[key] = {
    en,
    zh: prev?.zh || '',
    source: prev?.source || 'minimax',
    status: 'failed',
    attempts: (prev?.attempts ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function isDone(state: TranslateState, key: string): boolean {
  const cue = state.cues[key];
  return Boolean(cue && cue.status === 'done' && cue.zh);
}

export function getDoneTranslation(
  state: TranslateState,
  key: string,
  currentEn?: string,
): string | null {
  const cue = state.cues[key];
  if (!cue || cue.status !== 'done' || !cue.zh) return null;
  // 英文条目变了（重下载、字幕源切换）说明缓存失效
  if (currentEn !== undefined && cue.en && cue.en !== currentEn) return null;
  return cue.zh;
}

export function countDone(state: TranslateState): number {
  let n = 0;
  for (const c of Object.values(state.cues)) {
    if (c.status === 'done' && c.zh) n++;
  }
  return n;
}
