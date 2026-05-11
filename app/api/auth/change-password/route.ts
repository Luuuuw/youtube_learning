import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';
import authSessions, { persistSessions } from '@/lib/auth-sessions';
import { changePassword } from '@/lib/user-db';

export async function POST(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();

  try {
    const { newPassword, oldPassword } = await req.json();
    if (!newPassword || typeof newPassword !== 'string') {
      return NextResponse.json({ error: '请输入新密码' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    const token = authHeader!.replace('Bearer ', '');
    const session = authSessions.get(token);

    const isForcedChange = session?.mustChangePassword === true;

    if (!isForcedChange && !oldPassword) {
      return NextResponse.json({ error: '请输入旧密码' }, { status: 400 });
    }

    const result = changePassword(auth.code!, newPassword, isForcedChange ? undefined : oldPassword);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (session) {
      session.mustChangePassword = false;
      persistSessions();
    }
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '服务器错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
