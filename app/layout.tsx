import type { Metadata, Viewport } from 'next';
import './globals.css';
import ThemeProvider from '@/components/theme-provider';
import PageEnter from '@/components/page-enter';
import { AuthProvider } from '@/lib/auth-context';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'VibeEnglish - YouTube英语学习平台',
  description: '通过YouTube视频学习英语，支持双语字幕和实时查词',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans overflow-x-hidden">
        <ThemeProvider>
          <AuthProvider>
            <PageEnter>
              {children}
            </PageEnter>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}