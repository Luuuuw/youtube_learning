import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getVideoById } from '@/lib/videos';
import { translateVideoFromRawVtt } from '@/lib/translate';
import VideoLearningPage from '@/components/video-learning-page';
import { checkPageAuth } from '@/lib/auth-check';

export const dynamic = 'force-dynamic';

export default async function VideoPage({
  params,
}: {
  params: { id: string };
}) {
  const auth = await checkPageAuth();
  if (!auth.authenticated) redirect('/login');
  const videoData = getVideoById(params.id);

  if (!videoData) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">视频不存在</h1>
          <p className="text-muted-foreground mb-6">
            请检查视频ID是否正确，或使用 downloader.py 下载视频
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/80 transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  if (videoData.zhSubtitles.length === 0) {
    try {
      const zhSubtitles = await translateVideoFromRawVtt(videoData.id);
      if (zhSubtitles.length > 0) {
        videoData.zhSubtitles = zhSubtitles;
        const translationMap = new Map<number, string>();
        for (const zh of zhSubtitles) {
          translationMap.set(zh.id, zh.text);
        }
        for (const sub of videoData.subtitles) {
          const translation = translationMap.get(sub.id);
          if (translation) {
            sub.translation = translation;
          }
        }
      }
    } catch (err) {
      console.error('Translation failed:', err);
    }
  }

  return (
    <VideoLearningPage
      id={videoData.id}
      title={videoData.title}
      description={videoData.description}
      videoUrl={videoData.videoUrl}
      subtitles={videoData.subtitles}
      zhSubtitles={videoData.zhSubtitles}
    />
  );
}
