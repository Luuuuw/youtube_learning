'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  TrendingUp,
  Award,
  Calendar,
  Target,
  BarChart3,
  LogOut,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import Sidebar from '@/components/sidebar';
import ThemeToggle from '@/components/theme-toggle';

interface ProfileData {
  code: string;
  role: string;
  vocabCount: number;
  masteredCount: number;
  learningCount: number;
  newCount: number;
  todayDue: number;
  todayNew: number;
  todayMastered: number;
  todayTotal: number;
  weekly: { date: string; remembered: number; forgotten: number }[];
  videoCount: number;
  totalReviews: number;
  rememberRate: number;
  joinedAt: string | null;
}

export default function ProfileClient() {
  const { role, userCode, logout } = useAuth();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/user/profile', {
        headers: token ? { Authorization: `Bearer ${token}` } as Record<string, string> : {},
      });
      if (!res.ok) {
        throw new Error('获取数据失败');
      }
      const data = await res.json();
      setProfile(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const displayName = userCode || profile?.code || '用户';

  return (
    <>
      <Sidebar categories={[]} difficulties={[]} activeCategory={null} activeDifficulty={null} onCategoryChange={() => {}} onDifficultyChange={() => {}} />

      <div className="pl-0 lg:pl-[240px] transition-all duration-300">
        <div className="min-h-screen bg-background text-foreground">
          <header className="py-8 px-4 sm:px-6 border-b border-border">
            <div className="max-w-4xl mx-auto flex items-start justify-between">
              <div>
                <Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3">
                  <ArrowLeft className="h-4 w-4" /> 返回首页
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">个人主页</h1>
              </div>
              <ThemeToggle />
            </div>
          </header>

          <main className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
            {loading ? (
              <div className="flex items-center justify-center py-24">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="text-center py-24">
                <p className="text-muted-foreground">{error}</p>
                <button onClick={fetchProfile} className="mt-3 text-sm text-primary hover:underline">重试</button>
              </div>
            ) : profile ? (
              <div className="space-y-6">
                <div className="bg-card border border-border rounded-2xl p-6">
                  <div className="flex items-center gap-5">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-2xl font-bold text-primary shrink-0">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-xl font-semibold">{displayName}</h2>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                          {role === 'admin' ? '管理员' : '学员'}
                        </span>
                        {profile.joinedAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {new Date(profile.joinedAt).toLocaleDateString('zh-CN')} 加入
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={logout}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      退出登录
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <StatCard icon={BookOpen} label="生词总量" value={profile.vocabCount} color="text-purple-500" bg="bg-purple-500/10" />
                  <StatCard icon={Award} label="已掌握" value={profile.masteredCount} color="text-green-500" bg="bg-green-500/10" />
                  <StatCard icon={Target} label="学习中" value={profile.learningCount} color="text-amber-500" bg="bg-amber-500/10" />
                  <StatCard icon={Brain} label="待复习" value={profile.todayDue} color="text-blue-500" bg="bg-blue-500/10" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-card border border-border rounded-xl p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-muted-foreground" />
                      学习概览
                    </h3>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">视频资源</span>
                        <span className="text-sm font-medium">{profile.videoCount} 个</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">总复习次数</span>
                        <span className="text-sm font-medium">{profile.totalReviews} 次</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">记忆率</span>
                        <span className="text-sm font-medium">{profile.rememberRate}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">今日新词</span>
                        <span className="text-sm font-medium">{profile.todayNew} 个</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">今日已掌握</span>
                        <span className="text-sm font-medium">{profile.todayMastered} 个</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-card border border-border rounded-xl p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-muted-foreground" />
                      近7天复习趋势
                    </h3>
                    {profile.weekly.length > 0 ? (
                      <>
                        <div className="flex items-end gap-2 h-32">
                          {profile.weekly.map((day, i) => {
                            const total = day.remembered + day.forgotten;
                            const maxVal = Math.max(...profile.weekly.map(d => d.remembered + d.forgotten), 1);
                            const height = total === 0 ? 4 : (total / maxVal) * 100;
                            const rememberRatio = total === 0 ? 0 : (day.remembered / total) * 100;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full relative rounded-t-md overflow-hidden" style={{ height: `${Math.max(height, 4)}%` }}>
                                  <div className="absolute bottom-0 left-0 right-0 bg-green-500/80" style={{ height: `${rememberRatio}%` }} />
                                  <div className="absolute top-0 left-0 right-0 bg-red-400/60" style={{ height: `${100 - rememberRatio}%` }} />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{day.date.slice(5)}</span>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-green-500/80" /> 记住
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full bg-red-400/60" /> 遗忘
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">暂无复习记录</div>
                    )}
                  </div>
                </div>

                <div className="bg-card border border-border rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-4">生词掌握分布</h3>
                  {profile.vocabCount > 0 ? (
                    <div className="space-y-3">
                      <DistributionBar label="已掌握" count={profile.masteredCount} total={profile.vocabCount} color="bg-green-500" />
                      <DistributionBar label="学习中" count={profile.learningCount} total={profile.vocabCount} color="bg-amber-500" />
                      <DistributionBar label="未学习" count={profile.newCount} total={profile.vocabCount} color="bg-muted-foreground/30" />
                    </div>
                  ) : (
                    <div className="text-center py-8 text-sm text-muted-foreground">
                      还没有添加生词，去视频页点击单词开始学习吧
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 justify-center pt-4">
                  <Link href="/vocab" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                    <BookOpen className="h-4 w-4" /> 生词本
                  </Link>
                  <Link href="/" className="flex items-center gap-2 px-5 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted transition-colors">
                    <ArrowLeft className="h-4 w-4" /> 返回首页
                  </Link>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </>
  );
}

function StatCard({ icon: Icon, label, value, color, bg }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  bg: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5">
      <div className={`inline-flex p-2 rounded-lg ${bg} ${color} mb-3`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function DistributionBar({ label, count, total, color }: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="text-muted-foreground">{count} ({pct.toFixed(0)}%)</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
