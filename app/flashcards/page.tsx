import { redirect } from 'next/navigation';
import { checkPageAuth } from '@/lib/auth-check';
import FlashcardsClient from './_client';

export const dynamic = 'force-dynamic';

export default async function FlashcardsPage() {
  const auth = await checkPageAuth();
  if (!auth.authenticated) redirect('/login');
  return <FlashcardsClient />;
}
