import type { SubtitleItem } from './utils';

export function parseRawVttForTranslation(vttContent: string): SubtitleItem[] {
  const lines = vttContent.split('\n');
  const result: SubtitleItem[] = [];
  let id = 1;
  let prevText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim() || line.trim() === 'WEBVTT' || line.startsWith('Kind:') || line.startsWith('Language:')) {
      continue;
    }

    const timeMatch = line.match(
      /^(\d{2}):(\d{2}):(\d{2})[\.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[\.](\d{3})/
    );
    const shortTimeMatch = line.match(
      /^(\d{2}):(\d{2})[\.](\d{3})\s*-->\s*(\d{2}):(\d{2})[\.](\d{3})/
    );

    if (timeMatch || shortTimeMatch) {
      const textLines: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTime = nextLine.match(
          /^(\d{2}):(\d{2}):(\d{2})[\.](\d{3})\s*-->/
        ) || nextLine.match(
          /^(\d{2}):(\d{2})[\.](\d{3})\s*-->/
        );
        if (nextTime) break;
        if (nextLine.trim()) {
          textLines.push(nextLine.trim());
        }
        j++;
      }

      if (textLines.length >= 2) {
        const targetLine = textLines[1];
        const cleaned = targetLine
          .replace(/<\d+:\d+\.\d+><c>/g, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleaned && cleaned.length > 0 && cleaned !== prevText) {
          result.push({ id: id++, text: cleaned });
          prevText = cleaned;
        }
      }
    }
  }

  return result;
}
