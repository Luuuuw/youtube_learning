'use client';

import { useEffect, useState } from 'react';

let av1Cached: boolean | null = null;

function browserCanPlayAv1(): boolean {
  if (av1Cached !== null) return av1Cached;
  if (typeof document === 'undefined') return true; // SSR 阶段默认按支持处理，客户端挂载后再校正
  try {
    const v = document.createElement('video');
    const t = v.canPlayType('video/mp4; codecs="av01.0.05M.08"');
    av1Cached = t !== ''; // '' = 不支持；'maybe'/'probably' = 支持
  } catch {
    av1Cached = false;
  }
  return av1Cached;
}

export function supportsAv1(): boolean {
  return browserCanPlayAv1();
}

/** 返回同目录 H.264 版本的 URL（原文件是 xxx/video.mp4） */
export function h264SiblingUrl(videoUrl: string): string {
  return videoUrl.replace(/video\.mp4$/, 'video.h264.mp4');
}

/**
 * iPad/旧 iPhone 的 Safari 不支持 AV1。给定当前 AV1 地址，
 * 若设备无法解码 AV1 则切到同目录的 video.h264.mp4。
 */
export function usePlayableVideoUrl(videoUrl: string): string {
  const [src, setSrc] = useState(videoUrl);
  useEffect(() => {
    setSrc(browserCanPlayAv1() ? videoUrl : h264SiblingUrl(videoUrl));
  }, [videoUrl]);
  return src;
}
