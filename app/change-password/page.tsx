'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, Loader2, CheckCircle2, XCircle, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

export default function ChangePasswordPage() {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mustChangePassword, clearMustChangePassword, isAuthenticated, isLoading: authLoading } = useAuth();

  const isForced = mustChangePassword;

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  const rules = [
    { label: '至少8位', test: (p: string) => p.length >= 8 },
    { label: '包含大写字母', test: (p: string) => /[A-Z]/.test(p) },
    { label: '包含小写字母', test: (p: string) => /[a-z]/.test(p) },
    { label: '包含数字', test: (p: string) => /[0-9]/.test(p) },
    { label: '包含特殊符号', test: (p: string) => /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(p) },
  ];

  const allValid = rules.every(r => r.test(newPassword));
  const matchConfirm = newPassword === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!isForced && !oldPassword.trim()) { setError('请输入旧密码'); return; }
    if (!allValid) { setError('密码不满足复杂度要求'); return; }
    if (!matchConfirm) { setError('两次输入的密码不一致'); return; }
    setLoading(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const body: { newPassword: string; oldPassword?: string } = { newPassword };
      if (!isForced) body.oldPassword = oldPassword;
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        clearMustChangePassword();
        router.push('/');
      } else {
        setError(data.error || '修改失败');
      }
    } catch {
      setError('网络错误，请重试');
    }
    setLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold">{isForced ? '设置新密码' : '修改密码'}</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            {isForced ? '首次登录需要设置您的专属密码' : '请输入旧密码和新密码'}
          </p>
        </div>

        {!isForced && (
          <div className="mb-4">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> 返回
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {!isForced && (
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={e => setOldPassword(e.target.value)}
                placeholder="旧密码"
                className="w-full pl-11 pr-4 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
            </div>
          )}

          <div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="新密码"
                autoFocus={isForced}
                className="w-full pl-11 pr-11 py-3 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {rules.map(rule => {
                const passed = rule.test(newPassword);
                return (
                  <div key={rule.label} className={`flex items-center gap-2 text-xs transition-colors ${passed ? 'text-green-500' : newPassword ? 'text-red-400' : 'text-muted-foreground/40'}`}>
                    {passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {rule.label}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="确认新密码"
              className={`w-full pl-11 pr-4 py-3 rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                confirmPassword && !matchConfirm ? 'border-red-400' : confirmPassword && matchConfirm ? 'border-green-500' : 'border-border'
              }`}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={loading || !allValid || !matchConfirm || (!isForced && !oldPassword)}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />提交中...</> : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  );
}
