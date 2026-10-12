const CDN_BASE = (process.env.NEXT_PUBLIC_VIDEO_CDN_BASE || '').replace(/\/+$/, '');

// 兜底 CDN（原 Cloudflare R2，文件结构与主 CDN 相同 <id>/<file>，仍保留全部视频）
const FALLBACK_CDN_BASE = 'https://pub-82722694f18f4462a60b6409c4970237.r2.dev';

export function getVideoUrl(videoId: string, file: string = 'video.mp4'): string {
  if (CDN_BASE) {
    return `${CDN_BASE}/${videoId}/${file}`;
  }
  return `/content/${videoId}/${file}`;
}

// 从主 URL 派生兜底 URL：换掉 origin、保留路径（路径已含 codec 后缀）。
// 本地相对路径无兜底，返回空数组。
export function getFallbackUrls(primaryUrl: string): string[] {
  if (!primaryUrl.startsWith('http')) return [];
  try {
    const path = new URL(primaryUrl).pathname;
    if (!path || path === '/') return [];
    const fb = `${FALLBACK_CDN_BASE}${path}`;
    return fb === primaryUrl ? [] : [fb];
  } catch {
    return [];
  }
}

export function hasCdn(): boolean {
  return CDN_BASE.length > 0;
}
