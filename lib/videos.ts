import fs from 'fs';
import path from 'path';
import { parseVtt, Subtitle } from '@/lib/vtt-parser';
import { VideoMeta } from '@/types/video';

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
}

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');
const VALID_VIDEO_ID = /^[a-zA-Z0-9_-]+$/;

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
      thumbnail = `/content/${id}/thumbnail.jpg`;
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
    try {
      const zhJsonPath = path.join(CONTENT_DIR, id, 'video.zh-Hans.json');
      const zhVttPath = path.join(CONTENT_DIR, id, 'video.zh-Hans.vtt');

      if (fs.existsSync(zhJsonPath) && subtitles.length > 0) {
        const jsonMap = JSON.parse(fs.readFileSync(zhJsonPath, 'utf-8'));
        zhSubtitles = subtitles.map(sub => ({
          id: sub.id,
          startTime: sub.startTime,
          endTime: sub.endTime,
          text: jsonMap[sub.id] || '',
        }));
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

    return {
      id,
      title,
      description,
      duration,
      thumbnail,
      videoUrl: `/content/${id}/video.mp4`,
      subtitles,
      zhSubtitles,
    };
  } catch {
    return null;
  }
}