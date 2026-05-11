import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BookOpen } from 'lucide-react';
import VocabClient from '@/components/vocab-client';
import VocabEnter from '@/components/vocab-enter';
import { UserNav } from '@/components/user-nav';
import { checkPageAuth } from '@/lib/auth-check';

export const metadata = {
  title: '我的生词本 - VibeEnglish',
  description: '管理你的英语学习生词本',
};

export default async function VocabPage() {
  const auth = await checkPageAuth();
  if (!auth.authenticated) redirect('/login');
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="py-6 px-4 border-b border-border">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <BookOpen className="h-6 w-6" />
            <h1 className="text-2xl font-bold">我的生词本</h1>
          </div>
          <UserNav />
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-8 px-4">
        <VocabEnter>
          <VocabClient />
        </VocabEnter>
      </main>
    </div>
  );
}