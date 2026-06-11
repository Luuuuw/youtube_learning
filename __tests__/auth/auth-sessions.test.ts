import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-sessions-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('auth-constants', () => {
  it('SESSION_EXPIRY_MS 等于 7 天', async () => {
    const { AUTH_CONSTANTS } = await import('@/lib/auth-constants');
    expect(AUTH_CONSTANTS.SESSION_EXPIRY_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('MAX_SESSIONS_PER_USER 为 3', async () => {
    const { AUTH_CONSTANTS } = await import('@/lib/auth-constants');
    expect(AUTH_CONSTANTS.MAX_SESSIONS_PER_USER).toBe(3);
  });

  it('LOCKOUT_DURATION_MS 等于 15 分钟', async () => {
    const { AUTH_CONSTANTS } = await import('@/lib/auth-constants');
    expect(AUTH_CONSTANTS.LOCKOUT_DURATION_MS).toBe(15 * 60 * 1000);
  });

  it('TOKEN_BYTE_LENGTH 为 32', async () => {
    const { AUTH_CONSTANTS } = await import('@/lib/auth-constants');
    expect(AUTH_CONSTANTS.TOKEN_BYTE_LENGTH).toBe(32);
  });

  it('所有常量都是只读的 (as const)', async () => {
    const { AUTH_CONSTANTS } = await import('@/lib/auth-constants');
    const keys = Object.keys(AUTH_CONSTANTS);
    expect(keys.length).toBeGreaterThanOrEqual(7);
  });
});

describe('auth-sessions login attempts', () => {
  it('recordFailedAttempt 累加计数', async () => {
    const { recordFailedAttempt, checkRateLimit, clearFailedAttempts } = await import('@/lib/auth-sessions');

    const attemptsFile = path.join(process.cwd(), 'data', 'login-attempts.json');

    clearFailedAttempts('testuser_attempts1');

    recordFailedAttempt('testuser_attempts1', 5, 15 * 60 * 1000);
    const result = checkRateLimit('testuser_attempts1');
    expect(result.locked).toBe(false);

    clearFailedAttempts('testuser_attempts1');
  });

  it('达到最大尝试次数后锁定', async () => {
    const { recordFailedAttempt, checkRateLimit, clearFailedAttempts } = await import('@/lib/auth-sessions');

    clearFailedAttempts('testuser_attempts2');

    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('testuser_attempts2', 5, 15 * 60 * 1000);
    }

    const result = checkRateLimit('testuser_attempts2');
    expect(result.locked).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);

    clearFailedAttempts('testuser_attempts2');
  });

  it('clearFailedAttempts 清除锁定', async () => {
    const { recordFailedAttempt, checkRateLimit, clearFailedAttempts } = await import('@/lib/auth-sessions');

    clearFailedAttempts('testuser_attempts3');

    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('testuser_attempts3', 5, 15 * 60 * 1000);
    }

    expect(checkRateLimit('testuser_attempts3').locked).toBe(true);

    clearFailedAttempts('testuser_attempts3');
    expect(checkRateLimit('testuser_attempts3').locked).toBe(false);
  });
});

describe('auth-sessions invalidateUserSessions', () => {
  it('清除指定用户的所有会话', async () => {
    const mod = await import('@/lib/auth-sessions');
    const authSessions = mod.default;

    authSessions.set('inv_t1', { createdAt: Date.now(), code: 'inv_user', role: 'guest' });
    authSessions.set('inv_t2', { createdAt: Date.now(), code: 'inv_user', role: 'guest' });
    authSessions.set('inv_t3', { createdAt: Date.now(), code: 'other_user', role: 'admin' });

    const count = mod.invalidateUserSessions('inv_user');
    expect(count).toBe(2);
    expect(authSessions.has('inv_t1')).toBe(false);
    expect(authSessions.has('inv_t2')).toBe(false);
    expect(authSessions.has('inv_t3')).toBe(true);

    authSessions.delete('inv_t3');
  });
});

describe('auth-sessions updateUserSessionsRole', () => {
  it('更新指定用户所有会话的 role', async () => {
    const mod = await import('@/lib/auth-sessions');
    const authSessions = mod.default;

    authSessions.set('role_t1', { createdAt: Date.now(), code: 'role_user', role: 'guest' });
    authSessions.set('role_t2', { createdAt: Date.now(), code: 'role_user', role: 'guest' });
    authSessions.set('role_t3', { createdAt: Date.now(), code: 'other', role: 'admin' });

    mod.updateUserSessionsRole('role_user', 'admin');

    expect(authSessions.get('role_t1')?.role).toBe('admin');
    expect(authSessions.get('role_t2')?.role).toBe('admin');
    expect(authSessions.get('role_t3')?.role).toBe('admin');

    authSessions.delete('role_t1');
    authSessions.delete('role_t2');
    authSessions.delete('role_t3');
  });
});
