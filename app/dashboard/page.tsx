import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { getVideoList } from '@/lib/videos';
import DashboardClient from '@/components/dashboard-client';
import { checkPageAuth } from '@/lib/auth-check';

export const metadata = {
  title: '数据看板 - VibeEnglish',
};

export default async function DashboardPage() {
  const auth = await checkPageAuth();
  if (!auth.authenticated || auth.role !== 'admin') redirect('/login');
  const videos = await getVideoList();

  const totalVideos = videos.length;
  const britishCount = videos.filter((v) => v.accent === 'british').length;
  const americanCount = videos.filter((v) => v.accent === 'american').length;
  const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0);

  // 序列化视频数据传递给客户端组件
  const videosJson = JSON.stringify(videos);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="py-6 px-4 border-b border-border">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <BarChartIcon className="h-6 w-6" />
          <h1 className="text-2xl font-bold">AI 数据看板</h1>
        </div>
      </header>

      <main className="max-w-5xl mx-auto py-8 px-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard
            label="视频总数"
            value={totalVideos}
            icon={BookOpen}
            color="text-blue-500"
            bg="bg-blue-500/10"
          />
          <StatCard
            label="总时长(分钟)"
            value={Math.round(totalDuration / 60)}
            icon={Clock}
            color="text-emerald-500"
            bg="bg-emerald-500/10"
          />
          <StatCard
            label="英音视频"
            value={britishCount}
            icon={TrendingUp}
            color="text-indigo-500"
            bg="bg-indigo-500/10"
          />
          <StatCard
            label="美音视频"
            value={americanCount}
            icon={TrendingUp}
            color="text-red-500"
            bg="bg-red-500/10"
          />
        </div>

        <DashboardClient videosJson={videosJson} />
      </main>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  bg,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
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

function BarChartIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
