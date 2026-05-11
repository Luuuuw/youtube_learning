import { NextRequest, NextResponse } from 'next/server';
import authSessions, { persistSessions } from '@/lib/auth-sessions';
import { getUserByUsername } from '@/lib/user-db';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const session = authSessions.get(token);
    if (!session) {
      return NextResponse.json({ valid: false });
    }

    const age = Date.now() - session.createdAt;
    if (age > 7 * 24 * 60 * 60 * 1000) {
      authSessions.delete(token);
      return NextResponse.json({ valid: false });
    }

    const user = getUserByUsername(session.code);
    if (!user || user.disabled) {
      authSessions.delete(token);
      return NextResponse.json({ valid: false });
    }

    if (age > 24 * 60 * 60 * 1000) {
      session.createdAt = Date.now();
      persistSessions();
    }

    return NextResponse.json({ valid: true, role: session.role, code: session.code, mustChangePassword: session.mustChangePassword || false });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
