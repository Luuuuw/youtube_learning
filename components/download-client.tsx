'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, Play, Loader2, CheckCircle, XCircle, FileText, Trash2, Home } from 'lucide-react';

interface DownloadProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  completed: number;
  failed: number;
  currentUrl: string;
  currentTitle: string;
  logs: string[];
}

function parseDownloadPercent(logs: string[]): number {
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = logs[i].match(/(\d+(?:\.\d+)?)\s*%\s*of/i);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

export default function DownloadClient() {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const parseMarkdownUrls = (text: string): string[] => {
    const lines = text.split('\n');
    const found: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/https?:\/\/\S+/);
      if (match) {
        found.push(match[0]);
      }
    }
    return found;
  };

  const handleFile = async (file: File) => {
    setIsUploading(true);
    try {
      const text = await file.text();
      const found = parseMarkdownUrls(text);
      setUrls((prev) => {
        const combined = [...prev, ...found];
        return Array.from(new Set(combined));
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const removeUrl = (idx: number) => {
    setUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearAll = () => setUrls([]);

  const startDownload = async () => {
    if (urls.length === 0) return;
    setIsDownloading(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/batch-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error || '启动下载失败');
        setIsDownloading(false);
        return;
      }
      pollProgress();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : '下载失败');
      setIsDownloading(false);
    }
  };

  const pollProgress = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/download-progress');
        const data = await res.json();
        setProgress(data);
        if (data.status === 'completed' || data.status === 'error') {
          setIsDownloading(false);
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === 'completed') router.refresh();
        }
      } catch {}
    }, 1500);
  }, [router]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const overallPct = progress && progress.total > 0
    ? ((progress.completed + progress.failed) / progress.total) * 100
    : 0;
  const videoPct = progress ? parseDownloadPercent(progress.logs) : 0;
  const displayPct = progress && progress.status === 'running' && videoPct > 0
    ? overallPct + (videoPct / progress.total)
    : overallPct;

  return (
    <div className="space-y-6">
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/50'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt,.markdown"
          className="hidden"
          onChange={handleInputChange}
        />
        <Upload className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-sm font-medium text-foreground">
          {isUploading ? '正在解析...' : '点击或拖拽上传 .md / .txt 文件'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          支持 Markdown 文件，会自动提取其中的 YouTube 链接
        </p>
      </div>

      {/* URL List */}
      {urls.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">待下载列表</span>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {urls.length}
              </span>
            </div>
            <button
              onClick={clearAll}
              className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1 transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              清空
            </button>
          </div>
          <div className="max-h-[240px] overflow-y-auto">
            {urls.map((url, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
              >
                <span className="text-xs text-muted-foreground truncate max-w-[500px]">
                  {url}
                </span>
                <button
                  onClick={() => removeUrl(i)}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-border">
            <button
              onClick={startDownload}
              disabled={isDownloading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {isDownloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  下载中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  开始下载
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {progress && progress.status !== 'idle' && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {progress.status === 'running' && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              {progress.status === 'completed' && <CheckCircle className="h-4 w-4 text-green-500" />}
              {progress.status === 'error' && <XCircle className="h-4 w-4 text-destructive" />}
              <span className="text-sm font-medium">
                {progress.status === 'running' && '正在下载...'}
                {progress.status === 'completed' && '下载完成'}
                {progress.status === 'error' && '下载出错'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {progress.completed + progress.failed} / {progress.total} 个视频
              </span>
              <span className="text-xs font-mono font-medium tabular-nums">
                {Math.round(displayPct)}%
              </span>
            </div>
          </div>

          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ease-out ${
                progress.status === 'error' ? 'bg-destructive' :
                progress.status === 'completed' ? 'bg-green-500' : 'bg-primary'
              }`}
              style={{ width: `${Math.min(displayPct, 100)}%` }}
            />
          </div>

          {(progress.currentTitle || (progress.status === 'running' && videoPct > 0)) && (
            <p className="text-xs text-muted-foreground truncate">
              {progress.currentTitle || '正在下载...'}
              {progress.status === 'running' && videoPct > 0 && !progress.currentTitle && ''}
              {progress.status === 'running' && videoPct > 0 ? ` (${videoPct.toFixed(0)}%)` : ''}
            </p>
          )}

          {progress.status === 'completed' && (
            <button
              onClick={() => router.push('/')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-lg text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <Home className="h-4 w-4" />
              返回首页查看新视频
            </button>
          )}

          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none">
              展开日志 ({progress.logs.length})
            </summary>
            <div className="mt-2 bg-muted rounded-lg p-3 max-h-[200px] overflow-y-auto text-xs font-mono space-y-1">
              {progress.logs.slice(-30).map((log, i) => (
                <div key={i} className={`whitespace-pre-wrap break-all ${log.startsWith('[ERR]') ? 'text-destructive' : log.includes('下载完成') ? 'text-green-600 dark:text-green-400' : log.includes('下载失败') ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {log}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
