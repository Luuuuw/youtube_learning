'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface LearningCalendarProps {
  userCode: string | null;
  role: string | null;
}

export default function LearningCalendar({ userCode, role }: LearningCalendarProps) {
  const [activities, setActivities] = useState<Record<string, number>>({});
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const fetchCalendar = useCallback(async () => {
    if (!userCode || role === 'admin') return;
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/activity/calendar', {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      if (res.ok) {
        const data: { date: string; videoIds: string[] }[] = await res.json();
        const map: Record<string, number> = {};
        data.forEach(d => { map[d.date] = d.videoIds.length; });
        setActivities(map);
      }
    } catch {}
  }, [userCode]);

  useEffect(() => {
    fetchCalendar();
    const interval = setInterval(fetchCalendar, 30000);
    const handleRefresh = () => fetchCalendar();
    window.addEventListener('ve-activity-recorded', handleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('ve-activity-recorded', handleRefresh);
    };
  }, [fetchCalendar]);

  const getLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const DAYS = 21;
  const today = new Date();
  const days: { date: string; count: number; isToday: boolean; label: string }[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = getLocalDate(d);
    days.push({
      date: key,
      count: activities[key] || 0,
      isToday: i === 0,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
    });
  }

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if ((activities[getLocalDate(d)] || 0) > 0) streak++;
    else break;
  }

  const totalVideos = Object.values(activities).reduce((s, v) => s + v, 0);
  const activeDays = Object.values(activities).filter(v => v > 0).length;

  const getDotStyle = (count: number, idx: number) => {
    if (count === 0) return 'bg-muted-foreground/15';
    if (count === 1) return 'bg-green-900/80 shadow-sm shadow-green-900/30';
    if (count === 2) return 'bg-green-700/85 shadow-sm shadow-green-700/40';
    if (count === 3) return 'bg-green-500/90 shadow-sm shadow-green-500/50';
    return 'bg-emerald-400 shadow-md shadow-emerald-400/60';
  };

  if (!userCode || role === 'admin') return null;

  return (
    <div className="group relative">
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 h-9 rounded-xl bg-card border border-border hover:border-primary/30 transition-all duration-300 cursor-default">
        <div className="flex flex-col items-center gap-0.5 mr-0.5 sm:mr-1">
          <span className={`text-[9px] sm:text-[10px] font-bold leading-none ${streak >= 7 ? 'text-orange-400' : streak >= 3 ? 'text-amber-400' : 'text-muted-foreground'}`}>
            {streak}
          </span>
          <span className="text-[7px] sm:text-[8px] text-muted-foreground leading-none">天</span>
        </div>

        <div className="w-px h-6 sm:h-8 bg-border" />

        <div className="grid grid-cols-7 gap-[2px] sm:gap-[3px]" style={{ perspective: '600px' }}>
          {days.map((day, i) => (
            <button
              key={i}
              onMouseEnter={() => setHoverCell(day.date)}
              onMouseLeave={() => setHoverCell(null)}
              className={`w-[9px] h-[9px] sm:w-[11px] sm:h-[11px] rounded-sm transition-all duration-200 ${getDotStyle(day.count, i)} ${
                day.isToday ? 'ring-1 ring-primary/50 scale-110 z-10' : 'hover:scale-125 hover:z-10'
              } ${
                day.count > 0 && !day.isToday ? 'group-hover:brightness-110' : ''
              }`}
            />
          ))}
        </div>


      </div>

      {hoverCell && activities[hoverCell] !== undefined && (
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 px-3 py-2 bg-popover border border-border rounded-lg shadow-xl text-xs whitespace-nowrap animate-in fade-in slide-in-from-top-2 duration-150"
        >
          {(() => {
            const d = new Date(hoverCell + 'T00:00:00');
            const cnt = activities[hoverCell];
            return (
              <>
                <div className="font-medium">{d.getFullYear()}年{d.getMonth() + 1}月{d.getDate()}日</div>
                {cnt > 0 ? (
                  <div className="text-muted-foreground mt-0.5">
                    学习了 <span className="text-green-400 font-semibold">{cnt}</span> 个视频
                  </div>
                ) : (
                  <div className="text-muted-foreground mt-0.5">未学习</div>
                )}
              </>
            );
          })()}
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-popover border-l border-t border-border" />
        </div>
      )}
    </div>
  );
}
