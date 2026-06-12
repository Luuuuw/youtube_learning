import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Download, AlertCircle } from 'lucide-react';
import DownloadClient from '@/components/download-client';
import { checkPageAuth } from '@/lib/auth-check';

export const metadata = {
  title: '批量下载 - VibeEnglish',
  description: '上传链接文件批量下载 YouTube 视频',
};

// Render 容器无 Python/yt-dlp/ffmpeg/外网代理，下载只能在本地 dev 跑
const IS_PROD_HOSTED = !!(process.env.RENDER || process.env.RENDER_EXTERNAL_URL);

export default async function DownloadPage() {
  const auth = await checkPageAuth();
  if (!auth.authenticated || auth.role !== 'admin') redirect('/login');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="py-6 px-4 border-b border-border">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Download className="h-6 w-6" />
          <h1 className="text-2xl font-bold">批量下载</h1>
        </div>
      </header>

      <main className="max-w-3xl mx-auto py-8 px-4">
        {IS_PROD_HOSTED ? (
          <div className="rounded-lg border border-amber-300/40 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700/40 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  此功能仅在本地开发环境可用
                </p>
                <p className="text-amber-800/80 dark:text-amber-300/80">
                  服务器容器没有 Python / yt-dlp / ffmpeg，且无法访问 YouTube。请在本地跑：
                </p>
                <pre className="mt-2 bg-amber-100/60 dark:bg-amber-900/30 rounded p-3 text-xs font-mono text-amber-900 dark:text-amber-200 overflow-x-auto">
{`cd D:\\油管学习\\vibe-english
python batch_downloader.py urls.txt
# 完成后：
rclone copy public/content r2:vibe-english --progress
git add public/content && git commit -m "add videos" && git push`}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <DownloadClient />
        )}
      </main>
    </div>
  );
}
