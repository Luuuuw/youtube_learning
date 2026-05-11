import { getVideoList } from '@/lib/videos';
import HomeClient from '@/components/home-client';

export default async function Home() {
  const videos = await getVideoList();
  return <HomeClient videos={videos} />;
}