import authSessions, { persistSessions, type AuthSession } from '@/lib/auth-sessions';
import { getUserByUsername } from '@/lib/user-db';
import { AUTH_CONSTANTS } from '@/lib/auth-constants';

export interface SessionValidationResult {
  valid: boolean;
  session?: AuthSession;
  shouldDelete?: boolean;
}

export class AuthService {
  static validateSession(token: string): SessionValidationResult {
    const session = authSessions.get(token);
    if (!session) {
      return { valid: false, shouldDelete: false };
    }

    const age = Date.now() - session.createdAt;
    if (age > AUTH_CONSTANTS.SESSION_EXPIRY_MS) {
      return { valid: false, session, shouldDelete: true };
    }

    const user = getUserByUsername(session.code);
    if (!user || user.disabled) {
      return { valid: false, session, shouldDelete: true };
    }

    return { valid: true, session, shouldDelete: false };
  }

  static cleanupInvalidSession(token: string): boolean {
    const deleted = authSessions.delete(token);
    persistSessions();
    return deleted;
  }

  static shouldRefreshSession(session: AuthSession): boolean {
    const age = Date.now() - session.createdAt;
    return age > AUTH_CONSTANTS.SESSION_REFRESH_THRESHOLD_MS;
  }

  static refreshSession(session: AuthSession): void {
    session.createdAt = Date.now();
    persistSessions();
  }

  static cleanExpiredSessions(): void {
    const now = Date.now();
    authSessions.forEach((session, token) => {
      if (now - session.createdAt > AUTH_CONSTANTS.SESSION_EXPIRY_MS) {
        authSessions.delete(token);
      }
    });
  }

  static checkAndEvictOldestSession(userCode: string): { evicted: boolean; evictedToken?: string } {
    const userSessions: Array<{ token: string; createdAt: number }> = [];
    authSessions.forEach((session, token) => {
      if (session.code === userCode) userSessions.push({ token, createdAt: session.createdAt });
    });

    if (userSessions.length < AUTH_CONSTANTS.MAX_SESSIONS_PER_USER) return { evicted: false };

    userSessions.sort((a, b) => a.createdAt - b.createdAt);
    const oldest = userSessions[0];
    authSessions.delete(oldest.token);
    persistSessions();
    return { evicted: true, evictedToken: oldest.token };
  }

  static generateToken(): string {
    const bytes = new Uint8Array(AUTH_CONSTANTS.TOKEN_BYTE_LENGTH);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
}
