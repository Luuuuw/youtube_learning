// 用户分析聚合：把 users.json / vocab.json / review-log.json / activity.json / sessions.json
// 5 个数据源汇总成看板需要的形状。每次请求重新计算，数据规模小（<1MB）无需缓存。

import { getAllUsers, getLoginLogs, User, LoginLog } from '@/lib/user-db';
import { getAllWords, getAllReviewLogs, VocabWord, ReviewLog } from '@/lib/vocab-db';
import { getAllActivities, DailyActivity } from '@/lib/activity-db';
import authSessions from '@/lib/auth-sessions';
import { getVideoList } from '@/lib/videos';

export interface UserStat {
  username: string;
  role: 'admin' | 'guest';
  disabled: boolean;
  createdAt: string;
  vocabTotal: number;
  vocabNew: number;
  vocabMastered: number;
  reviewsLast30d: number;
  reviewSuccessRate: number;   // 0-1
  videosLast7d: number;
  videosTotalDistinct: number;
  lastLoginAt: string | null;
  loginsLast30d: number;
  failedLoginsLast30d: number;
  isOnline: boolean;
  // 用于表格 sparkline：最近 7 天每天看了几个视频
  activitySpark7d: number[];
}

export interface AnalyticsSummary {
  totalUsers: number;
  activeUsers7d: number;
  activeUsers30d: number;
  onlineCount: number;
  totalVocab: number;
  totalReviews30d: number;
  totalVideoViews7d: number;
  failedLogins7d: number;
}

export interface DauPoint {
  date: string;
  activeUsers: number;
}

export interface TopVideo {
  videoId: string;
  title: string;
  views: number;
  uniqueUsers: number;
}

export interface UserAnalytics {
  summary: AnalyticsSummary;
  users: UserStat[];
  dauCurve: DauPoint[];
  topVideos: TopVideo[];
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// 生成 [from..today] 闭区间的日期序列（YYYY-MM-DD）
function dateRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function computeUserStat(
  user: User,
  vocabByOwner: Map<string, VocabWord[]>,
  reviewLogsByOwner: Map<string, ReviewLog[]>,
  activityByCode: Map<string, DailyActivity[]>,
  loginsByUser: Map<string, LoginLog[]>,
  onlineUsernames: Set<string>,
): UserStat {
  const cutoff30 = dateNDaysAgo(30);
  const cutoff7 = dateNDaysAgo(7);
  const now = Date.now();
  const cutoff30Ms = now - 30 * 24 * 60 * 60 * 1000;

  const words = vocabByOwner.get(user.username) || [];
  const vocabTotal = words.length;
  const vocabNew = words.filter(w => w.reviewCount === 0).length;
  const vocabMastered = words.filter(w => w.proficiency >= 5).length;

  // review-log 没有 owner，要按 wordId join 回 vocab 才能算 per-user
  const userReviews = reviewLogsByOwner.get(user.username) || [];
  const reviews30 = userReviews.filter(r => r.reviewedAt >= cutoff30);
  const remembered = reviews30.filter(r => r.result === 'remember').length;
  const forgotten = reviews30.filter(r => r.result === 'forget').length;
  const reviewSuccessRate = (remembered + forgotten) > 0
    ? remembered / (remembered + forgotten)
    : 0;

  const activity = activityByCode.get(user.username) || [];
  const last7Activity = activity.filter(a => a.date >= cutoff7);
  const distinctVideos = new Set<string>();
  for (const a of activity) for (const v of a.videoIds) distinctVideos.add(v);
  const distinct7 = new Set<string>();
  for (const a of last7Activity) for (const v of a.videoIds) distinct7.add(v);

  // sparkline：最近 7 天每天的视频观看数（按 videoIds 长度）
  const last7Dates = dateRange(7);
  const activityByDate = new Map<string, number>();
  for (const a of last7Activity) {
    activityByDate.set(a.date, (activityByDate.get(a.date) || 0) + a.videoIds.length);
  }
  const activitySpark7d = last7Dates.map(d => activityByDate.get(d) || 0);

  const logins = loginsByUser.get(user.username) || [];
  const lastLogin = logins.find(l => l.success) || null;
  const lastLoginAt = lastLogin ? lastLogin.timestamp : null;
  const logins30 = logins.filter(l => new Date(l.timestamp).getTime() >= cutoff30Ms);
  const loginsLast30d = logins30.filter(l => l.success).length;
  const failedLoginsLast30d = logins30.filter(l => !l.success).length;

  return {
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
    vocabTotal,
    vocabNew,
    vocabMastered,
    reviewsLast30d: reviews30.length,
    reviewSuccessRate,
    videosLast7d: distinct7.size,
    videosTotalDistinct: distinctVideos.size,
    lastLoginAt,
    loginsLast30d,
    failedLoginsLast30d,
    isOnline: onlineUsernames.has(user.username),
    activitySpark7d,
  };
}

function buildDauCurve(activities: DailyActivity[], days: number): DauPoint[] {
  // 每天按 code 去重统计活跃用户数
  const byDate = new Map<string, Set<string>>();
  for (const a of activities) {
    if (!byDate.has(a.date)) byDate.set(a.date, new Set());
    byDate.get(a.date)!.add(a.code);
  }
  return dateRange(days).map(date => ({
    date,
    activeUsers: byDate.get(date)?.size || 0,
  }));
}

function buildTopVideos(activities: DailyActivity[], days: number, limit: number): TopVideo[] {
  const cutoff = dateNDaysAgo(days);
  const recent = activities.filter(a => a.date >= cutoff);
  const stats = new Map<string, { views: number; users: Set<string> }>();
  for (const a of recent) {
    for (const v of a.videoIds) {
      if (!stats.has(v)) stats.set(v, { views: 0, users: new Set() });
      const s = stats.get(v)!;
      s.views++;
      s.users.add(a.code);
    }
  }
  const videoList = getVideoList();
  const titleById = new Map(videoList.map(v => [v.id, v.title]));
  return Array.from(stats.entries())
    .map(([videoId, s]) => ({
      videoId,
      title: titleById.get(videoId) || videoId,
      views: s.views,
      uniqueUsers: s.users.size,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

export function computeUserAnalytics(): UserAnalytics {
  const users = getAllUsers();
  const allWords = getAllWords();
  const allReviewLogs = getAllReviewLogs();
  const allActivities = getAllActivities();
  const allLogins = getLoginLogs(1000);

  // group vocab by owner
  const vocabByOwner = new Map<string, VocabWord[]>();
  for (const w of allWords) {
    if (!vocabByOwner.has(w.owner)) vocabByOwner.set(w.owner, []);
    vocabByOwner.get(w.owner)!.push(w);
  }

  // wordId → owner（review log 没存 owner，需要 join）
  const wordOwnerById = new Map<string, string>();
  for (const w of allWords) wordOwnerById.set(w.id, w.owner);
  const reviewLogsByOwner = new Map<string, ReviewLog[]>();
  for (const r of allReviewLogs) {
    const owner = wordOwnerById.get(r.wordId);
    if (!owner) continue;
    if (!reviewLogsByOwner.has(owner)) reviewLogsByOwner.set(owner, []);
    reviewLogsByOwner.get(owner)!.push(r);
  }

  // group activity by code
  const activityByCode = new Map<string, DailyActivity[]>();
  for (const a of allActivities) {
    if (!activityByCode.has(a.code)) activityByCode.set(a.code, []);
    activityByCode.get(a.code)!.push(a);
  }

  // group login logs by username (logs already newest-first from getLoginLogs)
  const loginsByUser = new Map<string, LoginLog[]>();
  for (const l of allLogins) {
    if (!loginsByUser.has(l.username)) loginsByUser.set(l.username, []);
    loginsByUser.get(l.username)!.push(l);
  }

  // online users
  const onlineUsernames = new Set<string>();
  authSessions.forEach((session) => {
    onlineUsernames.add(session.code);
  });

  const userStats = users.map(u =>
    computeUserStat(u, vocabByOwner, reviewLogsByOwner, activityByCode, loginsByUser, onlineUsernames),
  );

  // summary
  const cutoff7 = dateNDaysAgo(7);
  const cutoff30 = dateNDaysAgo(30);
  const activeUsers7 = new Set<string>();
  const activeUsers30 = new Set<string>();
  let totalVideoViews7d = 0;
  for (const a of allActivities) {
    if (a.date >= cutoff7) {
      activeUsers7.add(a.code);
      totalVideoViews7d += a.videoIds.length;
    }
    if (a.date >= cutoff30) activeUsers30.add(a.code);
  }
  const totalReviews30d = allReviewLogs.filter(r => r.reviewedAt >= cutoff30).length;
  const cutoff7Ms = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const failedLogins7d = allLogins.filter(l =>
    !l.success && new Date(l.timestamp).getTime() >= cutoff7Ms,
  ).length;

  const summary: AnalyticsSummary = {
    totalUsers: users.length,
    activeUsers7d: activeUsers7.size,
    activeUsers30d: activeUsers30.size,
    onlineCount: onlineUsernames.size,
    totalVocab: allWords.length,
    totalReviews30d,
    totalVideoViews7d,
    failedLogins7d,
  };

  // 抑制未使用变量警告（todayStr 留着备用，但暂时不在主流程用）
  void todayStr;

  return {
    summary,
    users: userStats,
    dauCurve: buildDauCurve(allActivities, 30),
    topVideos: buildTopVideos(allActivities, 7, 10),
  };
}

// per-user 详情（modal 用）：学习曲线 + 30 天活动 + 最近视频
export interface UserDetail {
  username: string;
  learningCurve: { date: string; total: number; newWords: number; reviewed: number }[];
  activity30d: { date: string; videoCount: number }[];
  recentVideos: { date: string; videoId: string; title: string }[];
}

export function computeUserDetail(username: string): UserDetail | null {
  const users = getAllUsers();
  const user = users.find(u => u.username === username);
  if (!user) return null;

  const allWords = getAllWords(username);
  const allReviewLogs = getAllReviewLogs();
  const allActivities = getAllActivities();
  const videoList = getVideoList();
  const titleById = new Map(videoList.map(v => [v.id, v.title]));

  // 用 wordId set 过滤当前用户的 review logs
  const userWordIds = new Set(allWords.map(w => w.id));
  const userReviewLogs = allReviewLogs.filter(r => userWordIds.has(r.wordId));

  // 学习曲线 30 天：每日累计词汇 + 新增 + 复习数
  const dates = dateRange(30);
  const wordsByCreated = new Map<string, number>();
  for (const w of allWords) {
    const d = w.createdAt.slice(0, 10);
    wordsByCreated.set(d, (wordsByCreated.get(d) || 0) + 1);
  }
  const reviewsByDate = new Map<string, number>();
  for (const r of userReviewLogs) {
    const d = r.reviewedAt.slice(0, 10);
    reviewsByDate.set(d, (reviewsByDate.get(d) || 0) + 1);
  }
  // 计算每天累计：先算 dates[0] 之前的累计
  const before = allWords.filter(w => w.createdAt.slice(0, 10) < dates[0]).length;
  let running = before;
  const learningCurve = dates.map(date => {
    const added = wordsByCreated.get(date) || 0;
    running += added;
    return {
      date,
      total: running,
      newWords: added,
      reviewed: reviewsByDate.get(date) || 0,
    };
  });

  // 活动 30 天
  const userActivity = allActivities.filter(a => a.code === username);
  const activityByDate = new Map<string, number>();
  for (const a of userActivity) {
    if (a.date >= dates[0]) {
      activityByDate.set(a.date, (activityByDate.get(a.date) || 0) + a.videoIds.length);
    }
  }
  const activity30d = dates.map(date => ({
    date,
    videoCount: activityByDate.get(date) || 0,
  }));

  // 最近 10 条视频（按日期降序，扁平展开 videoIds）
  const recentVideos: { date: string; videoId: string; title: string }[] = [];
  const sortedActivity = userActivity.slice().sort((a, b) => b.date.localeCompare(a.date));
  for (const a of sortedActivity) {
    for (const v of a.videoIds.slice().reverse()) {
      recentVideos.push({ date: a.date, videoId: v, title: titleById.get(v) || v });
      if (recentVideos.length >= 10) break;
    }
    if (recentVideos.length >= 10) break;
  }

  return {
    username,
    learningCurve,
    activity30d,
    recentVideos,
  };
}
