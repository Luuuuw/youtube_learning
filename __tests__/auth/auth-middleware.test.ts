import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-service', () => ({
  AuthService: {
    validateSession: vi.fn(),
    cleanupInvalidSession: vi.fn(),
  },
}));

import { verifyAuth, verifyAdmin, unauthorizedResponse, forbiddenResponse } from '@/lib/auth-middleware';
import { AuthService } from '@/lib/auth-service';

function mockRequest(authHeader?: string) {
  return {
    headers: {
      get: (name: string) => name === 'authorization' ? (authHeader ?? null) : null,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('verifyAuth', () => {
  it('无 authorization header 返回 invalid', () => {
    const result = verifyAuth(mockRequest());
    expect(result.valid).toBe(false);
  });

  it('空字符串 authorization 返回 invalid', () => {
    const result = verifyAuth(mockRequest(''));
    expect(result.valid).toBe(false);
  });

  it('有效 token 返回 valid + 用户信息', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: true,
      session: { createdAt: Date.now(), code: 'admin1', role: 'admin' },
      shouldDelete: false,
    });

    const result = verifyAuth(mockRequest('Bearer valid_token'));
    expect(result.valid).toBe(true);
    expect(result.code).toBe('admin1');
    expect(result.role).toBe('admin');
  });

  it('无效 token 返回 invalid 且不清理', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: false,
      shouldDelete: false,
    });

    const result = verifyAuth(mockRequest('Bearer bad_token'));
    expect(result.valid).toBe(false);
    expect(AuthService.cleanupInvalidSession).not.toHaveBeenCalled();
  });

  it('过期 token 返回 invalid 并清理', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: false,
      session: { createdAt: 0, code: 'u1', role: 'guest' },
      shouldDelete: true,
    });

    const result = verifyAuth(mockRequest('Bearer expired_token'));
    expect(result.valid).toBe(false);
    expect(AuthService.cleanupInvalidSession).toHaveBeenCalledWith('expired_token');
  });

  it('Bearer 前缀正确去除', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: true,
      session: { createdAt: Date.now(), code: 'u1', role: 'guest' },
      shouldDelete: false,
    });

    verifyAuth(mockRequest('Bearer abc123'));
    expect(AuthService.validateSession).toHaveBeenCalledWith('abc123');
  });
});

describe('verifyAdmin', () => {
  it('未认证时返回 invalid', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: false,
      shouldDelete: false,
    });

    const result = verifyAdmin(mockRequest('Bearer some_token'));
    expect(result.valid).toBe(false);
  });

  it('guest 角色返回 invalid', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: true,
      session: { createdAt: Date.now(), code: 'guest1', role: 'guest' },
      shouldDelete: false,
    });

    const result = verifyAdmin(mockRequest('Bearer guest_token'));
    expect(result.valid).toBe(false);
  });

  it('admin 角色返回 valid', () => {
    vi.mocked(AuthService.validateSession).mockReturnValue({
      valid: true,
      session: { createdAt: Date.now(), code: 'admin1', role: 'admin' },
      shouldDelete: false,
    });

    const result = verifyAdmin(mockRequest('Bearer admin_token'));
    expect(result.valid).toBe(true);
    expect(result.role).toBe('admin');
  });
});

describe('unauthorizedResponse / forbiddenResponse', () => {
  it('unauthorizedResponse 返回 401', () => {
    const res = unauthorizedResponse();
    expect(res.status).toBe(401);
  });

  it('forbiddenResponse 返回 403', () => {
    const res = forbiddenResponse();
    expect(res.status).toBe(403);
  });

  it('自定义消息', async () => {
    const res = unauthorizedResponse('请重新登录');
    const body = await res.json();
    expect(body.error).toBe('请重新登录');
  });
});
