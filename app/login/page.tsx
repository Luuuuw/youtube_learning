'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { BookOpen, Loader2, User, Lock } from 'lucide-react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { loginWithAccount, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim()) { setError('请输入用户名'); return; }
    if (!password.trim()) { setError('请输入密码'); return; }
    setLoading(true);
    const result = await loginWithAccount(username.trim(), password.trim());
    setLoading(false);
    if (!result.success) {
      setError(result.error || '登录失败');
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
            <BookOpen className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">VibeEnglish</h1>
          <p className="text-muted-foreground mt-2 text-sm">沉浸式英语学习平台</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="relative">
            <User className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="用户名"
              autoComplete="username"
              autoFocus
              className={`w-full pl-11 pr-4 py-3 rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                error ? 'border-destructive' : 'border-border'
              }`}
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="密码"
              autoComplete="current-password"
              className={`w-full pl-11 pr-4 py-3 rounded-xl border bg-background text-foreground placeholder:text-muted-foreground/50 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                error ? 'border-destructive' : 'border-border'
              }`}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-medium transition-all hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" />验证中...</> : '登录'}
          </button>
        </form>

        <p className="text-center text-xs text-muted-foreground/50 mt-8">
          VibeEnglish — 沉浸式英语学习平台
        </p>
      </div>
    </div>
  );
}
