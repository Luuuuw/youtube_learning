// 视频健康度计算：聚合每个视频的字幕完整度、quiz 题量、文件齐全度、meta 完整度，
// 给出 0-100 综合评分 + 人话问题列表，供 admin 看板使用。
//
// 评分权重：
//   - 翻译完整度 40 分（线性映射 zhCoverage）
//   - Quiz 题量 30 分（>= 10 题满分，线性递增）
//   - 文件齐全 20 分（mp4 / thumbnail / en.vtt / zh.vtt / meta 各 4 分）
//   - Meta 完整 10 分（title / accent / category / difficulty 都填）

import fs from 'fs';
import path from 'path';
import { VideoMeta } from '@/types/video';
import { getVideoList } from '@/lib/videos';

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const CDN_BASE = (process.env.NEXT_PUBLIC_VIDEO_CDN_BASE || '').replace(/\/+$/, '');
const HAS_CDN = CDN_BASE.length > 0;

export interface VideoHealth {
  videoId: string;
  title: string;
  duration: number;
  accent?: string;
  category?: string;
  difficulty?: string;
  downloadedAt?: string;
  thumbnailUrl?: string;

  zhCueTotal: number;
  zhCueFilled: number;
  zhCoverage: number;

  quizTotal: number;
  quizEasy: number;
  quizMedium: number;
  quizHard: number;

  hasMp4: boolean;
  hasThumbnail: boolean;
  hasEnVtt: boolean;
  hasZhVtt: boolean;
  hasMeta: boolean;
  hasQuiz: boolean;

  metaComplete: boolean;
  fileSizeMB: number;

  healthScore: number;
  issues: string[];
}

export interface DashboardSummary {
  totalVideos: number;
  totalDurationMin: number;
  totalStorageMB: number;
  totalQuiz: number;
  avgCoverage: number;
  incompleteCount: number;
}

// 简单 VTT cue 解析：保留空文本 cue（关键，用来识别"漏译"）
// 不复用 lib/vtt-parser 是因为 parseVttPreserveCues 也会丢空 cue
function parseVttCues(content: string): { start: number; end: number; text: string }[] {
  const cues: { start: number; end: number; text: string }[] = [];
  const lines = content.split(/\r?\n/);
  const pat = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pat);
    if (!m) continue;
    const s = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
    const e = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000;
    let txt = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim() || lines[j].match(pat)) break;
      txt += (txt ? '\n' : '') + lines[j];
    }
    cues.push({ start: s, end: e, text: txt.trim() });
  }
  return cues;
}

function computeZhCoverage(videoId: string): { total: number; filled: number; coverage: number } {
  const zhVttPath = path.join(CONTENT_DIR, videoId, 'video.zh-Hans.vtt');
  if (!fs.existsSync(zhVttPath)) return { total: 0, filled: 0, coverage: 0 };
  try {
    const cues = parseVttCues(fs.readFileSync(zhVttPath, 'utf-8'));
    const total = cues.length;
    const filled = cues.filter(c => c.text).length;
    return { total, filled, coverage: total ? filled / total : 0 };
  } catch {
    return { total: 0, filled: 0, coverage: 0 };
  }
}

function readQuizStats(videoId: string): { total: number; easy: number; medium: number; hard: number } {
  const p = path.join(CONTENT_DIR, videoId, 'quiz-bank.json');
  if (!fs.existsSync(p)) return { total: 0, easy: 0, medium: 0, hard: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      total: typeof raw.totalQuestions === 'number' ? raw.totalQuestions : (raw.questions?.length || 0),
      easy: raw.stats?.easy || 0,
      medium: raw.stats?.medium || 0,
      hard: raw.stats?.hard || 0,
    };
  } catch {
    return { total: 0, easy: 0, medium: 0, hard: 0 };
  }
}

function statSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export function computeVideoHealth(meta: VideoMeta): VideoHealth {
  const dir = path.join(CONTENT_DIR, meta.id);
  const enVttPath = path.join(dir, 'video.en.vtt');
  const zhVttPath = path.join(dir, 'video.zh-Hans.vtt');
  const mp4Path = path.join(dir, 'video.mp4');
  const thumbPath = path.join(dir, 'thumbnail.jpg');
  const metaPath = path.join(dir, 'meta.json');
  const quizPath = path.join(dir, 'quiz-bank.json');

  const hasEnVtt = fs.existsSync(enVttPath);
  const hasZhVtt = fs.existsSync(zhVttPath);
  const hasMp4 = fs.existsSync(mp4Path);
  const hasThumbnail = fs.existsSync(thumbPath);
  const hasMeta = fs.existsSync(metaPath);
  const hasQuiz = fs.existsSync(quizPath);

  const zh = computeZhCoverage(meta.id);
  const quiz = readQuizStats(meta.id);

  // 文件大小：仅 mp4（最大头）。CDN 模式下没有本地 mp4，记为 0；UI 用 hasMp4 单独标。
  const fileSizeBytes = hasMp4 ? statSize(mp4Path) : 0;
  const fileSizeMB = Math.round((fileSizeBytes / 1024 / 1024) * 10) / 10;

  const metaComplete = Boolean(meta.title && meta.accent && meta.category && meta.difficulty);

  // 评分
  // CDN 模式下，"本地无 mp4 但 meta 在" 是正常状态（mp4 在 R2），不扣分；
  // 仅当本地+meta 都无 mp4 时（即真没下载）扣分。具体的"R2 上是否真存在"
  // 由 batch_downloader.py 在下载侧探测维护——看板信任 meta 的存在。
  const mp4Ok = hasMp4 || (HAS_CDN && hasMeta);
  const coverageScore = zh.coverage * 40;
  const quizScore = Math.min(quiz.total / 10, 1) * 30;
  const fileScore = (
    (mp4Ok ? 4 : 0) +
    (hasThumbnail ? 4 : 0) +
    (hasEnVtt ? 4 : 0) +
    (hasZhVtt ? 4 : 0) +
    (hasMeta ? 4 : 0)
  );
  const metaScore = metaComplete ? 10 : 0;
  const healthScore = Math.round(coverageScore + quizScore + fileScore + metaScore);

  const issues: string[] = [];
  if (zh.total > 0 && zh.coverage < 1) {
    issues.push(`翻译缺 ${zh.total - zh.filled} 条`);
  } else if (zh.total === 0) {
    issues.push('无中文字幕');
  }
  if (quiz.total === 0) issues.push('无 quiz');
  else if (quiz.total < 10) issues.push(`quiz 仅 ${quiz.total} 题`);
  if (!mp4Ok) issues.push('无 MP4');
  if (!hasThumbnail) issues.push('无缩略图');
  if (!hasEnVtt) issues.push('无英文字幕');
  if (!metaComplete) {
    const miss: string[] = [];
    if (!meta.accent) miss.push('口音');
    if (!meta.category) miss.push('分类');
    if (!meta.difficulty) miss.push('难度');
    if (miss.length) issues.push(`meta 缺：${miss.join('/')}`);
  }

  return {
    videoId: meta.id,
    title: meta.title,
    duration: meta.duration || 0,
    accent: meta.accent,
    category: meta.category,
    difficulty: meta.difficulty,
    downloadedAt: meta.downloadedAt,
    thumbnailUrl: meta.thumbnail,
    zhCueTotal: zh.total,
    zhCueFilled: zh.filled,
    zhCoverage: zh.coverage,
    quizTotal: quiz.total,
    quizEasy: quiz.easy,
    quizMedium: quiz.medium,
    quizHard: quiz.hard,
    hasMp4,
    hasThumbnail,
    hasEnVtt,
    hasZhVtt,
    hasMeta,
    hasQuiz,
    metaComplete,
    fileSizeMB,
    healthScore,
    issues,
  };
}

export function computeAllVideoHealth(): { videos: VideoHealth[]; summary: DashboardSummary } {
  const list = getVideoList();
  const videos = list.map(computeVideoHealth);
  const summary: DashboardSummary = {
    totalVideos: videos.length,
    totalDurationMin: Math.round(videos.reduce((s, v) => s + v.duration, 0) / 60),
    totalStorageMB: Math.round(videos.reduce((s, v) => s + v.fileSizeMB, 0)),
    totalQuiz: videos.reduce((s, v) => s + v.quizTotal, 0),
    avgCoverage: videos.length
      ? videos.reduce((s, v) => s + v.zhCoverage, 0) / videos.length
      : 0,
    incompleteCount: videos.filter(v => v.healthScore < 80).length,
  };
  return { videos, summary };
}
