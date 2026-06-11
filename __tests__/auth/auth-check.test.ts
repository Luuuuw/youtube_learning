import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-service', () => ({
  AuthService: {
    validateSession: vi.fn(),
    cleanupInvalidSession: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

import { AuthService } from '@/lib/auth-service';
import { checkPageAuth } from '@/lib/auth-check';
import { cookies } from 'next/headers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkPageAuth', () => {
  it('无 cookie 返回未认证', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: () => undefined,
    } as any);

    const result = await checkPageAuth();
    expect(result.authenticated).toBe(false);
  });

  it('有效 token 返回认证成功', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => name === 've-session-token' ? { value: 'valid_token' } : undefined,
    } as any);

    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: true,
      session: { createdAt: Date.now(), code: 'user1', role: 'admin' },
      shouldDelete: false,
    });

    const result = await checkPageAuth();
    expect(result.authenticated).toBe(true);
    expect(result.username).toBe('user1');
    expect(result.role).toBe('admin');
  });

  it('过期 token 返回未认证并清理', async () => {
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => name === 've-session-token' ? { value: 'expired_token' } : undefined,
    } as any);

    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: false,
      session: { createdAt: 0, code: 'u1', role: 'guest' },
      shouldDelete: true,
    });

    const result = await checkPageAuth();
    expect(result.authenticated).toBe(false);
    expect(AuthService.cleanupInvalidSession).toHaveBeenCalledWith('expired_token');
  });
});
