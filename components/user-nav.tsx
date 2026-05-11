'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { User, LogOut, ChevronDown, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import ThemeToggle from '@/components/theme-toggle';

export function UserNav() {
  const { role, userCode, mustChangePassword, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm"
        >
          <User className="h-4 w-4" />
          <span className="max-w-[80px] truncate">{userCode}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1 w-40 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50">
            <Link
              href="/profile"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted transition-colors w-full"
            >
              <User className="h-4 w-4" /> 个人主页
            </Link>
            {!mustChangePassword && (
              <Link
                href="/change-password"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted transition-colors w-full"
              >
                <KeyRound className="h-4 w-4" /> 修改密码
              </Link>
            )}
            <button
              onClick={() => { setOpen(false); logout(); }}
              className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-muted transition-colors w-full text-red-500"
            >
              <LogOut className="h-4 w-4" /> 退出登录
            </button>
          </div>
        )}
      </div>
      <ThemeToggle />
    </div>
  );
}
