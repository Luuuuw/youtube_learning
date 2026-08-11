import { redirect } from 'next/navigation';
import { checkPageAuth } from '@/lib/auth-check';
import VideoFlashcardsClient from './_client';

export const dynamic = 'force-dynamic';

export default async function VideoFlashcardsPage({
  params,
}: {
  params: { videoId: string };
}) {
  const auth = await checkPageAuth();
  if (!auth.authenticated) redirect('/login');
  return <VideoFlashcardsClient videoId={params.videoId} />;
}
