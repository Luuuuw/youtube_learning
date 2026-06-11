import { useState, useEffect, useRef, useCallback } from 'react';
import { Subtitle } from '@/lib/vtt-parser';
import { binarySearchSubtitleIndex } from '@/lib/subtitle-sync';

export function useSubtitleSync(subtitles: Subtitle[], currentTime: number) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const lastCurrentTimeRef = useRef(currentTime);
  const activeIndexRef = useRef(-1);

  useEffect(() => {
    const nextIndex = binarySearchSubtitleIndex(subtitles, currentTime);
    if (nextIndex !== activeIndexRef.current) {
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    }
  }, [currentTime, subtitles]);

  const handleSeekDetection = useCallback((autoScrollProp: boolean) => {
    const previousTime = lastCurrentTimeRef.current;
    const seeked = Math.abs(currentTime - previousTime) > 1.5;
    lastCurrentTimeRef.current = currentTime;
    return seeked && autoScrollProp;
  }, [currentTime]);

  return {
    activeIndex,
    setActiveIndex,
    handleSeekDetection,
  };
}
