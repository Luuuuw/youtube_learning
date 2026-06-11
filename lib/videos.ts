import fs from 'fs';
import path from 'path';
import { parseVtt, Subtitle } from '@/lib/vtt-parser';
import { VideoMeta } from '@/types/video';
import { getVideoUrl } from '@/lib/video-cdn';

export type { VideoMeta } from '@/types/video';

export interface VideoData {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  thumbnail?: string;
  videoUrl: string;
  subtitles: Subtitle[];
  zhSubtitles: Subtitle[];
  zhNeedsRetranslate?: boolean;
}

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

// 内存缓存：避免每次请求都重复读盘
const videoCache = new Map<string, { data: VideoData; cachedAt: number }>();
const CACHE_TTL_MS = 30 * 1000; // 30 秒
const globalForVideos = globalThis as unknown as { __videoCache?: Map<string, { data: VideoData; cachedAt: number }> };
const _videoCache = globalForVideos.__videoCache ?? videoCache;
if (!globalForVideos.__videoCache) globalForVideos.__videoCache = _videoCache;

function getCachedVideo(id: string): VideoData | null {
  const entry = _videoCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    _videoCache.delete(id);
    return null;
  }
  return entry.data;
}

function setCachedVideo(id: string, data: VideoData): void {
  _videoCache.set(id, { data, cachedAt: Date.now() });
}

export function invalidateVideoCache(id?: string): void {
  if (id) _videoCache.delete(id);
  else _videoCache.clear();
}

export function getVideoList(): VideoMeta[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];

  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(CONTENT_DIR);
  } catch {
    return [];
  }

  const videos: VideoMeta[] = [];

  for (const dir of dirs) {
    try {
      const metaPath = path.join(CONTENT_DIR, dir, 'meta.json');
      const videoPath = path.join(CONTENT_DIR, dir, 'video.mp4');

      if (!fs.existsSync(videoPath)) continue;

      if (fs.existsSync(metaPath)) {
        const raw = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(raw);
        videos.push({
          id: meta.id || dir,
          title: meta.title || dir,
          description: meta.description,
          duration: typeof meta.duration === 'number' ? meta.duration : undefined,
          thumbnail: meta.thumbnail,
          downloadedAt: meta.downloadedAt,
          accent: meta.accent,
          category: meta.category,
          difficulty: meta.difficulty,
        });
      } else {
        videos.push({ id: dir, title: dir });
      }
    } catch {
      continue;
    }
  }

  return videos;
}

export function getVideoById(id: string): VideoData | null {
  if (!VALID_VIDEO_ID.test(id)) return null;

  // 命中缓存直接返回
  const cached = getCachedVideo(id);
  if (cached) return cached;

  try {
    const videoPath = path.join(CONTENT_DIR, id, 'video.mp4');
    if (!fs.existsSync(videoPath)) return null;

    let title = id;
    let description: string | undefined;
    let duration: number | undefined;
    let thumbnail: string | undefined;

    const metaPath = path.join(CONTENT_DIR, id, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const raw = fs.readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(raw);
        title = meta.title || id;
        description = meta.description;
        duration = typeof meta.duration === 'number' ? meta.duration : undefined;
        thumbnail = meta.thumbnail;
      } catch {}
    }

    const thumbPath = path.join(CONTENT_DIR, id, 'thumbnail.jpg');
    if (!thumbnail && fs.existsSync(thumbPath)) {
      thumbnail = getVideoUrl(id, 'thumbnail.jpg');
    }

    let subtitles: Subtitle[] = [];
    try {
      const enVttPath = path.join(CONTENT_DIR, id, 'video.en.vtt');
      if (fs.existsSync(enVttPath)) {
        subtitles = parseVtt(fs.readFileSync(enVttPath, 'utf-8'));
      }
    } catch {
      subtitles = [];
    }

    let zhSubtitles: Subtitle[] = [];
    let zhNeedsRetranslate = false;
    try {
      const zhJsonPath = path.join(CONTENT_DIR, id, 'video.zh-Hans.json');
      const zhVttPath = path.join(CONTENT_DIR, id, 'video.zh-Hans.vtt');

      if (fs.existsSync(zhJsonPath) && subtitles.length > 0) {
        const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
        const entries = Object.entries(jsonMap) as [string, string][];
        const nonEmpty = entries.filter(([, v]) => v && v.trim());
        // If more than 50% translations are empty, mark for re-translation
        if (entries.length > 0 && nonEmpty.length / entries.length < 0.5) {
          zhNeedsRetranslate = true;
          zhSubtitles = [];
        } else {
          // 兼容两种 key 格式：时间戳 "startTime-endTime" 和旧版数字 ID
          const isTimestampKey = entries.some(([k]) => k.includes('-'));
          if (isTimestampKey) {
            // 新格式：用时间戳匹配
            // zh-Hans.json 的 key 通常是粗粒度合并段（如 1.964-63.039，跨数十秒），
            // 而 en.vtt 是细粒度短 cue（1-5 秒）。需要按"重叠"匹配：
            // 任何 en cue 的中点落在 zh segment 范围内，就显示该 zh 翻译。
            const zhSegments: { start: number; end: number; text: string }[] = [];
            for (const [k, v] of entries) {
              if (!v || !v.trim()) continue;
              const [s, e] = k.split('-').map(Number);
              if (!isNaN(s) && !isNaN(e) && e > s) {
                zhSegments.push({ start: s, end: e, text: v });
              }
            }
            zhSegments.sort((a, b) => a.start - b.start);

            const findZhText = (enStart: number, enEnd: number): string => {
              // 1) 精确双端匹配
              const exactKey = `${enStart.toFixed(3)}-${enEnd.toFixed(3)}`;
              for (const seg of zhSegments) {
                if (`${seg.start.toFixed(3)}-${seg.end.toFixed(3)}` === exactKey) {
                  return seg.text;
                }
              }
              // 2) en cue 的中点落在 zh segment 内（覆盖粗细粒度错配的主情况）
              const midpoint = (enStart + enEnd) / 2;
              for (const seg of zhSegments) {
                if (midpoint >= seg.start - 0.05 && midpoint < seg.end + 0.05) {
                  return seg.text;
                }
              }
              // 3) ±0.15s 双端模糊（兼容旧数据）
              for (const seg of zhSegments) {
                if (Math.abs(seg.start - enStart) < 0.15 && Math.abs(seg.end - enEnd) < 0.15) {
                  return seg.text;
                }
              }
              return '';
            };

            zhSubtitles = subtitles.map(sub => ({
              id: sub.id,
              startTime: sub.startTime,
              endTime: sub.endTime,
              text: findZhText(sub.startTime, sub.endTime),
            }));
          } else {
            // 旧格式：用数字 ID 匹配
            zhSubtitles = subtitles.map(sub => ({
              id: sub.id,
              startTime: sub.startTime,
              endTime: sub.endTime,
              text: jsonMap[sub.id] || '',
            }));
          }
        }
      } else if (fs.existsSync(zhVttPath)) {
        zhSubtitles = parseVtt(fs.readFileSync(zhVttPath, 'utf-8'), { preserveCues: true });
      }
    } catch {
      zhSubtitles = [];
    }

    if (subtitles.length > 0 && zhSubtitles.length > 0) {
      const zhMap = new Map(zhSubtitles.map(z => [z.id, z.text]));
      for (const sub of subtitles) {
        const translation = zhMap.get(sub.id);
        if (translation) {
          sub.translation = translation;
        }
      }
    }

    const result: VideoData = {
      id,
      title,
      description,
      duration,
      thumbnail,
      videoUrl: getVideoUrl(id, 'video.mp4'),
      subtitles,
      zhSubtitles,
      zhNeedsRetranslate,
    };
    setCachedVideo(id, result);
    return result;
  } catch {
    return null;
  }
}