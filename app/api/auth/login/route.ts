import { NextRequest, NextResponse } from 'next/server';
import authSessions, { persistSessions, checkRateLimit, recordFailedAttempt, clearFailedAttempts } from '@/lib/auth-sessions';
import { authenticateUser, initAdminIfEmpty, addLoginLog, markExpiredTempPasswords } from '@/lib/user-db';

initAdminIfEmpty();

const MAX_SESSIONS_PER_USER = 3;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

function cleanExpiredSessions() {
  const now = Date.now();
  authSessions.forEach((session, token) => {
    if (now - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
      authSessions.delete(token);
    }
  });
}

function checkSessionLimit(userCode: string): NextResponse | null {
  const userSessions: string[] = [];
  authSessions.forEach((session, token) => {
    if (session.code === userCode) {
      userSessions.push(token);
    }
  });
  if (userSessions.length >= MAX_SESSIONS_PER_USER) {
    return NextResponse.json(
      { success: false, error: `该账号已在 ${MAX_SESSIONS_PER_USER} 个终端登录，请先退出其他设备` },
      { status: 403 }
    );
  }
  return null;
}

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

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
      recordFailedAttempt(username, MAX_LOGIN_ATTEMPTS, LOCKOUT_DURATION);
      addLoginLog(username, false, ip, userAgent);
      return NextResponse.json({ success: false, error: result.error }, { status: 401 });
    }

    clearFailedAttempts(username);
    addLoginLog(username, true, ip, userAgent);

    cleanExpiredSessions();

    const limitHit = checkSessionLimit(username);
    if (limitHit) return limitHit;

    const token = generateToken();
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
