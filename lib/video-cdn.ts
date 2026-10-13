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

// 图片等小静态资源直接走 R2（Cloudflare），避免从 Render 应用服务器出网（内地慢）。
export function getR2Url(videoId: string, file: string): string {
  return `${FALLBACK_CDN_BASE}/${videoId}/${file}`;
}

// 归一化 meta.thumbnail：/content/<id>/x.jpg 或裸文件名 → R2 绝对地址；已是 http(s) 的原样返回。
export function resolveThumbnailUrl(videoId: string, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  const prefix = `/content/${videoId}/`;
  const file = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\//, '');
  return getR2Url(videoId, file || 'thumbnail.jpg');
}
