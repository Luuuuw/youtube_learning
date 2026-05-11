'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './theme-provider';

export default function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title={resolvedTheme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}
