import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { checkPageAuth } from '@/lib/auth-check';
import DashboardNav from '@/components/dashboard-nav';

export const metadata = {
  title: '数据看板 - VibeEnglish',
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await checkPageAuth();
  if (!auth.authenticated || auth.role !== 'admin') redirect('/login');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="py-6 px-4 border-b border-border">
        <div className="max-w-6xl mx-auto flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <BarChartIcon className="h-6 w-6" />
          <h1 className="text-2xl font-bold">数据看板</h1>
          <DashboardNav />
        </div>
      </header>

      <main className="max-w-6xl mx-auto py-8 px-4">{children}</main>
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
