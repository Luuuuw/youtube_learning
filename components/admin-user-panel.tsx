'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, KeyRound, Trash2, Loader2, Copy, Check, Users, FileText, X, Shield, ShieldOff, Monitor, Search, ListPlus, ScrollText, LogIn } from 'lucide-react';

interface UserItem {
  id: string;
  username: string;
  role: string;
  disabled: boolean;
  mustChangePassword: boolean;
  tempPasswordUsed: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
  createdBy: string;
}

interface LogItem {
  id: string;
  username: string;
  issuedBy: string;
  issuedAt: string;
  usedAt: string | null;
  expiredAt: string | null;
}

interface SessionItem {
  token: string;
  code: string;
  role: string;
  createdAt: number;
}

interface AuditItem {
  id: string;
  action: string;
  targetUser: string;
  operator: string;
  detail: string;
  timestamp: string;
}

interface LoginLogItem {
  id: string;
  username: string;
  success: boolean;
  ip: string;
  userAgent: string;
  timestamp: string;
}

type TabType = 'users' | 'logs' | 'sessions' | 'audit' | 'logins';

export default function AdminUserPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [loginLogs, setLoginLogs] = useState<LoginLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'guest'>('guest');
  const [creating, setCreating] = useState(false);
  const [tempPwdResult, setTempPwdResult] = useState<{ username: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<TabType>('users');
  const [searchQuery, setSearchQuery] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchResults, setBatchResults] = useState<{ username: string; tempPassword?: string; error?: string }[] | null>(null);

  const fetchData = useCallback(async (t?: TabType) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      if (!token) {
        setErrorMsg('未登录，请先登录管理员账号');
        setLoading(false);
        return;
      }
      const currentTab = t || tab;
      const params = new URLSearchParams();
      if (searchQuery && currentTab === 'users') params.set('search', searchQuery);
      if (currentTab === 'audit' || currentTab === 'logins' || currentTab === 'sessions') params.set('tab', currentTab);
      const res = await fetch(`/api/admin/users?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (currentTab === 'audit') {
          setAuditLogs(data.auditLogs || []);
        } else if (currentTab === 'logins') {
          setLoginLogs(data.loginLogs || []);
        } else {
          setUsers(data.users || []);
          setLogs(data.logs || []);
          setSessions(data.sessions || []);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          setErrorMsg('登录已过期，请重新登录');
        } else if (res.status === 403) {
          setErrorMsg('无管理员权限，请使用管理员账号登录');
        } else {
          setErrorMsg(data.error || '加载失败');
        }
      }
    } catch {
      setErrorMsg('网络错误，请检查连接');
    }
    setLoading(false);
  }, [tab, searchQuery]);

  useEffect(() => {
    if (open) fetchData();
  }, [open, fetchData]);

  const handleTabChange = (t: TabType) => {
    setTab(t);
    fetchData(t);
  };

  const handleCreate = async () => {
    if (!newUsername.trim()) return;
    setCreating(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username: newUsername.trim(), role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        setTempPwdResult({ username: data.username, tempPassword: data.tempPassword });
        setNewUsername('');
        fetchData();
      } else {
        alert(data.error || '创建失败');
      }
    } catch {
      alert('网络错误');
    }
    setCreating(false);
  };

  const handleBatchCreate = async () => {
    const usernames = batchInput.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (usernames.length === 0) return;
    setCreating(true);
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ batch: true, usernames, role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        setBatchResults(data.results);
        setBatchInput('');
        fetchData();
      } else {
        alert(data.error || '批量创建失败');
      }
    } catch {
      alert('网络错误');
    }
    setCreating(false);
  };

  const handleReset = async (username: string) => {
    if (!confirm(`确定重置 ${username} 的密码？`)) return;
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (data.success) {
        setTempPwdResult({ username, tempPassword: data.tempPassword });
        fetchData();
      } else {
        alert(data.error || '重置失败');
      }
    } catch {
      alert('网络错误');
    }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`确定删除用户 ${username}？此操作不可恢复。`)) return;
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || '删除失败');
      }
    } catch {
      alert('网络错误');
    }
  };

  const handleRoleChange = async (username: string, newRole: 'admin' | 'guest') => {
    if (!confirm(`确定将 ${username} 的角色改为 ${newRole === 'admin' ? '管理员' : '普通用户'}？`)) return;
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'changeRole', username, newRole }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || '修改失败');
      }
    } catch {
      alert('网络错误');
    }
  };

  const handleToggleDisabled = async (username: string) => {
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'toggleDisabled', username }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || '操作失败');
      }
    } catch {
      alert('网络错误');
    }
  };

  const handleKickSession = async (sessionToken: string) => {
    try {
      const token = localStorage.getItem('ve-session-token') || '';
      const res = await fetch('/api/admin/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'kickSession', token: sessionToken }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || '踢出失败');
      }
    } catch {
      alert('网络错误');
    }
  };

  const copyPassword = () => {
    if (tempPwdResult) {
      navigator.clipboard.writeText(tempPwdResult.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const actionLabel: Record<string, string> = {
    create_user: '创建用户',
    delete_user: '删除用户',
    reset_password: '重置密码',
    change_password: '修改密码',
    change_role: '修改角色',
    disable_user: '禁用用户',
    enable_user: '启用用户',
  };

  if (!open) return null;

  const tabs: { key: TabType; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { key: 'users', icon: Users, label: '用户' },
    { key: 'sessions', icon: Monitor, label: '在线' },
    { key: 'logs', icon: FileText, label: '发放' },
    { key: 'audit', icon: ScrollText, label: '审计' },
    { key: 'logins', icon: LogIn, label: '登录' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-card rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="text-lg font-semibold">用户管理</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {tempPwdResult && (
            <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-600 dark:text-green-400">
                  {tempPwdResult.username} 的临时密码
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-background rounded-lg text-base font-mono tracking-wider">
                  {tempPwdResult.tempPassword}
                </code>
                <button onClick={copyPassword} className="p-2 rounded-lg hover:bg-muted transition-colors">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">请将此密码发送给用户，24小时内有效，首次登录后需修改</p>
            </div>
          )}

          {batchResults && (
            <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-green-600 dark:text-green-400">批量创建结果</span>
              </div>
              {batchResults.map((r, i) => (
                <div key={i} className="text-sm">
                  {r.error ? (
                    <span className="text-red-500">{r.username}: {r.error}</span>
                  ) : (
                    <span>{r.username}: <code className="px-1.5 py-0.5 bg-background rounded font-mono text-xs">{r.tempPassword}</code></span>
                  )}
                </div>
              ))}
              <button onClick={() => { navigator.clipboard.writeText(batchResults.filter(r => r.tempPassword).map(r => `${r.username}: ${r.tempPassword}`).join('\n')); }} className="text-xs text-primary hover:underline mt-1">复制全部</button>
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="新用户名"
                  className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary"
                  disabled={batchMode}
                />
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as 'admin' | 'guest')}
                  className="px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none"
                >
                  <option value="guest">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
                <button
                  onClick={batchMode ? handleBatchCreate : handleCreate}
                  disabled={creating || (batchMode ? !batchInput.trim() : !newUsername.trim())}
                  className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  创建
                </button>
              </div>

              {batchMode && (
                <textarea
                  value={batchInput}
                  onChange={e => setBatchInput(e.target.value)}
                  placeholder="每行一个用户名，或用逗号/分号分隔"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm outline-none focus:border-primary resize-none h-24"
                />
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setBatchMode(!batchMode); setBatchResults(null); }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs transition-colors ${batchMode ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  <ListPlus className="h-3.5 w-3.5" /> 批量创建
                </button>
                <div className="flex-1 relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && fetchData()}
                    placeholder="搜索用户名..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-background text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-0.5 bg-muted/50 rounded-lg p-0.5">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`flex items-center gap-1 flex-1 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                  tab === t.key ? 'bg-background shadow-sm' : 'text-muted-foreground'
                }`}
              >
                <t.icon className="h-3 w-3" /> {t.label}
              </button>
            ))}
          </div>

          {errorMsg && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400 text-center">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : errorMsg ? null : tab === 'users' ? (
            <div className="space-y-2">
              {users.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">暂无用户</p>
              ) : users.map(u => (
                <div key={u.id} className={`flex items-center gap-3 p-3 rounded-xl ${u.disabled ? 'bg-red-500/5 opacity-60' : 'bg-muted/30'}`}>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {u.username[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{u.username}</span>
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u.username, e.target.value as 'admin' | 'guest')}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium border-0 outline-none cursor-pointer ${
                          u.role === 'admin' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'
                        }`}
                        disabled={u.username === 'admin'}
                      >
                        <option value="guest">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                      {u.mustChangePassword && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-500">待改密</span>
                      )}
                      {u.disabled && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/10 text-red-500">已禁用</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      创建于 {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                      {u.passwordChangedAt && ` · 改密于 ${new Date(u.passwordChangedAt).toLocaleDateString('zh-CN')}`}
                    </div>
                  </div>
                  <button onClick={() => handleToggleDisabled(u.username)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title={u.disabled ? '启用' : '禁用'}>
                    {u.disabled ? <Shield className="h-4 w-4 text-green-500" /> : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
                  </button>
                  <button onClick={() => handleReset(u.username)} className="p-1.5 rounded-lg hover:bg-muted transition-colors" title="重置密码">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                  </button>
                  <button onClick={() => handleDelete(u.username)} className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors" title="删除用户" disabled={u.username === 'admin'}>
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'sessions' ? (
            <div className="space-y-2">
              {sessions.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">暂无在线终端</p>
              ) : sessions.map(s => (
                <div key={s.token} className="flex items-center gap-3 p-3 rounded-xl bg-muted/30">
                  <Monitor className="h-4 w-4 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{s.code}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        s.role === 'admin' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'
                      }`}>{s.role === 'admin' ? '管理员' : '用户'}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      登录于 {new Date(s.createdAt).toLocaleString('zh-CN')} · {s.token.slice(0, 8)}...
                    </div>
                  </div>
                  <button onClick={() => handleKickSession(s.token)} className="px-2.5 py-1 rounded-lg text-xs text-red-500 hover:bg-red-500/10 transition-colors">
                    踢出
                  </button>
                </div>
              ))}
            </div>
          ) : tab === 'logs' ? (
            <div className="space-y-2">
              {logs.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">暂无记录</p>
              ) : [...logs].reverse().map(l => (
                <div key={l.id} className="p-3 rounded-xl bg-muted/30 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{l.username}</span>
                    <span className="text-xs text-muted-foreground">{new Date(l.issuedAt).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    由 {l.issuedBy} 发放
                    {l.expiredAt ? ` · 已过期于 ${new Date(l.expiredAt).toLocaleString('zh-CN')}` : l.usedAt ? ` · 已使用于 ${new Date(l.usedAt).toLocaleString('zh-CN')}` : ' · 未使用'}
                  </div>
                </div>
              ))}
            </div>
          ) : tab === 'audit' ? (
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">暂无审计记录</p>
              ) : auditLogs.map(l => (
                <div key={l.id} className="p-3 rounded-xl bg-muted/30 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">{actionLabel[l.action] || l.action}</span>
                      <span className="font-medium">{l.targetUser}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(l.timestamp).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{l.detail} · 操作者: {l.operator}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {loginLogs.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">暂无登录记录</p>
              ) : loginLogs.map(l => (
                <div key={l.id} className="p-3 rounded-xl bg-muted/30 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${l.success ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="font-medium">{l.username}</span>
                      <span className={`text-[10px] ${l.success ? 'text-green-500' : 'text-red-500'}`}>{l.success ? '成功' : '失败'}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(l.timestamp).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">IP: {l.ip}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
