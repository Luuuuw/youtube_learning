import { cookies } from 'next/headers';
import authSessions from '@/lib/auth-sessions';
import { getUserByUsername } from '@/lib/user-db';

export interface AuthResult {
  authenticated: boolean;
  username?: string;
  role?: 'admin' | 'guest';
}

export async function checkPageAuth(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ve-session-token')?.value;

  if (!token) return { authenticated: false };

  const session = authSessions.get(token);
  if (!session) return { authenticated: false };

  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) {
    authSessions.delete(token);
    return { authenticated: false };
  }

  const user = getUserByUsername(session.code);
  if (!user || user.disabled) return { authenticated: false };

  return { authenticated: true, username: session.code, role: session.role };
}
