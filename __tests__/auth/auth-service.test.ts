import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/user-db', () => ({
  getUserByUsername: vi.fn(),
}));

vi.mock('@/lib/auth-sessions', () => {
  const map = new Map<string, { createdAt: number; code: string; role: 'admin' | 'guest'; mustChangePassword?: boolean }>();
  return {
    default: map,
    persistSessions: vi.fn(),
  };
});

import { AuthService } from '@/lib/auth-service';
import { getUserByUsername } from '@/lib/user-db';
import authSessions, { persistSessions } from '@/lib/auth-sessions';
import { AUTH_CONSTANTS } from '@/lib/auth-constants';

beforeEach(() => {
  authSessions.clear();
  vi.clearAllMocks();
});

describe('AuthService.validateSession', () => {
  it('token 不存在时返回 invalid + shouldDelete=false', () => {
    const result = AuthService.validateSession('nonexistent');
    expect(result.valid).toBe(false);
    expect(result.shouldDelete).toBe(false);
  });

  it('会话已过期时返回 invalid + shouldDelete=true', () => {
    const expiredTime = Date.now() - AUTH_CONSTANTS.SESSION_EXPIRY_MS - 1000;
    authSessions.set('expired_token', { createdAt: expiredTime, code: 'user1', role: 'guest' });

    const result = AuthService.validateSession('expired_token');
    expect(result.valid).toBe(false);
    expect(result.shouldDelete).toBe(true);
    expect(result.session).toBeDefined();
  });

  it('用户不存在时返回 invalid + shouldDelete=true', () => {
    authSessions.set('token1', { createdAt: Date.now(), code: 'ghost', role: 'guest' });
    vi.mocked(getUserByUsername).mockReturnValue(null);

    const result = AuthService.validateSession('token1');
    expect(result.valid).toBe(false);
    expect(result.shouldDelete).toBe(true);
  });

  it('用户被禁用时返回 invalid + shouldDelete=true', () => {
    authSessions.set('token2', { createdAt: Date.now(), code: 'disabled_user', role: 'guest' });
    vi.mocked(getUserByUsername).mockReturnValue({ username: 'disabled_user', disabled: true } as any);

    const result = AuthService.validateSession('token2');
    expect(result.valid).toBe(false);
    expect(result.shouldDelete).toBe(true);
  });

  it('有效会话返回 valid=true', () => {
    authSessions.set('valid_token', { createdAt: Date.now(), code: 'active_user', role: 'admin' });
    vi.mocked(getUserByUsername).mockReturnValue({ username: 'active_user', disabled: false } as any);

    const result = AuthService.validateSession('valid_token');
    expect(result.valid).toBe(true);
    expect(result.session?.code).toBe('active_user');
    expect(result.session?.role).toBe('admin');
    expect(result.shouldDelete).toBe(false);
  });

  it('会话刚创建（未过期）返回 valid', () => {
    authSessions.set('fresh_token', { createdAt: Date.now() - 1000, code: 'user1', role: 'guest' });
    vi.mocked(getUserByUsername).mockReturnValue({ username: 'user1', disabled: false } as any);

    const result = AuthService.validateSession('fresh_token');
    expect(result.valid).toBe(true);
  });

  it('会话恰好差1ms过期时仍返回 valid', () => {
    const almostExpired = Date.now() - AUTH_CONSTANTS.SESSION_EXPIRY_MS + 1;
    authSessions.set('almost_token', { createdAt: almostExpired, code: 'user1', role: 'guest' });
    vi.mocked(getUserByUsername).mockReturnValue({ username: 'user1', disabled: false } as any);

    const result = AuthService.validateSession('almost_token');
    expect(result.valid).toBe(true);
  });
});

describe('AuthService.cleanupInvalidSession', () => {
  it('删除存在的 token 返回 true 并调用 persistSessions', () => {
    authSessions.set('del_token', { createdAt: Date.now(), code: 'u1', role: 'guest' });

    const result = AuthService.cleanupInvalidSession('del_token');
    expect(result).toBe(true);
    expect(authSessions.has('del_token')).toBe(false);
    expect(persistSessions).toHaveBeenCalled();
  });

  it('删除不存在的 token 返回 false', () => {
    const result = AuthService.cleanupInvalidSession('no_such_token');
    expect(result).toBe(false);
  });
});

describe('AuthService.shouldRefreshSession', () => {
  it('刚创建的会话不需要刷新', () => {
    const session = { createdAt: Date.now(), code: 'u1', role: 'guest' as const };
    expect(AuthService.shouldRefreshSession(session)).toBe(false);
  });

  it('超过刷新阈值的会话需要刷新', () => {
    const session = { createdAt: Date.now() - AUTH_CONSTANTS.SESSION_REFRESH_THRESHOLD_MS - 1, code: 'u1', role: 'guest' as const };
    expect(AuthService.shouldRefreshSession(session)).toBe(true);
  });

  it('恰好等于刷新阈值时不需要刷新（> 严格大于）', () => {
    const session = { createdAt: Date.now() - AUTH_CONSTANTS.SESSION_REFRESH_THRESHOLD_MS, code: 'u1', role: 'guest' as const };
    expect(AuthService.shouldRefreshSession(session)).toBe(false);
  });

  it('超过刷新阈值 1ms 时需要刷新', () => {
    const session = { createdAt: Date.now() - AUTH_CONSTANTS.SESSION_REFRESH_THRESHOLD_MS - 1, code: 'u1', role: 'guest' as const };
    expect(AuthService.shouldRefreshSession(session)).toBe(true);
  });
});

describe('AuthService.refreshSession', () => {
  it('更新 createdAt 并调用 persistSessions', () => {
    const oldTime = Date.now() - 100000;
    const session = { createdAt: oldTime, code: 'u1', role: 'guest' as const };

    AuthService.refreshSession(session);
    expect(session.createdAt).toBeGreaterThan(oldTime);
    expect(persistSessions).toHaveBeenCalled();
  });
});

describe('AuthService.cleanExpiredSessions', () => {
  it('清理过期会话，保留有效会话', () => {
    const expiredTime = Date.now() - AUTH_CONSTANTS.SESSION_EXPIRY_MS - 1000;
    const validTime = Date.now();

    authSessions.set('expired1', { createdAt: expiredTime, code: 'u1', role: 'guest' });
    authSessions.set('expired2', { createdAt: expiredTime, code: 'u2', role: 'guest' });
    authSessions.set('valid1', { createdAt: validTime, code: 'u3', role: 'admin' });

    AuthService.cleanExpiredSessions();

    expect(authSessions.has('expired1')).toBe(false);
    expect(authSessions.has('expired2')).toBe(false);
    expect(authSessions.has('valid1')).toBe(true);
  });

  it('没有过期会话时不删除任何条目', () => {
    authSessions.set('v1', { createdAt: Date.now(), code: 'u1', role: 'guest' });
    authSessions.set('v2', { createdAt: Date.now(), code: 'u2', role: 'guest' });

    AuthService.cleanExpiredSessions();

    expect(authSessions.size).toBe(2);
  });

  it('空 Map 不报错', () => {
    expect(() => AuthService.cleanExpiredSessions()).not.toThrow();
  });
});

describe('AuthService.checkAndEvictOldestSession', () => {
  it('未达到上限时不踢出', () => {
    authSessions.set('t1', { createdAt: Date.now(), code: 'user1', role: 'guest' });
    authSessions.set('t2', { createdAt: Date.now(), code: 'user1', role: 'guest' });

    const result = AuthService.checkAndEvictOldestSession('user1');
    expect(result.evicted).toBe(false);
  });

  it('达到上限时自动踢掉最旧的会话', () => {
    const base = Date.now();
    for (let i = 0; i < AUTH_CONSTANTS.MAX_SESSIONS_PER_USER; i++) {
      authSessions.set(`t${i}`, { createdAt: base + i * 1000, code: 'user1', role: 'guest' });
    }

    const result = AuthService.checkAndEvictOldestSession('user1');
    expect(result.evicted).toBe(true);
    expect(result.evictedToken).toBe('t0');
    expect(authSessions.has('t0')).toBe(false);
  });

  it('不同用户的会话互不影响', () => {
    for (let i = 0; i < AUTH_CONSTANTS.MAX_SESSIONS_PER_USER; i++) {
      authSessions.set(`t_a_${i}`, { createdAt: Date.now(), code: 'userA', role: 'guest' });
    }
    authSessions.set('t_b_1', { createdAt: Date.now(), code: 'userB', role: 'guest' });

    const evictA = AuthService.checkAndEvictOldestSession('userA');
    expect(evictA.evicted).toBe(true);
    const evictB = AuthService.checkAndEvictOldestSession('userB');
    expect(evictB.evicted).toBe(false);
  });
});

describe('AuthService.generateToken', () => {
  it('生成指定长度的十六进制字符串', () => {
    const token = AuthService.generateToken();
    expect(token).toHaveLength(AUTH_CONSTANTS.TOKEN_BYTE_LENGTH * 2);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it('多次生成的 token 不同', () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 10; i++) {
      tokens.add(AuthService.generateToken());
    }
    expect(tokens.size).toBe(10);
  });
});
