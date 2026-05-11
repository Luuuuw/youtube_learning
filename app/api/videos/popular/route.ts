import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ACTIVITY_FILE = path.join(process.cwd(), 'data', 'activity.json');
const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

interface DailyActivity {
  date: string;
  code: string;
  videoIds: string[];
}

interface VideoMetaBasic {
  id: string;
  title: string;
  thumbnail?: string;
  category?: string;
  difficulty?: string;
  duration?: number;
}

function readActivities(): DailyActivity[] {
  try {
    if (!fs.existsSync(ACTIVITY_FILE)) return [];
    const raw = fs.readFileSync(ACTIVITY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function getVideoMeta(videoId: string): VideoMetaBasic | null {
  try {
    const metaPath = path.join(CONTENT_DIR, videoId, 'meta.json');
    if (!fs.existsSync(metaPath)) return null;
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const meta = JSON.parse(raw);
    return {
      id: videoId,
      title: meta.title || videoId,
      thumbnail: meta.thumbnail?.startsWith('/') ? meta.thumbnail : meta.thumbnail ? `/content/${videoId}/${meta.thumbnail}` : undefined,
      category: meta.category,
      difficulty: meta.difficulty,
      duration: meta.duration,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const activities = readActivities();

  const viewCounts = new Map<string, number>();
  for (const act of activities) {
    for (const vid of act.videoIds) {
      viewCounts.set(vid, (viewCounts.get(vid) || 0) + 1);
    }
  }

  const sorted = Array.from(viewCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  const limit = Math.min(sorted.length, 3);
  const topVideos = sorted.slice(0, limit).map(([videoId, count]) => {
    const meta = getVideoMeta(videoId);
    return {
      ...meta,
      viewCount: count,
    };
  }).filter(v => v !== null);

  return NextResponse.json({
    totalRecorded: sorted.length,
    videos: topVideos,
  });
}
