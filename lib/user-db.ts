import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { atomicWriteTextSync } from '@/lib/atomic-write';
import { DATA_DIR } from '@/lib/data-dir';

const DB_DIR = DATA_DIR;
const USER_FILE = path.join(DB_DIR, 'users.json');
const BACKUP_DIR = path.join(DB_DIR, 'backups');
const INITIAL_ADMIN_FILE = path.join(DB_DIR, '.initial-admin-password.txt');

let writeLock = false;

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: 'admin' | 'guest';
  disabled: boolean;
  mustChangePassword: boolean;
  tempPasswordHash: string | null;
  tempPasswordCreatedAt: number | null;
  tempPasswordUsed: boolean;
  passwordChangedAt: string | null;
  createdAt: string;
  createdBy: string;
}

export interface IssuanceLog {
  id: string;
  username: string;
  issuedBy: string;
  issuedAt: string;
  usedAt: string | null;
  expiredAt: string | null;
}

export interface AuditLog {
  id: string;
  action: string;
  targetUser: string;
  operator: string;
  detail: string;
  timestamp: string;
}

export interface LoginLog {
  id: string;
  username: string;
  success: boolean;
  ip: string;
  userAgent: string;
  timestamp: string;
}

interface UserDB {
  users: User[];
  issuanceLogs: IssuanceLog[];
  auditLogs: AuditLog[];
  loginLogs: LoginLog[];
}

function ensureDb() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
    if (!fs.existsSync(USER_FILE)) {
      fs.writeFileSync(USER_FILE, JSON.stringify({ users: [], issuanceLogs: [], auditLogs: [], loginLogs: [] }, null, 2), 'utf-8');
    }
  } catch (err) {
    // build 时可能无 disk 挂载权限，runtime 再次调用即可
    if (process.env.NODE_ENV !== 'production' || process.env.RENDER) {
      // dev 或 Render 上记录但不抛
      console.warn('[user-db] ensureDb skipped:', (err as Error).message);
    }
  }
}

function readDb(): UserDB {
  ensureDb();
  try {
    const raw = fs.readFileSync(USER_FILE, 'utf-8');
    const db = JSON.parse(raw);
    if (!db.auditLogs) db.auditLogs = [];
    if (!db.loginLogs) db.loginLogs = [];
    for (const u of db.users) {
      if (u.disabled === undefined) u.disabled = false;
    }
    return db;
  } catch {
    return { users: [], issuanceLogs: [], auditLogs: [], loginLogs: [] };
  }
}

function backupDb() {
  try {
    ensureDb();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(BACKUP_DIR, `users-${ts}.json`);
    fs.copyFileSync(USER_FILE, backupFile);
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('users-')).sort();
    while (files.length > 10) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()!));
    }
  } catch {}
}

function writeDb(data: UserDB) {
  ensureDb();
  if (writeLock) {
    let waited = 0;
    while (writeLock && waited < 3000) {
      const start = Date.now();
      while (Date.now() - start < 50) {}
      waited += 50;
    }
  }
  writeLock = true;
  try {
    const tmpFile = USER_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpFile, USER_FILE);
  } finally {
    writeLock = false;
  }
}

function generateId(): string {
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function generateTempPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(special);
  const all = upper + lower + digits + special;
  for (let i = 0; i < 6; i++) pwd += pick(all);
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 8) errors.push('至少8位');
  if (!/[A-Z]/.test(password)) errors.push('需包含大写字母');
  if (!/[a-z]/.test(password)) errors.push('需包含小写字母');
  if (!/[0-9]/.test(password)) errors.push('需包含数字');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('需包含特殊符号');
  return { valid: errors.length === 0, errors };
}

export function findUserByUsername(username: string): User | undefined {
  const db = readDb();
  return db.users.find(u => u.username === username);
}

export function createUser(username: string, role: 'admin' | 'guest', createdBy: string): { user: User; tempPassword: string } {
  const db = readDb();
  if (db.users.find(u => u.username === username)) {
    throw new Error('用户名已存在');
  }
  const tempPassword = generateTempPassword();
  const tempPasswordHash = bcrypt.hashSync(tempPassword, 10);
  const user: User = {
    id: generateId(),
    username,
    passwordHash: '',
    role,
    disabled: false,
    mustChangePassword: true,
    tempPasswordHash,
    tempPasswordCreatedAt: Date.now(),
    tempPasswordUsed: false,
    passwordChangedAt: null,
    createdAt: new Date().toISOString(),
    createdBy,
  };
  db.users.push(user);
  db.issuanceLogs.push({
    id: 'log_' + Date.now().toString(36),
    username,
    issuedBy: createdBy,
    issuedAt: new Date().toISOString(),
    usedAt: null,
    expiredAt: null,
  });
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: 'create_user',
    targetUser: username,
    operator: createdBy,
    detail: `创建用户 ${username}，角色 ${role}`,
    timestamp: new Date().toISOString(),
  });
  backupDb();
  writeDb(db);
  return { user, tempPassword };
}

export function authenticateUser(username: string, password: string): { user: User; error?: string } {
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return { user: null as unknown as User, error: '用户名或密码错误' };

  if (user.disabled) return { user: null as unknown as User, error: '账号已被禁用，请联系管理员' };

  if (user.tempPasswordHash && !user.tempPasswordUsed) {
    if (user.tempPasswordCreatedAt && Date.now() - user.tempPasswordCreatedAt > 24 * 60 * 60 * 1000) {
      const db2 = readDb();
      const u = db2.users.find(u2 => u2.id === user.id)!;
      u.tempPasswordUsed = true;
      const log = db2.issuanceLogs.find(l => l.username === username && !l.usedAt && !l.expiredAt);
      if (log) log.expiredAt = new Date().toISOString();
      writeDb(db2);
      return { user: null as unknown as User, error: '临时密码已过期，请联系管理员重置' };
    }
    if (bcrypt.compareSync(password, user.tempPasswordHash)) {
      const db2 = readDb();
      const u = db2.users.find(u2 => u2.id === user.id)!;
      u.tempPasswordUsed = true;
      const log = db2.issuanceLogs.find(l => l.username === username && !l.usedAt);
      if (log) log.usedAt = new Date().toISOString();
      writeDb(db2);
      return { user: { ...user, tempPasswordUsed: true } };
    }
  }

  if (user.passwordHash && bcrypt.compareSync(password, user.passwordHash)) {
    return { user };
  }

  return { user: null as unknown as User, error: '用户名或密码错误' };
}

export function changePassword(username: string, newPassword: string, oldPassword?: string): { success: boolean; error?: string } {
  const validation = validatePassword(newPassword);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('，') };
  }
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return { success: false, error: '用户不存在' };

  if (oldPassword !== undefined) {
    const oldMatch = (user.passwordHash && bcrypt.compareSync(oldPassword, user.passwordHash))
      || (user.tempPasswordHash && !user.tempPasswordUsed && bcrypt.compareSync(oldPassword, user.tempPasswordHash));
    if (!oldMatch) return { success: false, error: '旧密码不正确' };
  }

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date().toISOString();
  user.tempPasswordHash = null;
  user.tempPasswordCreatedAt = null;
  user.tempPasswordUsed = false;
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: 'change_password',
    targetUser: username,
    operator: username,
    detail: '修改密码',
    timestamp: new Date().toISOString(),
  });
  writeDb(db);
  return { success: true };
}

export function resetUserPassword(username: string, resetBy: string): { tempPassword: string } | { error: string } {
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return { error: '用户不存在' };
  const tempPassword = generateTempPassword();
  user.tempPasswordHash = bcrypt.hashSync(tempPassword, 10);
  user.tempPasswordCreatedAt = Date.now();
  user.tempPasswordUsed = false;
  user.mustChangePassword = true;
  user.passwordHash = '';
  db.issuanceLogs.push({
    id: 'log_' + Date.now().toString(36),
    username,
    issuedBy: resetBy,
    issuedAt: new Date().toISOString(),
    usedAt: null,
    expiredAt: null,
  });
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: 'reset_password',
    targetUser: username,
    operator: resetBy,
    detail: `重置 ${username} 的密码`,
    timestamp: new Date().toISOString(),
  });
  backupDb();
  writeDb(db);
  return { tempPassword };
}

export function updateUserRole(username: string, newRole: 'admin' | 'guest', operator: string): { success: boolean; error?: string } {
  if (username === 'admin') return { success: false, error: '不能修改 admin 的角色' };
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return { success: false, error: '用户不存在' };
  const oldRole = user.role;
  user.role = newRole;
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: 'change_role',
    targetUser: username,
    operator,
    detail: `角色从 ${oldRole} 改为 ${newRole}`,
    timestamp: new Date().toISOString(),
  });
  writeDb(db);
  return { success: true };
}

export function toggleUserDisabled(username: string, operator: string): { success: boolean; disabled: boolean; error?: string } {
  if (username === 'admin') return { success: false, disabled: false, error: '不能禁用 admin 账号' };
  const db = readDb();
  const user = db.users.find(u => u.username === username);
  if (!user) return { success: false, disabled: false, error: '用户不存在' };
  user.disabled = !user.disabled;
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: user.disabled ? 'disable_user' : 'enable_user',
    targetUser: username,
    operator,
    detail: user.disabled ? `禁用用户 ${username}` : `启用用户 ${username}`,
    timestamp: new Date().toISOString(),
  });
  writeDb(db);
  return { success: true, disabled: user.disabled };
}

export function deleteUser(username: string, operator: string): boolean {
  if (username === 'admin') return false;
  const db = readDb();
  const idx = db.users.findIndex(u => u.username === username);
  if (idx === -1) return false;
  db.users.splice(idx, 1);
  db.auditLogs.push({
    id: 'audit_' + Date.now().toString(36),
    action: 'delete_user',
    targetUser: username,
    operator,
    detail: `删除用户 ${username}`,
    timestamp: new Date().toISOString(),
  });
  backupDb();
  writeDb(db);
  return true;
}

export function batchCreateUsers(usernames: string[], role: 'admin' | 'guest', createdBy: string): { results: { username: string; tempPassword?: string; error?: string }[] } {
  const results: { username: string; tempPassword?: string; error?: string }[] = [];
  for (const username of usernames) {
    const trimmed = username.trim();
    if (!trimmed || !/^[a-zA-Z0-9_]{3,20}$/.test(trimmed)) {
      results.push({ username: trimmed, error: '用户名需3-20位，仅限字母数字下划线' });
      continue;
    }
    try {
      const r = createUser(trimmed, role, createdBy);
      results.push({ username: trimmed, tempPassword: r.tempPassword });
    } catch (e: unknown) {
      results.push({ username: trimmed, error: e instanceof Error ? e.message : '创建失败' });
    }
  }
  return { results };
}

export function addLoginLog(username: string, success: boolean, ip: string, userAgent: string) {
  const db = readDb();
  db.loginLogs.push({
    id: 'login_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    username,
    success,
    ip,
    userAgent,
    timestamp: new Date().toISOString(),
  });
  if (db.loginLogs.length > 1000) {
    db.loginLogs = db.loginLogs.slice(-500);
  }
  writeDb(db);
}

export function markExpiredTempPasswords() {
  const db = readDb();
  const now = Date.now();
  let changed = false;
  for (const user of db.users) {
    if (user.tempPasswordHash && !user.tempPasswordUsed && user.tempPasswordCreatedAt) {
      if (now - user.tempPasswordCreatedAt > 24 * 60 * 60 * 1000) {
        user.tempPasswordUsed = true;
        const log = db.issuanceLogs.find(l => l.username === user.username && !l.usedAt && !l.expiredAt);
        if (log) log.expiredAt = new Date().toISOString();
        changed = true;
      }
    }
  }
  if (changed) writeDb(db);
}

export function getAllUsers(): User[] {
  return readDb().users;
}

export function getUserByUsername(username: string): User | null {
  return readDb().users.find(u => u.username === username) || null;
}

export function getIssuanceLogs(): IssuanceLog[] {
  return readDb().issuanceLogs;
}

export function getAuditLogs(limit = 100): AuditLog[] {
  const logs = readDb().auditLogs;
  return logs.slice(-limit).reverse();
}

export function getLoginLogs(limit = 100): LoginLog[] {
  const logs = readDb().loginLogs;
  return logs.slice(-limit).reverse();
}

function generateInitialAdminPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const all = upper + lower + digits + special;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = 0; i < 12; i++) pwd += pick(all);
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

export function initAdminIfEmpty(): void {
  const db = readDb();
  if (db.users.length === 0) {
    const envPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();
    const tempPassword = envPassword && envPassword.length >= 8
      ? envPassword
      : generateInitialAdminPassword();
    const fromEnv = tempPassword === envPassword;

    const tempPasswordHash = bcrypt.hashSync(tempPassword, 10);
    db.users.push({
      id: generateId(),
      username: 'admin',
      passwordHash: '',
      role: 'admin',
      disabled: false,
      mustChangePassword: true,
      tempPasswordHash,
      tempPasswordCreatedAt: Date.now(),
      tempPasswordUsed: false,
      passwordChangedAt: null,
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    });
    db.issuanceLogs.push({
      id: 'log_init',
      username: 'admin',
      issuedBy: 'system',
      issuedAt: new Date().toISOString(),
      usedAt: null,
      expiredAt: null,
    });
    writeDb(db);

    if (fromEnv) {
      console.log('[user-db] 初始管理员已创建: admin（密码来自 INITIAL_ADMIN_PASSWORD 环境变量）');
    } else {
      try {
        atomicWriteTextSync(
          INITIAL_ADMIN_FILE,
          `username: admin\npassword: ${tempPassword}\ncreatedAt: ${new Date().toISOString()}\n` +
          `note: 该临时密码 24 小时内有效，首次登录后必须修改。请妥善保管并在使用后删除本文件。\n`,
        );
        try { fs.chmodSync(INITIAL_ADMIN_FILE, 0o600); } catch {}
        console.log(`[user-db] 初始管理员已创建: admin（临时密码已写入 ${INITIAL_ADMIN_FILE}）`);
      } catch (err) {
        console.error('[user-db] 写入初始管理员密码文件失败，请检查 data 目录权限', err);
        throw err;
      }
    }
  }
}
