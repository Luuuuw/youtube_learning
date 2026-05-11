import { Subtitle } from './vtt-parser';

const CACHE_KEY_PREFIX = 'vibe-zh-subtitles-';
const CACHE_META_PREFIX = 'vibe-zh-meta-';

function getSubtitleHash(subtitles: Subtitle[]): string {
  let hash = 0;
  for (const sub of subtitles) {
    const str = `${sub.id}:${sub.startTime}:${sub.endTime}:${sub.text}`;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
  }
  return Math.abs(hash).toString(36);
}

export function getCachedZhSubtitles(videoId: string, enSubtitles: Subtitle[]): Subtitle[] | null {
  try {
    const metaKey = CACHE_META_PREFIX + videoId;
    const metaRaw = localStorage.getItem(metaKey);
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw);
    const currentHash = getSubtitleHash(enSubtitles);
    if (meta.hash !== currentHash) return null;

    const dataKey = CACHE_KEY_PREFIX + videoId;
    const dataRaw = localStorage.getItem(dataKey);
    if (!dataRaw) return null;

    return JSON.parse(dataRaw) as Subtitle[];
  } catch {
    return null;
  }
}

export function setCachedZhSubtitles(videoId: string, enSubtitles: Subtitle[], zhSubtitles: Subtitle[]): void {
  try {
    const hash = getSubtitleHash(enSubtitles);
    const metaKey = CACHE_META_PREFIX + videoId;
    const dataKey = CACHE_KEY_PREFIX + videoId;

    localStorage.setItem(metaKey, JSON.stringify({ hash, updatedAt: Date.now() }));
    localStorage.setItem(dataKey, JSON.stringify(zhSubtitles));
  } catch {
    // ignore storage errors (e.g. quota exceeded)
  }
}

export function clearTranslationCache(videoId?: string): void {
  try {
    if (videoId) {
      localStorage.removeItem(CACHE_META_PREFIX + videoId);
      localStorage.removeItem(CACHE_KEY_PREFIX + videoId);
    } else {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith(CACHE_KEY_PREFIX) || key.startsWith(CACHE_META_PREFIX))) {
          localStorage.removeItem(key);
        }
      }
    }
  } catch {
    // ignore
  }
}
