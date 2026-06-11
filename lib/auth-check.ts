import { cookies } from 'next/headers';
import { AuthService } from '@/lib/auth-service';

export interface AuthResult {
  authenticated: boolean;
  username?: string;
  role?: 'admin' | 'guest';
}

export async function checkPageAuth(): Promise<AuthResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get('ve-session-token')?.value;

  if (!token) return { authenticated: false };

  const result = AuthService.validateSession(token);

  if (!result.valid) {
    if (result.shouldDelete) {
      AuthService.cleanupInvalidSession(token);
    }
    return { authenticated: false };
  }

  return { authenticated: true, username: result.session!.code, role: result.session!.role };
}
