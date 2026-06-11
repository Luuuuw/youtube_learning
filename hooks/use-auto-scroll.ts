import { useState, useCallback, useRef, useEffect } from 'react';

const AUTO_RESUME_DELAY = 3000;
const PROGRAMMATIC_SCROLL_LOCK_MS = 240;

export function useAutoScroll(autoScrollProp: boolean) {
  const [followActiveSubtitle, setFollowActiveSubtitle] = useState(autoScrollProp);
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setFollowActiveSubtitle(autoScrollProp);
  }, [autoScrollProp]);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const handleScroll = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    if (programmaticScrollRef.current || !autoScrollProp) return;

    setFollowActiveSubtitle(false);
    clearResumeTimer();

    resumeTimerRef.current = setTimeout(() => {
      setFollowActiveSubtitle(true);
    }, AUTO_RESUME_DELAY);
  }, [autoScrollProp, clearResumeTimer]);

  const handleResumeAutoScroll = useCallback(() => {
    if (!autoScrollProp) return;

    clearResumeTimer();
    setFollowActiveSubtitle(true);
  }, [autoScrollProp, clearResumeTimer]);

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior) => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const allRows = viewport.querySelectorAll('[data-subtitle-id]');
    const target = allRows[index] as HTMLElement | undefined;
    if (!target) return;

    programmaticScrollRef.current = true;
    target.scrollIntoView({ behavior, block: 'center' });

    window.setTimeout(() => {
      programmaticScrollRef.current = false;
    }, PROGRAMMATIC_SCROLL_LOCK_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  return {
    followActiveSubtitle,
    setFollowActiveSubtitle,
    scrollViewportRef,
    handleScroll,
    handleResumeAutoScroll,
    scrollToIndex,
  };
}
