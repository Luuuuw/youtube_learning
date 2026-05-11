'use client';

import { useState, useEffect } from 'react';
import { Brain, BookOpen, TrendingUp, Award, Calendar } from 'lucide-react';
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';

interface Stats {
  due: number;
  new: number;
  mastered: number;
  total: number;
}

interface WeeklyItem {
  date: string;
  remembered: number;
  forgotten: number;
}

interface CurveItem {
  date: string;
  total: number;
}

export default function VocabStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [weekly, setWeekly] = useState<WeeklyItem[]>([]);
  const [curve, setCurve] = useState<CurveItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    Promise.all([
      fetch('/api/vocab?type=stats', { headers }).then(r => r.json()),
      fetch('/api/vocab?type=weekly', { headers }).then(r => r.json()),
      fetch('/api/vocab?type=curve&days=30', { headers }).then(r => r.json()),
    ])
      .then(([s, w, c]) => {
        setStats(s);
        setWeekly(w.weekly || []);
        setCurve((c.curve || []).map((d: Record<string, unknown>) => ({ date: d.date as string, total: d.total as number })));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* 核心指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Brain className="h-4 w-4" />
            待复习
          </div>
          <div className="text-2xl font-bold">{stats.due}</div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <BookOpen className="h-4 w-4" />
            新词
          </div>
          <div className="text-2xl font-bold">{stats.new}</div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Award className="h-4 w-4" />
            已掌握
          </div>
          <div className="text-2xl font-bold">{stats.mastered}</div>
        </div>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <TrendingUp className="h-4 w-4" />
            总词汇
          </div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
      </div>

      {/* 学习曲线 */}
      {curve.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-muted-foreground">学习曲线</span>
            <span className="text-[10px] text-slate-400">
              {curve[0]?.date?.slice(0, 5)} — {curve[curve.length - 1]?.date?.slice(0, 5)}
            </span>
          </div>

          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={curve} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="none"
                stroke="#f1f5f9"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#cbd5e1' }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
                tickCount={5}
                tickFormatter={(v: string) => String(v).slice(0, 5)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#cbd5e1' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={24}
                tickCount={4}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  boxShadow: 'none',
                  fontSize: '12px',
                  padding: '6px 10px',
                  background: '#fff',
                }}
                labelStyle={{ color: '#94a3b8', fontSize: '11px' }}
                labelFormatter={(label: string) => {
                  const d = String(label).slice(0, 5);
                  return d;
                }}
                formatter={(value: number) => [value, '词']}
                cursor={{ stroke: '#a78bfa', strokeWidth: 1, strokeDasharray: '3 3' }}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="#a78bfa"
                strokeWidth={2}
                fill="url(#cg)"
                dot={false}
                activeDot={{ r: 4, fill: '#fff', stroke: '#a78bfa', strokeWidth: 1.5 }}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 周复习趋势 */}
      {weekly.length > 0 && (
        <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium mb-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            近7天复习趋势
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weekly} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="none" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: '#cbd5e1' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: string) => String(v).slice(5, 10)}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#cbd5e1' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={24}
                tickCount={4}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  boxShadow: 'none',
                  fontSize: '12px',
                  padding: '6px 10px',
                  background: '#fff',
                }}
                cursor={{ fill: '#f1f5f9', radius: 6 }}
              />
              <Bar dataKey="remembered" name="记住" stackId="a" fill="#34d399" radius={[0, 0, 4, 4]} maxBarSize={28} />
              <Bar dataKey="forgotten" name="遗忘" stackId="a" fill="#f87171" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
