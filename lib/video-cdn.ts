const CDN_BASE = (process.env.NEXT_PUBLIC_VIDEO_CDN_BASE || '').replace(/\/+$/, '');

export function getVideoUrl(videoId: string, file: string = 'video.mp4'): string {
  if (CDN_BASE) {
    return `${CDN_BASE}/${videoId}/${file}`;
  }
  return `/content/${videoId}/${file}`;
}

export function hasCdn(): boolean {
  return CDN_BASE.length > 0;
}
