'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Subtitle } from '@/lib/vtt-parser';

export function useSentenceLoop(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  subtitles: Subtitle[],
) {
  const [loopingSubId, setLoopingSubId] = useState<number | null>(null);
  const subIdRef = useRef(loopingSubId);
  subIdRef.current = loopingSubId;

  const cancelLoop = useCallback(() => setLoopingSubId(null), []);

  useEffect(() => {
    if (loopingSubId == null) return;
    const video = videoRef.current;
    if (!video) return;

    const sub = subtitles.find(s => s.id === loopingSubId);
    if (!sub) {
      setLoopingSubId(null);
      return;
    }

    let justWrapped = false;
    const { startTime, endTime } = sub;

    const onTime = () => {
      if (!video || subIdRef.current !== loopingSubId) return;
      const t = video.currentTime;

      if (t >= endTime - 0.05) {
        video.currentTime = startTime;
        justWrapped = true;
        if (video.paused) {
          video.play().catch(() => {});
        }
        return;
      }

      if (!justWrapped && t < startTime - 0.1) {
        setLoopingSubId(null);
        return;
      }
      justWrapped = false;
    };

    const onEnded = () => setLoopingSubId(null);

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('ended', onEnded);
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('ended', onEnded);
    };
  }, [loopingSubId, subtitles, videoRef]);

  return { loopingSubId, setLoopingSubId, cancelLoop };
}
