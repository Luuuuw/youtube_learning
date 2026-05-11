import { useState, useCallback } from 'react';
import { Subtitle } from '@/lib/vtt-parser';

export function useSubtitleEdit(
  videoId: string,
  subtitles: Subtitle[],
  zhSubtitles: Subtitle[],
  subtitleZhMap: Map<number, string>,
  onUpdate?: (zhSubtitles: Subtitle[]) => void
) {
  const [editMode, setEditMode] = useState(false);
  const [editMap, setEditMap] = useState<Map<number, string>>(new Map());
  const [saving, setSaving] = useState(false);

  const enterEditMode = useCallback(() => {
    const map = new Map<number, string>();
    for (const enSub of subtitles) {
      map.set(enSub.id, subtitleZhMap.get(enSub.id) ?? '');
    }
    setEditMap(map);
    setEditMode(true);
  }, [subtitles, subtitleZhMap]);

  const cancelEditMode = useCallback(() => {
    setEditMode(false);
    setEditMap(new Map());
  }, []);

  const handleEditChange = useCallback((id: number, value: string) => {
    setEditMap((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!videoId || saving) return;

    setSaving(true);
    try {
      const updatedZhSubtitles = subtitles.map((s) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        text: (editMap.get(s.id) ?? subtitleZhMap.get(s.id) ?? '').trim(),
      }));

      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const response = await fetch('/api/save-subtitles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          videoId,
          subtitles: updatedZhSubtitles,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');

      onUpdate?.(data.zhSubtitles || updatedZhSubtitles);
      setEditMode(false);
      setEditMap(new Map());
    } catch (e: unknown) {
      throw e instanceof Error ? e : new Error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [videoId, saving, subtitles, editMap, subtitleZhMap, onUpdate]);

  return {
    editMode,
    editMap,
    saving,
    enterEditMode,
    cancelEditMode,
    handleEditChange,
    handleSave,
  };
}
