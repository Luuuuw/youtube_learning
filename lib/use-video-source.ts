'use client';

import { useCallback, useEffect, useState } from 'react';
import { getFallbackUrls } from '@/lib/video-cdn';

const AV1_CODEC = 'video/mp4; codecs="av01.0.05M.08"';

const av1Cache: { value: boolean | null } = { value: null };

export function canPlayAv1(): boolean {
  if (av1Cache.value !== null) return av1Cache.value;
  if (typeof document === 'undefined') return true; // SSR 默认按支持处理，客户端挂载后再校正
  try {
    const v = document.createElement('video');
    av1Cache.value = v.canPlayType(AV1_CODEC) !== ''; // '' = 不支持；'maybe'/'probably' = 支持
  } catch {
    av1Cache.value = false;
  }
  return av1Cache.value;
}

/** 同目录 HEVC 版本的 URL（原文件是 xxx/video.mp4） */
export function hevcSiblingUrl(videoUrl: string): string {
  return videoUrl.replace(/video\.mp4$/, 'video.hevc.mp4');
}

/**
 * 按「本设备最可能可播」排序的编解码候选：
 * - AV1 直解设备：video.mp4 优先，HEVC 兜底
 * - 其余（iPad / 旧 iPhone 等）：HEVC 优先，video.mp4 兜底
 *
 * 刻意不依赖 canPlayType 对 HEVC 的判断：iOS Safari 对
 * 'hvc1.1.6.L93.B0' 这类带 level/constraint 的具体串常返回 ''，
 * 即便设备实际能播 HEVC，会导致误判成「都不支持」而选中不存在的
 * H.264 变体 → 全部视频 404。改为把 HEVC 与 AV1 都放进候选，
 * 由 <video onError> 在浏览器真正解不了时前进到下一个。
 */
function codecCandidates(videoUrl: string): string[] {
  const hevc = hevcSiblingUrl(videoUrl);
  return canPlayAv1() ? [videoUrl, hevc] : [hevc, videoUrl];
}

/**
 * 编解码适配 + 主 CDN(COS) 与兜底 CDN(R2) 兜底：返回当前应播放的 src，
 * 以及 advance()——在 <video onError> 时前进到下一个源。
 * 顺序（以非 AV1 设备为例）：HEVC@COS → HEVC@R2 → video.mp4@COS → video.mp4@R2。
 * AV1 设备：video.mp4@COS → video.mp4@R2 → HEVC@COS → HEVC@R2。
 */
export function useVideoSourceWithFallback(videoUrl: string): {
  src: string;
  advance: () => void;
} {
  const [sources, setSources] = useState<string[]>(() => [videoUrl]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const list = codecCandidates(videoUrl).flatMap(u => [u, ...getFallbackUrls(u)]);
    setSources(Array.from(new Set(list.filter(Boolean))));
    setIndex(0);
  }, [videoUrl]);

  const advance = useCallback(() => {
    setIndex(i => Math.min(i + 1, sources.length - 1));
  }, [sources.length]);

  return { src: sources[Math.min(index, sources.length - 1)] ?? videoUrl, advance };
}
