'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { getVideoUrl } from '@/lib/video-cdn';

interface Props {
  videoId: string;
  startTime: number;
  endTime?: number;
  autoPlay?: boolean;
}

export interface FlashcardAudioHandle {
  replay: () => void;
}

const FlashcardAudio = forwardRef<FlashcardAudioHandle, Props>(function FlashcardAudio(
  { videoId, startTime, endTime, autoPlay = true },
  ref,
) {
  const actualEnd = endTime ?? startTime + 4;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [played, setPlayed] = useState(0);

  const replay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    try {
      v.currentTime = startTime;
      setPlayed(0);
      v.play().catch(() => { /* autoplay may be blocked */ });
    } catch { /* ignore */ }
  }, [startTime]);

  useImperativeHandle(ref, () => ({ replay }), [replay]);

  // 挂载 / 区间变化时，跳到 startTime，根据 autoPlay 决定播放
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const seek = () => {
      try {
        v.currentTime = startTime;
        setPlayed(0);
        if (autoPlay) v.play().catch(() => { /* ignore */ });
      } catch { /* ignore */ }
    };
    if (v.readyState >= 1) {
      seek();
    } else {
      v.addEventListener('loadedmetadata', seek, { once: true });
      return () => v.removeEventListener('loadedmetadata', seek);
    }
  }, [videoId, startTime, autoPlay]);

  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const cur = v.currentTime;
    setPlayed(Math.max(0, cur - startTime));
    if (cur >= actualEnd) {
      v.pause();
    }
  };

  const span = Math.max(0.001, actualEnd - startTime);
  const pct = Math.min(100, (played / span) * 100);

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <video
        ref={videoRef}
        src={getVideoUrl(videoId)}
        onTimeUpdate={handleTimeUpdate}
        preload="metadata"
        playsInline
        className="w-full max-h-48 rounded-lg bg-black"
      />

      <div className="mt-3">
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-100"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
          <span>
            [{startTime.toFixed(1)}s - {actualEnd.toFixed(1)}s] 已播 {played.toFixed(1)}s
          </span>
          <button
            type="button"
            onClick={replay}
            title="重播 (A)"
            className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
});

export default FlashcardAudio;
