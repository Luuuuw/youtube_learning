import { useState, useEffect, useCallback } from 'react';
import { Subtitle } from '@/lib/vtt-parser';

export function useSubtitleTranslation(
  videoId: string,
  subtitles: Subtitle[],
  initialZhSubtitles: Subtitle[],
  onUpdate?: (zhSubtitles: Subtitle[]) => void
) {
  const [zhSubtitles, setZhSubtitles] = useState<Subtitle[]>(initialZhSubtitles);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setZhSubtitles(initialZhSubtitles);
  }, [initialZhSubtitles]);

  const translate = useCallback(async () => {
    if (translating || !videoId || subtitles.length === 0) return;
    if (zhSubtitles.length > 0) return;

    setTranslating(true);
    setError('');
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const response = await fetch('/api/translate-subtitles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          videoId,
          subtitles: subtitles.map((s) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            text: s.text,
          })),
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '翻译失败');

      if (data.zhSubtitles?.length > 0) {
        setZhSubtitles(data.zhSubtitles);
        onUpdate?.(data.zhSubtitles);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '翻译失败');
    } finally {
      setTranslating(false);
    }
  }, [translating, videoId, subtitles, zhSubtitles.length, onUpdate]);

  const hasZhSubtitles = zhSubtitles.length > 0 || subtitles.some(s => !!s.translation);

  return {
    zhSubtitles,
    setZhSubtitles,
    translating,
    error,
    translate,
    hasZhSubtitles,
  };
}
