import { NextRequest, NextResponse } from 'next/server';
import authSessions, { persistSessions, updateUserSessionsRole, invalidateUserSessions } from '@/lib/auth-sessions';
import { createUser, getAllUsers, getIssuanceLogs, resetUserPassword, deleteUser, updateUserRole, toggleUserDisabled, batchCreateUsers, getAuditLogs, getLoginLogs } from '@/lib/user-db';

function checkAdmin(req: NextRequest): { authorized: boolean; username?: string; error?: NextResponse } {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return { authorized: false, error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return { authorized: false, error: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  if (session.role !== 'admin') return { authorized: false, error: NextResponse.json({ error: '无权限' }, { status: 403 }) };
  return { authorized: true, username: session.code };
}

export async function GET(req: NextRequest) {
  const check = checkAdmin(req);
  if (!check.authorized) return check.error!;

  const url = new URL(req.url);
  const search = url.searchParams.get('search') || '';
  const tab = url.searchParams.get('tab') || 'users';

  const onlineSessions: { token: string; code: string; role: string; createdAt: number }[] = [];
  authSessions.forEach((session, token) => {
    onlineSessions.push({ token, code: session.code, role: session.role, createdAt: session.createdAt });
  });

  if (tab === 'audit') {
    return NextResponse.json({ auditLogs: getAuditLogs(200) });
  }
  if (tab === 'logins') {
    return NextResponse.json({ loginLogs: getLoginLogs(200) });
  }
  if (tab === 'sessions') {
    return NextResponse.json({ sessions: onlineSessions });
  }

  let users = getAllUsers().map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    disabled: u.disabled,
    mustChangePassword: u.mustChangePassword,
    tempPasswordUsed: u.tempPasswordUsed,
    passwordChangedAt: u.passwordChangedAt,
    createdAt: u.createdAt,
    createdBy: u.createdBy,
  }));

  if (search) {
    const q = search.toLowerCase();
    users = users.filter(u => u.username.toLowerCase().includes(q) || u.role.includes(q));
  }

  return NextResponse.json({
    users,
    logs: getIssuanceLogs(),
    sessions: onlineSessions,
  });
}

export async function POST(req: NextRequest) {
  const check = checkAdmin(req);
  if (!check.authorized) return check.error!;
  try {
    const body = await req.json();

    if (body.batch && Array.isArray(body.usernames)) {
      const results = batchCreateUsers(body.usernames, body.role === 'admin' ? 'admin' : 'guest', check.username!);
      return NextResponse.json({ success: true, batch: true, results: results.results });
    }

    const { username, role } = body;
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '请输入用户名' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return NextResponse.json({ error: '用户名需3-20位，仅限字母数字下划线' }, { status: 400 });
    }
    const result = createUser(username, role === 'admin' ? 'admin' : 'guest', check.username!);
    return NextResponse.json({ success: true, username: result.user.username, tempPassword: result.tempPassword });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '创建失败';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const check = checkAdmin(req);
  if (!check.authorized) return check.error!;
  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'changeRole') {
      const result = updateUserRole(body.username, body.newRole, check.username!);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
      updateUserSessionsRole(body.username, body.newRole);
      return NextResponse.json({ success: true });
    }

    if (action === 'toggleDisabled') {
      const result = toggleUserDisabled(body.username, check.username!);
      if (!result.success) return NextResponse.json({ error: result.error }, { status: 400 });
      if (result.disabled) {
        invalidateUserSessions(body.username);
      }
      return NextResponse.json({ success: true, disabled: result.disabled });
    }

    if (action === 'kickSession') {
      const token = body.token;
      if (!token) return NextResponse.json({ error: '缺少 token' }, { status: 400 });
      const deleted = authSessions.delete(token);
      persistSessions();
      return NextResponse.json({ success: true, kicked: deleted });
    }

    const { username } = body;
    const result = resetUserPassword(username, check.username!);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    invalidateUserSessions(username);
    return NextResponse.json({ success: true, tempPassword: result.tempPassword });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '操作失败';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const check = checkAdmin(req);
  if (!check.authorized) return check.error!;
  try {
    const { username } = await req.json();
    if (username === check.username) {
      return NextResponse.json({ error: '不能删除自己' }, { status: 400 });
    }
    const ok = deleteUser(username, check.username!);
    if (!ok) return NextResponse.json({ error: '不能删除 admin 账号或用户不存在' }, { status: 400 });
    invalidateUserSessions(username);
    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '删除失败';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
