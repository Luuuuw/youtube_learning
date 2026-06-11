'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export type UserRole = 'admin' | 'guest';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  role: UserRole | null;
  userCode: string | null;
  mustChangePassword: boolean;
  loginWithAccount: (username: string, password: string) => Promise<{ success: boolean; error?: string; mustChangePassword?: boolean }>;
  logout: () => void;
  clearMustChangePassword: () => void;
}

const AuthContext = createContext<AuthContextType>({
  isAuthenticated: false,
  isLoading: true,
  role: null,
  userCode: null,
  mustChangePassword: false,
  loginWithAccount: async () => ({ success: false }),
  logout: () => {},
  clearMustChangePassword: () => {},
});

const SESSION_KEY = 've-session-token';
const ROLE_KEY = 've-session-role';
const CODE_KEY = 've-session-code';
const MUST_CHANGE_KEY = 've-must-change-password';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState<UserRole | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const token = localStorage.getItem(SESSION_KEY);

    if (token) {
      fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
        .then(res => res.json())
        .then(data => {
          if (data.valid && data.role) {
            setIsAuthenticated(true);
            setRole(data.role);
            localStorage.setItem(ROLE_KEY, data.role);
            if (data.code) {
              setUserCode(data.code);
              localStorage.setItem(CODE_KEY, data.code);
            }
            if (data.mustChangePassword) {
              setMustChangePassword(true);
              localStorage.setItem(MUST_CHANGE_KEY, 'true');
              router.replace('/change-password');
            } else {
              setMustChangePassword(false);
              localStorage.removeItem(MUST_CHANGE_KEY);
            }
          } else {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(ROLE_KEY);
            localStorage.removeItem(CODE_KEY);
            localStorage.removeItem(MUST_CHANGE_KEY);
            setIsAuthenticated(false);
            setRole(null);
            setUserCode(null);
            setMustChangePassword(false);
          }
        })
        .catch(() => {
          setIsAuthenticated(false);
          setRole(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(CODE_KEY);
      localStorage.removeItem(MUST_CHANGE_KEY);
      document.cookie = 've-session-token=; path=/; max-age=0';
      setIsAuthenticated(false);
      setRole(null);
      setUserCode(null);
      setMustChangePassword(false);
      router.replace('/login');
    };
    window.addEventListener('ve-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('ve-unauthorized', handleUnauthorized);
  }, [router]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    }
    if (!isLoading && isAuthenticated && mustChangePassword && pathname !== '/change-password') {
      router.replace('/change-password');
    }
  }, [isLoading, isAuthenticated, mustChangePassword, pathname, router]);

  const loginWithAccount = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success && data.token && data.role) {
        localStorage.setItem(SESSION_KEY, data.token);
        localStorage.setItem(ROLE_KEY, data.role);
        setUserCode(data.code || username);
        localStorage.setItem(CODE_KEY, data.code || username);
        document.cookie = `ve-session-token=${data.token}; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax; Secure`;
        setIsAuthenticated(true);
        setRole(data.role);
        setUserCode(data.code || username);
        if (data.mustChangePassword) {
          setMustChangePassword(true);
          localStorage.setItem(MUST_CHANGE_KEY, 'true');
          router.push('/change-password');
        } else {
          setMustChangePassword(false);
          localStorage.removeItem(MUST_CHANGE_KEY);
          router.push('/');
        }
        return { success: true, mustChangePassword: data.mustChangePassword };
      }
      return { success: false, error: data.error || '用户名或密码错误' };
    } catch {
      return { success: false, error: '网络错误，请重试' };
    }
  }, [router]);

  const logout = useCallback(() => {
    const token = localStorage.getItem(SESSION_KEY);
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(MUST_CHANGE_KEY);
    document.cookie = 've-session-token=; path=/; max-age=0';
    setIsAuthenticated(false);
    setRole(null);
    setUserCode(null);
    setMustChangePassword(false);
    router.push('/login');
  }, [router]);

  const clearMustChangePassword = useCallback(() => {
    setMustChangePassword(false);
    localStorage.removeItem(MUST_CHANGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, role, userCode, mustChangePassword, loginWithAccount, logout, clearMustChangePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
