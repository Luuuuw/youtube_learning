import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import authSessions, { persistSessions } from '@/lib/auth-sessions';

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  const authHeader = req.headers.get('authorization');
  const token = authHeader!.replace('Bearer ', '');
  const deleted = authSessions.delete(token);
  persistSessions();
  return NextResponse.json({ success: true, loggedOut: deleted });
}
