import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import { AuthService } from '@/lib/auth-service';

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  const authHeader = req.headers.get('authorization');
  const token = authHeader!.replace('Bearer ', '');
  const deleted = AuthService.cleanupInvalidSession(token);
  return NextResponse.json({ success: true, loggedOut: deleted });
}
