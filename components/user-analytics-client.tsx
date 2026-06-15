'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users, Activity, Wifi, BookOpenCheck, AlertTriangle,
  ArrowUpDown, Search, X, ChevronRight, ShieldCheck, UserX,
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

interface UserStat {
  username: string;
  role: 'admin' | 'guest';
  disabled: boolean;
  createdAt: string;
  vocabTotal: number;
  vocabNew: number;
  vocabMastered: number;
  reviewsLast30d: number;
  reviewSuccessRate: number;
  videosLast7d: number;
  videosTotalDistinct: number;
  lastLoginAt: string | null;
  loginsLast30d: number;
  failedLoginsLast30d: number;
  isOnline: boolean;
  activitySpark7d: number[];
}

interface Summary {
  totalUsers: number;
  activeUsers7d: number;
  activeUsers30d: number;
  onlineCount: number;
  totalVocab: number;
  totalReviews30d: number;
  totalVideoViews7d: number;
  failedLogins7d: number;
}

interface DauPoint { date: string; activeUsers: number; }
interface TopVideo { videoId: string; title: string; views: number; uniqueUsers: number; }

interface Analytics {
  summary: Summary;
  users: UserStat[];
  dauCurve: DauPoint[];
  topVideos: TopVideo[];
}

interface UserDetail {
  username: string;
  learningCurve: { date: string; total: number; newWords: number; reviewed: number }[];
  activity30d: { date: string; videoCount: number }[];
  recentVideos: { date: string; videoId: string; title: string }[];
}

type SortKey = 'username' | 'vocabTotal' | 'reviewsLast30d' | 'videosLast7d' | 'lastLogin' | 'createdAt';

function getAuthHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function UserAnalyticsClient() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'guest'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'disabled' | 'active7d'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('videosLast7d');
  const [sortAsc, setSortAsc] = useState(false);

  const [detailUser, setDetailUser] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/user-analytics', { headers: getAuthHeaders() })
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(d => setData(d))
      .catch(e => setErr(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  const openDetail = useCallback((username: string) => {
    setDetailUser(username);
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/admin/user-analytics?user=${encodeURIComponent(username)}`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : null)
      .then(d => setDetail(d))
      .finally(() => setDetailLoading(false));
  }, []);

  const closeDetail = useCallback(() => {
    setDetailUser(null);
    setDetail(null);
  }, []);

  useEffect(() => {
    if (!detailUser) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailUser, closeDetail]);

  const filteredSorted = useMemo(() => {
    if (!data) return [];
    let list = data.users.slice();
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(u => u.username.toLowerCase().includes(s));
    }
    if (roleFilter !== 'all') list = list.filter(u => u.role === roleFilter);
    if (statusFilter === 'online') list = list.filter(u => u.isOnline);
    else if (statusFilter === 'disabled') list = list.filter(u => u.disabled);
    else if (statusFilter === 'active7d') list = list.filter(u => u.videosLast7d > 0);

    list.sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0;
      if (sortKey === 'username') { av = a.username; bv = b.username; }
      else if (sortKey === 'vocabTotal') { av = a.vocabTotal; bv = b.vocabTotal; }
      else if (sortKey === 'reviewsLast30d') { av = a.reviewsLast30d; bv = b.reviewsLast30d; }
      else if (sortKey === 'videosLast7d') { av = a.videosLast7d; bv = b.videosLast7d; }
      else if (sortKey === 'lastLogin') {
        av = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
        bv = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      } else if (sortKey === 'createdAt') {
        av = new Date(a.createdAt).getTime();
        bv = new Date(b.createdAt).getTime();
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
    });
    return list;
  }, [data, search, roleFilter, statusFilter, sortKey, sortAsc]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortAsc(s => !s);
    else { setSortKey(k); setSortAsc(false); }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }
  if (err) return <div className="text-sm text-red-500">加载失败：{err}</div>;
  if (!data) return null;

  const { summary, users, dauCurve, topVideos } = data;

  return (
    <>
      {/* 顶部 KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={Users} color="text-blue-500" bg="bg-blue-500/10"
          label="用户总数" value={String(summary.totalUsers)}
          sub={`${users.filter(u => u.role === 'admin').length} admin · ${users.filter(u => u.role === 'guest').length} guest`}
        />
        <KpiCard
          icon={Activity} color="text-emerald-500" bg="bg-emerald-500/10"
          label="7 日活跃" value={`${summary.activeUsers7d}/${summary.totalUsers}`}
          sub={`30 日 ${summary.activeUsers30d} 人`}
        />
        <KpiCard
          icon={Wifi} color="text-indigo-500" bg="bg-indigo-500/10"
          label="当前在线" value={String(summary.onlineCount)}
          sub={`${summary.totalVideoViews7d} 次观看·近 7 日`}
        />
        <KpiCard
          icon={BookOpenCheck} color="text-purple-500" bg="bg-purple-500/10"
          label="30 日复习次数" value={String(summary.totalReviews30d)}
          sub={`词汇总数 ${summary.totalVocab}`}
        />
      </div>

      {summary.failedLogins7d > 0 && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-8 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <span>近 7 日有 <b>{summary.failedLogins7d}</b> 次登录失败，检查账户安全</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* DAU 曲线 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold mb-1">日活用户（DAU）</h2>
          <p className="text-xs text-muted-foreground mb-4">最近 30 天每日活跃用户数</p>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dauCurve} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="dauGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.55} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                formatter={(value) => [Number(value), '活跃用户']}
              />
              <Area type="monotone" dataKey="activeUsers" stroke="#3b82f6" fill="url(#dauGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* 热门视频 */}
        <div className="bg-card border border-border rounded-xl p-6">
          <h2 className="text-base font-semibold mb-1">热门视频（7 日）</h2>
          <p className="text-xs text-muted-foreground mb-4">按观看次数 top 10</p>
          {topVideos.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">最近 7 日无观看记录</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={topVideos.map(v => ({ ...v, name: v.title.length > 22 ? v.title.slice(0, 20) + '…' : v.title }))}
                layout="vertical"
                margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  formatter={(value, name, item) => {
                    if (name === 'views') {
                      const u = (item?.payload as TopVideo | undefined)?.uniqueUsers ?? 0;
                      return [`${Number(value)} 次 · ${u} 人`, '观看'];
                    }
                    return [String(value), String(name)];
                  }}
                />
                <Bar dataKey="views" radius={[0, 4, 4, 0]}>
                  {topVideos.map((_, i) => <Cell key={i} fill="#6366f1" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 用户表格 */}
      <div className="bg-card border border-border rounded-xl">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row gap-3 sm:items-center">
          <h2 className="text-base font-semibold mr-auto">用户（{filteredSorted.length}）</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜用户名"
                className="pl-8 pr-3 py-1.5 text-sm bg-muted/50 border border-border rounded-md w-36 outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value as typeof roleFilter)}
              className="py-1.5 px-2 text-sm bg-muted/50 border border-border rounded-md outline-none"
            >
              <option value="all">全部角色</option>
              <option value="admin">admin</option>
              <option value="guest">guest</option>
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="py-1.5 px-2 text-sm bg-muted/50 border border-border rounded-md outline-none"
            >
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="active7d">7 日活跃</option>
              <option value="disabled">已禁用</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <Th label="用户" k="username" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="词汇" k="vocabTotal" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <th className="text-left font-medium px-3 py-3">复习成功率</th>
                <Th label="30 日复习" k="reviewsLast30d" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="7 日活跃" k="videosLast7d" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="上次登录" k="lastLogin" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <Th label="注册" k="createdAt" sortKey={sortKey} sortAsc={sortAsc} onClick={toggleSort} />
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredSorted.map(u => (
                <tr
                  key={u.username}
                  onClick={() => openDetail(u.username)}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3 max-w-[180px]">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${u.isOnline ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} title={u.isOnline ? '在线' : '离线'} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{u.username}</span>
                          <RoleBadge role={u.role} />
                          {u.disabled && <span title="已禁用"><UserX className="h-3 w-3 text-red-500" /></span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium">{u.vocabTotal}</div>
                    <div className="text-[10px] text-muted-foreground">{u.vocabNew} 新 · {u.vocabMastered} 熟</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <SuccessRate rate={u.reviewSuccessRate} reviewed={u.reviewsLast30d} />
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm font-medium">{u.reviewsLast30d}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium tabular-nums w-4 text-right">{u.videosLast7d}</span>
                      <Sparkline data={u.activitySpark7d} />
                    </div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">{relativeTime(u.lastLoginAt)}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-xs text-muted-foreground">{u.createdAt.slice(0, 10)}</td>
                  <td className="px-3 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </td>
                </tr>
              ))}
              {filteredSorted.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">没有匹配的用户</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {detailUser && (
        <UserDetailModal
          username={detailUser}
          detail={detail}
          loading={detailLoading}
          onClose={closeDetail}
        />
      )}
    </>
  );
}

function KpiCard({
  icon: Icon, color, bg, label, value, sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`inline-flex p-2 rounded-lg ${bg} ${color} mb-3`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
      {sub && <div className="text-xs text-muted-foreground/70 mt-1">{sub}</div>}
    </div>
  );
}

function Th({
  label, k, sortKey, sortAsc, onClick,
}: { label: string; k: SortKey; sortKey: SortKey; sortAsc: boolean; onClick: (k: SortKey) => void }) {
  const active = sortKey === k;
  return (
    <th className="text-left font-medium px-3 py-3 whitespace-nowrap">
      <button
        onClick={() => onClick(k)}
        className={`inline-flex items-center gap-1 ${active ? 'text-foreground' : 'text-muted-foreground'} hover:text-foreground`}
      >
        {label}
        <ArrowUpDown className={`h-3 w-3 ${active ? 'opacity-100' : 'opacity-40'} ${active && !sortAsc ? '' : 'rotate-180'}`} />
      </button>
    </th>
  );
}

function RoleBadge({ role }: { role: 'admin' | 'guest' }) {
  if (role === 'admin') {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 rounded">
        <ShieldCheck className="h-2.5 w-2.5" />admin
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground border border-border rounded">
      guest
    </span>
  );
}

function SuccessRate({ rate, reviewed }: { rate: number; reviewed: number }) {
  if (reviewed === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = rate * 100;
  const color = rate >= 0.8 ? 'bg-emerald-500' : rate >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="min-w-[80px]">
      <div className="text-xs mb-1">{pct.toFixed(0)}%</div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  return (
    <div className="flex items-end gap-px h-5">
      {data.map((v, i) => (
        <div
          key={i}
          className={`w-1 rounded-sm ${v > 0 ? 'bg-blue-500' : 'bg-muted'}`}
          style={{ height: `${Math.max(2, (v / max) * 20)}px` }}
          title={`${v}`}
        />
      ))}
    </div>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return '从未';
  const now = Date.now();
  const t = new Date(iso).getTime();
  if (isNaN(t)) return '—';
  const diff = now - t;
  const mins = diff / 60000;
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${Math.floor(mins)} 分钟前`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)} 小时前`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)} 天前`;
  return new Date(iso).toISOString().slice(0, 10);
}

function UserDetailModal({
  username, detail, loading, onClose,
}: {
  username: string;
  detail: UserDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center gap-3">
          <div className="text-base font-semibold">{username}</div>
          <span className="text-xs text-muted-foreground">用户详情</span>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading && (
            <div className="h-40 bg-muted rounded animate-pulse" />
          )}
          {!loading && !detail && (
            <div className="text-sm text-red-500">加载详情失败</div>
          )}
          {detail && (
            <>
              {/* 词汇曲线 */}
              <section>
                <h3 className="text-sm font-medium mb-2">词汇曲线（30 天）</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={detail.learningCurve} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <defs>
                      <linearGradient id="lcGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      formatter={(value, name) => {
                        const labelMap: Record<string, string> = { total: '累计', newWords: '新增', reviewed: '复习' };
                        return [Number(value), labelMap[String(name)] || String(name)];
                      }}
                    />
                    <Area type="monotone" dataKey="total" stroke="#a855f7" fill="url(#lcGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </section>

              {/* 30 天活动柱 */}
              <section>
                <h3 className="text-sm font-medium mb-2">每日视频观看（30 天）</h3>
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={detail.activity30d} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ fontSize: 12, background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                      formatter={(value) => [Number(value), '观看']}
                    />
                    <Bar dataKey="videoCount" fill="#10b981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </section>

              {/* 最近视频 */}
              <section>
                <h3 className="text-sm font-medium mb-2">最近 10 条视频</h3>
                {detail.recentVideos.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4">无观看记录</div>
                ) : (
                  <ul className="space-y-1">
                    {detail.recentVideos.map((v, i) => (
                      <li key={i} className="flex items-center justify-between py-1.5 px-3 bg-muted/30 rounded text-sm">
                        <Link href={`/${v.videoId}`} className="truncate hover:underline">{v.title}</Link>
                        <span className="text-xs text-muted-foreground shrink-0 ml-3">{v.date}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
