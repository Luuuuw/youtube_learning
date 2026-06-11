import { NextRequest, NextResponse } from 'next/server';
import { AuthService } from '@/lib/auth-service';

export interface AuthInfo {
  valid: boolean;
  code?: string;
  role?: 'admin' | 'guest';
}

export function verifyAuth(req: NextRequest): AuthInfo {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { valid: false };

  const token = authHeader.replace('Bearer ', '');
  const result = AuthService.validateSession(token);

  if (!result.valid) {
    if (result.shouldDelete) {
      AuthService.cleanupInvalidSession(token);
    }
    return { valid: false };
  }

  return { valid: true, code: result.session!.code, role: result.session!.role };
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
