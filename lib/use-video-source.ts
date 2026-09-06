'use client';

import { useEffect, useState } from 'react';

const AV1_CODEC = 'video/mp4; codecs="av01.0.05M.08"';
const HEVC_CODEC = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

const cache: Record<string, boolean | null> = { av1: null, hevc: null };

function browserCanPlay(codec: string, key: string): boolean {
  if (cache[key] !== null) return cache[key] as boolean;
  if (typeof document === 'undefined') return true; // SSR 默认按支持处理，客户端挂载后再校正
  try {
    const v = document.createElement('video');
    const t = v.canPlayType(codec);
    cache[key] = t !== ''; // '' = 不支持；'maybe'/'probably' = 支持
  } catch {
    cache[key] = false;
  }
  return cache[key] as boolean;
}

export function canPlayAv1(): boolean {
  return browserCanPlay(AV1_CODEC, 'av1');
}

function canPlayHevc(): boolean {
  return browserCanPlay(HEVC_CODEC, 'hevc');
}

/** 同目录 HEVC 版本的 URL（原文件是 xxx/video.mp4） */
export function hevcSiblingUrl(videoUrl: string): string {
  return videoUrl.replace(/video\.mp4$/, 'video.hevc.mp4');
}

/** 同目录 H.264 版本的 URL（仅作 HEVC 也不支持时的兜底） */
export function h264SiblingUrl(videoUrl: string): string {
  return videoUrl.replace(/video\.mp4$/, 'video.h264.mp4');
}

/**
 * iPad/旧 iPhone 的 Safari 不支持 AV1。给定当前 AV1 地址，
 * 设备能解码 AV1 就用原地址，否则切到同目录的 HEVC 版（video.hevc.mp4）。
 */
export function usePlayableVideoUrl(videoUrl: string): string {
  const [src, setSrc] = useState(videoUrl);
  useEffect(() => {
    if (canPlayAv1()) {
      setSrc(videoUrl);
    } else if (canPlayHevc()) {
      setSrc(hevcSiblingUrl(videoUrl));
    } else {
      setSrc(h264SiblingUrl(videoUrl));
    }
  }, [videoUrl]);
  return src;
}
