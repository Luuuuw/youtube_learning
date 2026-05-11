import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import DownloadClient from '@/components/download-client';
import { checkPageAuth } from '@/lib/auth-check';

export const metadata = {
  title: '批量下载 - VibeEnglish',
  description: '上传链接文件批量下载 YouTube 视频',
};

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
        <DownloadClient />
      </main>
    </div>
  );
}
