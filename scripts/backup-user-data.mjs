// 从 Render 拉取用户数据备份到本地（用于 Render 故障后恢复 / 换部署）。
//
// 用法：
//   node scripts/backup-user-data.mjs
//
// 环境变量（可选）：
//   BACKUP_BASE_URL  服务地址，默认 https://vibe-english.onrender.com
//   ADMIN_TOKEN      已有 admin session token（提供则跳过登录）
//   ADMIN_USER       管理员用户名，默认 admin
//   ADMIN_PASS       管理员密码（缺省时交互式提示输入）
//   BACKUP_DIR       备份输出目录，默认 backups/

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';

const BASE = (process.env.BACKUP_BASE_URL || 'https://vibe-english.onrender.com').replace(/\/+$/, '');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';

function prompt(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(q).finally(() => rl.close());
}

async function main() {
  let token = process.env.ADMIN_TOKEN;
  if (!token) {
    let pass = process.env.ADMIN_PASS;
    if (!pass) pass = await prompt(`管理员 ${ADMIN_USER} 的密码: `);
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN_USER, password: pass }),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      console.error('[backup] 登录失败:', data?.error || `HTTP ${res.status}`);
      process.exit(1);
    }
    token = data.token;
  }

  const res = await fetch(`${BASE}/api/admin/backup`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error('[backup] 拉取失败: HTTP', res.status);
    process.exit(1);
  }

  const { generatedAt, files } = await res.json();
  const outDir = path.join(process.cwd(), process.env.BACKUP_DIR || 'backups', generatedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(outDir, { recursive: true });

  let count = 0;
  for (const [name, content] of Object.entries(files)) {
    if (!content) continue;
    fs.writeFileSync(path.join(outDir, name), content, 'utf-8');
    count++;
  }

  console.log(`[backup] 已保存 ${count} 个文件 → ${outDir}`);
}

main().catch((e) => {
  console.error('[backup] 出错:', e.message);
  process.exit(1);
});
