'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import { VideoMeta, CATEGORY_LABELS, DIFFICULTY_LABELS } from '@/types/video';
import AccentBadge from '@/components/accent-badge';

export default function VideoCardClient({ video }: { video: VideoMeta }) {
  const thumbnailSrc = video.thumbnail || null;

  const handleClick = () => {
    try {
      const raw = localStorage.getItem('vibe-click-counts');
      const counts: Record<string, number> = raw ? JSON.parse(raw) : {};
      counts[video.id] = (counts[video.id] || 0) + 1;
      localStorage.setItem('vibe-click-counts', JSON.stringify(counts));
    } catch {}
  };

  return (
    <Link href={`/${video.id}`} className="block group" onClick={handleClick}>
      <div className="bg-card rounded-xl overflow-hidden border border-border hover:border-white/20 transition-colors duration-300">
        <div className="aspect-video bg-muted relative flex items-center justify-center overflow-hidden">
          {thumbnailSrc ? (
            <img
              src={thumbnailSrc}
              alt={video.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <Play className="h-10 w-10 text-muted-foreground/30" />
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="p-3 bg-white/20 rounded-full backdrop-blur-sm">
                <Play className="h-6 w-6 text-white ml-0.5" />
              </div>
            </div>
          </div>
          {video.difficulty && (
            <div className="absolute top-2 right-2">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  color: DIFFICULTY_LABELS[video.difficulty].color,
                  backgroundColor: DIFFICULTY_LABELS[video.difficulty].bg,
                }}
              >
                {DIFFICULTY_LABELS[video.difficulty].label}
              </span>
            </div>
          )}
        </div>
        <div className="p-4 pb-5 flex flex-col h-[96px]">
          <h3 className="font-medium text-sm leading-snug group-hover:text-primary transition-colors line-clamp-2 min-h-[2.8em]">
            {video.title}
          </h3>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <AccentBadge accent={video.accent} />
            {video.category && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  color: CATEGORY_LABELS[video.category].color,
                  backgroundColor: `${CATEGORY_LABELS[video.category].color}15`,
                }}
              >
                {CATEGORY_LABELS[video.category].icon} {CATEGORY_LABELS[video.category].label}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}