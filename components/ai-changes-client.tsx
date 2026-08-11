'use client';

// AI 改动审批 + 历史看板
// 两个 tab：pending（待审）+ recent（最近 applied，可 revert）

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, AlertCircle, CheckCircle2, RefreshCw, ChevronRight, RotateCcw,
  Check, X,
} from 'lucide-react';

interface AiProposal {
  id: string;
  operation: string;
  targetFile: string;
  before: unknown;
  after: unknown;
  metadata: {
    model?: string;
    modelResponseId?: string;
    promptHash?: string;
    confidence?: number;
    videoId?: string;
    key?: string;
    nextCueText?: string;
    [k: string]: unknown;
  };
  actor: string;
  createdAt: string;
  status: 'pending' | 'applied' | 'rejected' | 'reverted';
}

interface AuditEntry {
  id: string;
  ts: string;
  proposalId: string;
  action: 'proposed' | 'applied' | 'rejected' | 'reverted';
  proposal?: AiProposal;
  snapshotPath?: string;
  durationMs?: number;
  errorMsg?: string;
  revertOfAuditId?: string;
}

type TabKey = 'pending' | 'recent';

function authHeaders(): Record<string, string> {
  const t = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function toPreview(v: unknown, maxLen = 400): string {
  if (v === undefined || v === null) return '(空)';
  if (typeof v === 'string') return v.length > maxLen ? v.slice(0, maxLen) + '…' : v;
  try {
    const s = JSON.stringify(v, null, 2);
    return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
  } catch { return String(v); }
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = diff / 60000;
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${Math.floor(mins)} 分钟前`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)} 小时前`;
  const days = hrs / 24;
  if (days < 30) return `${Math.floor(days)} 天前`;
  return iso.slice(0, 10);
}

const OP_COLOR: Record<string, string> = {
  'translate-segment': 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  'asr-fix-en': 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30',
  'translate-full-video': 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30',
  'flashcard-import': 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30',
};

function opChip(operation: string) {
  return OP_COLOR[operation] || 'bg-muted text-muted-foreground border-border';
}

export default function AiChangesClient() {
  const [tab, setTab] = useState<TabKey>('pending');
  const [pending, setPending] = useState<AiProposal[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 操作中（避免重复点）
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const showToast = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const loadPending = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/ai-pending', { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setPending(d.proposals || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch('/api/admin/ai-audit?action=applied&limit=50', { headers: authHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setAudit(d.entries || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'pending') loadPending();
    else loadAudit();
  }, [tab, loadPending, loadAudit]);

  const grouped = useMemo(() => {
    const map = new Map<string, AiProposal[]>();
    for (const p of pending) {
      const k = p.operation;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(p);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [pending]);

  const handleApprove = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
    try {
      const r = await fetch('/api/admin/ai-pending/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const ok = (d.results as Array<{ status: string }>).filter(x => x.status === 'applied').length;
      showToast('ok', `已通过 ${ok}/${ids.length}`);
      await loadPending();
    } catch (e) {
      showToast('err', `通过失败: ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    }
  }, [loadPending, showToast]);

  const handleReject = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });
    try {
      const r = await fetch('/api/admin/ai-pending/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ ids }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      showToast('ok', `已拒绝 ${d.rejected}/${ids.length}`);
      await loadPending();
    } catch (e) {
      showToast('err', `拒绝失败: ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusyIds(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    }
  }, [loadPending, showToast]);

  const handleBulk = useCallback(async (action: 'approve' | 'reject') => {
    if (pending.length === 0) return;
    const verb = action === 'approve' ? '通过' : '拒绝';
    if (!window.confirm(`${verb}全部 ${pending.length} 条 pending 提案？`)) return;
    setBulkBusy(true);
    try {
      const ids = pending.map(p => p.id);
      if (action === 'approve') await handleApprove(ids);
      else await handleReject(ids);
    } finally {
      setBulkBusy(false);
    }
  }, [pending, handleApprove, handleReject]);

  const handleRevert = useCallback(async (auditId: string) => {
    if (!window.confirm('revert 该改动 → 从 snapshot 恢复 target 文件。继续？')) return;
    try {
      const r = await fetch('/api/admin/ai-revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ auditId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.reason || `HTTP ${r.status}`);
      showToast('ok', 'revert 成功');
      await loadAudit();
    } catch (e) {
      showToast('err', `revert 失败: ${e instanceof Error ? e.message : ''}`);
    }
  }, [loadAudit, showToast]);

  return (
    <div className="space-y-6">
      {/* Tab 切换 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex gap-1 bg-muted/40 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setTab('pending')}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              tab === 'pending'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            待审 {pending.length > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">{pending.length}</span>}
          </button>
          <button
            type="button"
            onClick={() => setTab('recent')}
            className={`px-3 py-1 rounded-md text-sm transition-colors ${
              tab === 'recent'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            最近改动
          </button>
        </div>
        <button
          type="button"
          onClick={() => tab === 'pending' ? loadPending() : loadAudit()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1 text-sm border border-border rounded-md hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {err && (
        <div className="px-3 py-2 rounded border border-red-500/30 bg-red-500/5 text-sm text-red-700 dark:text-red-300 inline-flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />{err}
        </div>
      )}

      {tab === 'pending' && (
        <>
          {/* 批量操作 */}
          {pending.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => handleBulk('approve')}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-emerald-500 hover:bg-emerald-600 text-white font-medium disabled:opacity-50"
              >
                <Check className="h-4 w-4" />全部通过（{pending.length}）
              </button>
              <button
                type="button"
                onClick={() => handleBulk('reject')}
                disabled={bulkBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-red-500 hover:bg-red-600 text-white font-medium disabled:opacity-50"
              >
                <X className="h-4 w-4" />全部拒绝
              </button>
            </div>
          )}

          {/* Pending 提案分组 */}
          {!loading && pending.length === 0 && !err && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              🎉 没有待审 AI 改动
            </div>
          )}

          {grouped.map(([op, list]) => (
            <div key={op} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${opChip(op)}`}>
                  {op}
                </span>
                <span className="text-sm text-muted-foreground">{list.length} 条</span>
              </div>

              {list.map(p => (
                <div key={p.id} className="bg-card border border-border rounded-xl p-4 space-y-3">
                  {/* meta */}
                  <div className="flex items-start justify-between gap-2 flex-wrap text-xs">
                    <div className="space-y-1 min-w-0">
                      <div className="font-mono text-muted-foreground truncate" title={p.id}>id: {p.id}</div>
                      <div className="text-muted-foreground">
                        actor: <span className="font-medium text-foreground">{p.actor}</span>
                        {p.metadata.videoId && <> · video: <span className="font-mono">{p.metadata.videoId}</span></>}
                        {p.metadata.model && <> · model: <span className="font-mono">{p.metadata.model}</span></>}
                        {typeof p.metadata.confidence === 'number' && <> · conf: {(p.metadata.confidence * 100).toFixed(0)}%</>}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground/70 truncate" title={p.targetFile}>{p.targetFile}</div>
                      <div className="text-muted-foreground/70">{relativeTime(p.createdAt)}</div>
                    </div>
                  </div>

                  {/* diff view */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="border-l-2 border-red-500/40 bg-red-500/5 rounded px-2 py-1.5">
                      <div className="text-[10px] text-red-700 dark:text-red-400 font-medium mb-1">before</div>
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono">{toPreview(p.before)}</pre>
                    </div>
                    <div className="border-l-2 border-emerald-500/40 bg-emerald-500/5 rounded px-2 py-1.5">
                      <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium mb-1">after</div>
                      <pre className="text-xs whitespace-pre-wrap break-words font-mono">{toPreview(p.after)}</pre>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleApprove([p.id])}
                      disabled={busyIds.has(p.id) || bulkBusy}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 disabled:opacity-50"
                    >
                      {busyIds.has(p.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}通过
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReject([p.id])}
                      disabled={busyIds.has(p.id) || bulkBusy}
                      className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />拒绝
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === 'recent' && (
        <div className="space-y-2">
          {!loading && audit.length === 0 && !err && (
            <div className="text-center py-12 text-sm text-muted-foreground">没有最近的 AI 改动</div>
          )}
          {audit.map(e => (
            <div key={e.id} className="bg-card border border-border rounded-xl p-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="space-y-0.5 text-xs min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span className="font-mono text-foreground truncate">{e.proposalId}</span>
                </div>
                <div className="text-muted-foreground">
                  applied {relativeTime(e.ts)}{e.durationMs && <> · {e.durationMs}ms</>}
                </div>
                {e.snapshotPath && (
                  <div className="font-mono text-[10px] text-muted-foreground/70 truncate" title={e.snapshotPath}>
                    snapshot: {e.snapshotPath}
                  </div>
                )}
              </div>
              {e.snapshotPath && (
                <button
                  type="button"
                  onClick={() => handleRevert(e.id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 shrink-0"
                >
                  <RotateCcw className="h-3 w-3" />revert
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg text-sm border ${
            toast.kind === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/40 text-red-700 dark:text-red-400'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
