import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '@/lib/atomic-write';
import { DATA_DIR } from '@/lib/data-dir';

const DB_DIR = DATA_DIR;
const ACTIVITY_FILE = path.join(DB_DIR, 'activity.json');

export interface DailyActivity {
  date: string;
  code: string;
  videoIds: string[];
}

function ensureDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(ACTIVITY_FILE)) {
    fs.writeFileSync(ACTIVITY_FILE, '[]', 'utf-8');
  }
}

function readActivities(): DailyActivity[] {
  ensureDb();
  try {
    const raw = fs.readFileSync(ACTIVITY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeActivities(data: DailyActivity[]) {
  ensureDb();
  atomicWriteJsonSync(ACTIVITY_FILE, data);
}

export function recordView(code: string, videoId: string): void {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const today = `${y}-${m}-${d}`;
  const activities = readActivities();
  const existing = activities.find(a => a.date === today && a.code === code);
  if (existing) {
    if (!existing.videoIds.includes(videoId)) {
      existing.videoIds.push(videoId);
    }
  } else {
    activities.push({ date: today, code, videoIds: [videoId] });
  }
  writeActivities(activities);
}

export function getCalendarData(code: string, year: number, month: number): DailyActivity[] {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const activities = readActivities();
  return activities.filter(a => a.date.startsWith(prefix) && a.code === code);
}

export function getRecentActivity(code: string, days: number = 90): DailyActivity[] {
  const activities = readActivities();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return activities.filter(a => a.date >= cutoffStr && a.code === code);
}
