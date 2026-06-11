import { Subtitle, WordTiming } from '@/lib/vtt-parser';

export function binarySearchSubtitleIndex(subtitles: Subtitle[], currentTime: number): number {
  let left = 0;
  let right = subtitles.length - 1;

  // Binary search keeps subtitle lookup fast even for 1000+ rows.
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const subtitle = subtitles[mid];

    if (currentTime < subtitle.startTime) {
      right = mid - 1;
      continue;
    }

    if (currentTime > subtitle.endTime) {
      left = mid + 1;
      continue;
    }

    return mid;
  }

  return -1;
}

export function getSubtitleAtTime(subtitles: Subtitle[], currentTime: number): Subtitle | null {
  const index = binarySearchSubtitleIndex(subtitles, currentTime);
  return index >= 0 ? subtitles[index] : null;
}

export function getActiveWordIndex(
  text: string,
  currentTime: number,
  startTime: number,
  endTime: number,
  wordTimings?: WordTiming[]
): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return -1;

  if (wordTimings && wordTimings.length === words.length) {
    for (let i = wordTimings.length - 1; i >= 0; i--) {
      if (currentTime >= wordTimings[i].startTime) {
        return i;
      }
    }
    return 0;
  }

  const duration = Math.max(endTime - startTime, 0.001);
  const progress = Math.max(0, Math.min(1, (currentTime - startTime) / duration));
  return Math.min(Math.floor(progress * words.length), words.length - 1);
}

export function buildSubtitleTranslationMap(
  subtitles: Subtitle[],
  translatedSubtitles: Subtitle[]
): Map<number, string> {
  const map = new Map<number, string>();
  if (subtitles.length === 0 || translatedSubtitles.length === 0) {
    return map;
  }

  const byTime = new Map<string, string>();
  for (const subtitle of translatedSubtitles) {
    const key = `${subtitle.startTime.toFixed(3)}-${subtitle.endTime.toFixed(3)}`;
    byTime.set(key, subtitle.text);
  }

  for (const subtitle of subtitles) {
    const exactTimeKey = `${subtitle.startTime.toFixed(3)}-${subtitle.endTime.toFixed(3)}`;
    const exactMatch = byTime.get(exactTimeKey);
    if (exactMatch) {
      map.set(subtitle.id, exactMatch);
    }
  }

  if (map.size === subtitles.length) {
    return map;
  }

  let cursor = 0;
  const usedTranslatedIndexes = new Set<number>();

  for (const subtitle of subtitles) {
    if (map.has(subtitle.id)) {
      continue;
    }

    let bestIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    const from = Math.max(0, cursor - 5);
    const to = Math.min(translatedSubtitles.length - 1, cursor + 20);

    for (let index = from; index <= to; index++) {
      if (usedTranslatedIndexes.has(index)) {
        continue;
      }

      const candidate = translatedSubtitles[index];
      const overlap = Math.max(
        0,
        Math.min(subtitle.endTime, candidate.endTime) -
          Math.max(subtitle.startTime, candidate.startTime)
      );
      const union =
        Math.max(subtitle.endTime, candidate.endTime) -
        Math.min(subtitle.startTime, candidate.startTime);
      const overlapRatio = union > 0 ? overlap / union : 0;
      const startDistance = Math.abs(subtitle.startTime - candidate.startTime);
      const hasText = candidate.text.trim().length > 0 ? 1 : 0;
      const score = overlapRatio * 3 - startDistance + hasText * 2;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      const candidate = translatedSubtitles[bestIndex];
      const startDistance = Math.abs(subtitle.startTime - candidate.startTime);
      const hasOverlap =
        Math.max(
          0,
          Math.min(subtitle.endTime, candidate.endTime) -
            Math.max(subtitle.startTime, candidate.startTime)
        ) > 0;

      if (hasOverlap || startDistance < 2) {
        map.set(subtitle.id, candidate.text);
        usedTranslatedIndexes.add(bestIndex);
        cursor = bestIndex;
      }
    }
  }

  return map;
}
