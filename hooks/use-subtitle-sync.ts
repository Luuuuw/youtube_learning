import { useState, useEffect, useRef } from 'react';
import { Subtitle } from '@/lib/vtt-parser';
import { binarySearchSubtitleIndex } from '@/lib/subtitle-sync';

export function useSubtitleSync(subtitles: Subtitle[], currentTime: number) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const lastCurrentTimeRef = useRef(currentTime);

  useEffect(() => {
    const nextIndex = binarySearchSubtitleIndex(subtitles, currentTime);
    if (nextIndex !== activeIndex) {
      setActiveIndex(nextIndex);
    }
  }, [activeIndex, currentTime, subtitles]);

  const handleSeekDetection = (autoScrollProp: boolean) => {
    const previousTime = lastCurrentTimeRef.current;
    const seeked = Math.abs(currentTime - previousTime) > 1.5;
    lastCurrentTimeRef.current = currentTime;
    return seeked && autoScrollProp;
  };

  return {
    activeIndex,
    setActiveIndex,
    handleSeekDetection,
  };
}
