'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App Error Boundary]', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="max-w-2xl w-full space-y-4 text-left">
        <h2 className="text-xl font-bold text-center">页面出错了</h2>
        <div className="bg-muted rounded-lg p-3">
          <p className="text-sm font-medium break-all">{error.message || '未知错误'}</p>
          {error.digest && (
            <p className="text-xs text-muted-foreground mt-1">Digest: {error.digest}</p>
          )}
        </div>
        {error.stack && (
          <details open className="bg-muted/50 rounded-lg p-3">
            <summary className="cursor-pointer text-xs font-medium">错误堆栈</summary>
            <pre className="mt-2 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">{error.stack}</pre>
          </details>
        )}
        <div className="text-center">
          <button
            onClick={reset}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    </div>
  );
}
