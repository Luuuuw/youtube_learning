import { NextRequest, NextResponse } from 'next/server';
import authSessions, { persistSessions } from '@/lib/auth-sessions';
import { getUserByUsername } from '@/lib/user-db';

export interface AuthInfo {
  valid: boolean;
  code?: string;
  role?: 'admin' | 'guest';
}

export function verifyAuth(req: NextRequest): AuthInfo {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { valid: false };
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return { valid: false };
  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) {
    authSessions.delete(token);
    persistSessions();
    return { valid: false };
  }
  const user = getUserByUsername(session.code);
  if (!user || user.disabled) return { valid: false };
  return { valid: true, code: session.code, role: session.role };
}

export function verifyAdmin(req: NextRequest): AuthInfo {
  const auth = verifyAuth(req);
  if (!auth.valid) return auth;
  if (auth.role !== 'admin') return { valid: false };
  return auth;
}

export function unauthorizedResponse(msg = '请先登录') {
  return NextResponse.json({ error: msg }, { status: 401 });
}

export function forbiddenResponse(msg = '无权限') {
  return NextResponse.json({ error: msg }, { status: 403 });
}
