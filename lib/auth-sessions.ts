type AuthSession = { createdAt: number; code: string; role: 'admin' | 'guest'; mustChangePassword?: boolean };

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const SESSION_FILE = path.join(DATA_DIR, 'sessions.json');
const ATTEMPTS_FILE = path.join(DATA_DIR, 'login-attempts.json');

const globalForSessions = globalThis as unknown as {
  __authSessions: Map<string, AuthSession> | undefined;
};

const authSessions = globalForSessions.__authSessions ?? new Map<string, AuthSession>();

if (!globalForSessions.__authSessions) {
  globalForSessions.__authSessions = authSessions;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
      const entries: [string, AuthSession][] = JSON.parse(raw);
      const now = Date.now();
      for (const [token, session] of entries) {
        if (now - session.createdAt < 7 * 24 * 60 * 60 * 1000) {
          authSessions.set(token, session);
        }
      }
    }
  } catch {}
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function persistSessions() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const entries = Array.from(authSessions.entries());
      fs.writeFileSync(SESSION_FILE, JSON.stringify(entries), 'utf-8');
    } catch {}
  }, 2000);
}

export function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const raw = fs.readFileSync(SESSION_FILE, 'utf-8');
      const entries: [string, AuthSession][] = JSON.parse(raw);
      const now = Date.now();
      authSessions.clear();
      for (const [token, session] of entries) {
        if (now - session.createdAt < 7 * 24 * 60 * 60 * 1000) {
          authSessions.set(token, session);
        }
      }
    }
  } catch {}
}

interface LoginAttempt {
  count: number;
  lockedUntil: number;
}

function readAttempts(): Map<string, LoginAttempt> {
  try {
    if (fs.existsSync(ATTEMPTS_FILE)) {
      const raw = fs.readFileSync(ATTEMPTS_FILE, 'utf-8');
      const obj: Record<string, LoginAttempt> = JSON.parse(raw);
      const map = new Map<string, LoginAttempt>();
      const now = Date.now();
      for (const [k, v] of Object.entries(obj)) {
        if (!v.lockedUntil || v.lockedUntil > now || v.count > 0) {
          map.set(k, v);
        }
      }
      return map;
    }
  } catch {}
  return new Map();
}

function writeAttempts(map: Map<string, LoginAttempt>) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj: Record<string, LoginAttempt> = {};
    map.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(obj), 'utf-8');
  } catch {}
}

export function checkRateLimit(username: string): { locked: boolean; remaining?: number } {
  const attempts = readAttempts();
  const attempt = attempts.get(username);
  if (attempt && attempt.lockedUntil > Date.now()) {
    return { locked: true, remaining: Math.ceil((attempt.lockedUntil - Date.now()) / 60000) };
  }
  if (attempt && attempt.lockedUntil <= Date.now() && attempt.lockedUntil > 0) {
    attempts.delete(username);
    writeAttempts(attempts);
  }
  return { locked: false };
}

export function recordFailedAttempt(username: string, maxAttempts: number, lockoutMs: number) {
  const attempts = readAttempts();
  const attempt = attempts.get(username) || { count: 0, lockedUntil: 0 };
  attempt.count++;
  if (attempt.count >= maxAttempts) {
    attempt.lockedUntil = Date.now() + lockoutMs;
    attempt.count = 0;
  }
  attempts.set(username, attempt);
  writeAttempts(attempts);
}

export function clearFailedAttempts(username: string) {
  const attempts = readAttempts();
  attempts.delete(username);
  writeAttempts(attempts);
}

export function updateUserSessionsRole(username: string, newRole: 'admin' | 'guest') {
  let changed = false;
  authSessions.forEach((session) => {
    if (session.code === username && session.role !== newRole) {
      session.role = newRole;
      changed = true;
    }
  });
  if (changed) persistSessions();
}

export function invalidateUserSessions(username: string) {
  const toDelete: string[] = [];
  authSessions.forEach((session, token) => {
    if (session.code === username) {
      toDelete.push(token);
    }
  });
  toDelete.forEach(t => authSessions.delete(t));
  if (toDelete.length > 0) persistSessions();
  return toDelete.length;
}

export default authSessions;
