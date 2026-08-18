import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';
import { getUserByUsername } from '@/lib/user-db';

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const result = AuthService.validateSession(token);

    if (!result.valid) {
      if (result.shouldDelete) {
        AuthService.cleanupInvalidSession(token);
      }
      return NextResponse.json({ valid: false });
    }

    if (AuthService.shouldRefreshSession(result.session!)) {
      AuthService.refreshSession(result.session!);
    }

    const user = getUserByUsername(result.session!.code);

    return NextResponse.json({ valid: true, role: result.session!.role, code: result.session!.code, displayName: user?.displayName || null, mustChangePassword: result.session!.mustChangePassword || false });
  } catch {
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}
