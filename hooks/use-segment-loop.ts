'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

interface SegmentLoopRange {
  startTime: number;
  endTime: number;
}

export function useSegmentLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const [segmentLoopRange, setSegmentLoopRange] = useState<SegmentLoopRange | null>(null);
  const rangeRef = useRef(segmentLoopRange);
  rangeRef.current = segmentLoopRange;

  const cancelLoop = useCallback(() => setSegmentLoopRange(null), []);

  useEffect(() => {
    if (!segmentLoopRange) return;
    const video = videoRef.current;
    if (!video) return;

    let justWrapped = false;

    const onTime = () => {
      if (!video || !rangeRef.current) return;
      const t = video.currentTime;
      const { startTime, endTime } = rangeRef.current;

      if (t >= endTime - 0.05) {
        video.currentTime = startTime;
        justWrapped = true;
        if (video.paused) {
          video.play().catch(() => {});
        }
        return;
      }

      if (!justWrapped && t < startTime - 0.1) {
        setSegmentLoopRange(null);
        return;
      }
      justWrapped = false;
    };

    const onEnded = () => setSegmentLoopRange(null);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
    };
  }, [segmentLoopRange, videoRef]);

  return { segmentLoopRange, setSegmentLoopRange, cancelLoop };
}
