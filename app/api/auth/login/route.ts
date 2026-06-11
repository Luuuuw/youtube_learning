import { NextRequest, NextResponse } from 'next/server';
import authSessions, { persistSessions, checkRateLimit, recordFailedAttempt, clearFailedAttempts } from '@/lib/auth-sessions';
import { authenticateUser, initAdminIfEmpty, addLoginLog, markExpiredTempPasswords } from '@/lib/user-db';
import { AuthService } from '@/lib/auth-service';
import { AUTH_CONSTANTS } from '@/lib/auth-constants';

initAdminIfEmpty();

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    initAdminIfEmpty();
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ success: false, error: '请输入用户名和密码' }, { status: 400 });
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      return NextResponse.json({ success: false, error: '参数格式错误' }, { status: 400 });
    }
    if (username.length > 100 || password.length > 128) {
      return NextResponse.json({ success: false, error: '用户名或密码过长' }, { status: 400 });
    }

    const rateLimit = checkRateLimit(username);
    if (rateLimit.locked) {
      return NextResponse.json(
        { success: false, error: `登录失败次数过多，请 ${rateLimit.remaining} 分钟后重试` },
        { status: 429 }
      );
    }

    markExpiredTempPasswords();

    const result = authenticateUser(username, password);
    const ip = getClientIp(req);
    const userAgent = req.headers.get('user-agent') || '';

    if (result.error) {
      recordFailedAttempt(username, AUTH_CONSTANTS.MAX_LOGIN_ATTEMPTS, AUTH_CONSTANTS.LOCKOUT_DURATION_MS);
      addLoginLog(username, false, ip, userAgent);
      return NextResponse.json({ success: false, error: result.error }, { status: 401 });
    }

    clearFailedAttempts(username);
    addLoginLog(username, true, ip, userAgent);

    AuthService.cleanExpiredSessions();

    AuthService.checkAndEvictOldestSession(username);

    const token = AuthService.generateToken();
    authSessions.set(token, {
      createdAt: Date.now(),
      code: username,
      role: result.user.role,
      mustChangePassword: result.user.mustChangePassword,
    });
    persistSessions();

    return NextResponse.json({
      success: true,
      token,
      role: result.user.role,
      code: username,
      mustChangePassword: result.user.mustChangePassword,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '服务器错误';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
