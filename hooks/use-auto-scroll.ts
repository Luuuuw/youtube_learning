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
    if (!viewport || index < 0 || index >= (viewport.children.length || 0)) return;

    const subtitleId = viewport.querySelector(`[data-subtitle-id]`) as HTMLElement | null;
    if (!subtitleId) return;

    programmaticScrollRef.current = true;
    subtitleId.scrollIntoView({ behavior, block: 'center' });

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
