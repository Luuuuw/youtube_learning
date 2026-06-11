# VibeEnglish 开发文档

> 这份文档是给自己看的，记录项目的关键配置、架构细节和日常操作。

---

## 1. 技术栈总览

### 前端

| 技术 | 版本 | 用途 |
|------|------|------|
| Next.js | 14.2 | React 全栈框架，App Router |
| React | 18.3 | UI 组件 |
| TypeScript | 5.6 | 类型安全 |
| Tailwind CSS | 3.4 | 原子化 CSS |
| Plyr | 3.7 | 视频播放器 |
| D3.js | 7.9 | 生词 MindMap 力导向图 |
| Recharts | 3.8 | 数据看板图表 |
| Lucide React | 0.324 | 图标库 |

### 后端

| 技术 | 用途 |
|------|------|
| Next.js API Routes | 全部服务端 API |
| bcryptjs | 密码哈希（salt rounds = 10） |
| JSON 文件存储 | 用户、生词、活动记录等数据持久化 |
| MiniMax AI API | 查词、口音分类、学习建议、翻译 |
| yt-dlp + FFmpeg | YouTube 视频下载 |

### 数据文件

| 文件 | 内容 | 关键字段 |
|------|------|----------|
| `data/users.json` | 用户账号、密码哈希、发放记录、审计日志、登录日志 | `users[]`, `issuanceLogs[]`, `auditLogs[]`, `loginLogs[]` |
| `data/vocab.json` | 用户生词数据 | 按用户名分组 |
| `data/activity.json` | 学习活动记录 | 按日期记录 |
| `data/review-log.json` | 复习日志 | 间隔复习进度 |
| `public/content/` | 视频、字幕、缩略图 | 按视频 ID 分目录 |

---

## 2. 用户认证系统

### 数据库说明

**本项目没有使用传统数据库**，所有数据以 JSON 文件存储在 `data/` 目录下：

| 文件 | 内容 | 读写方式 |
|------|------|----------|
| `data/users.json` | 用户账号、密码哈希、发放记录、审计日志、登录日志 | `lib/user-db.ts` 读写 |
| `data/sessions.json` | 会话持久化 | `lib/auth-sessions.ts` 读写 |
| `data/login-attempts.json` | 登录失败次数记录 | `lib/auth-sessions.ts` 读写 |
| `data/backups/` | 数据备份（最多保留10份） | 自动创建 |
| `data/vocab.json` | 生词数据 | `lib/vocab-db.ts` 读写 |
| `data/activity.json` | 学习活动 | `lib/activity-db.ts` 读写 |
| `data/review-log.json` | 复习日志 | 直接读写 |

会话数据（`authSessions`）存储在**服务器内存**中（`lib/auth-sessions.ts`），并持久化到 `data/sessions.json`，服务器重启后会话不丢失。

**为什么不用数据库？** 项目规模小、用户量少，JSON 文件足够。如果将来需要迁移到数据库，只需修改 `lib/user-db.ts` 中的读写函数，上层代码无需改动。

### 架构

```
登录页 (app/login/page.tsx)
  └── 账号登录 → POST /api/auth/login {username, password}

认证上下文 (lib/auth-context.tsx)
  └── 全局状态: token, role, mustChangePassword

会话管理 (lib/auth-sessions.ts)
  └── 内存 Map<token, Session> + 文件持久化，7天过期自动清理
  └── 登录失败次数限制（5次锁定15分钟）

用户数据 (lib/user-db.ts)
  └── data/users.json 读写，bcrypt 哈希
```

### 终端限制

每个账号最多 **3 个终端同时在线**。登录时检查该用户已有的活跃 session 数量：
- 未达到上限 → 正常登录，创建新 session
- 已达上限 → 返回 403 错误："该账号已在 3 个终端登录，请先退出其他设备"

退出方式：
1. **主动退出** — 点击页面右上角用户菜单中的"退出登录"，调用 `POST /api/auth/logout` 释放 session
2. **被动失效** — session 7 天后自动过期清理
3. **管理员踢出** — 管理员在用户管理面板的"在线"标签页中踢出指定终端

### 登录流程

1. 用户提交 `username` + `password`
2. 检查登录失败次数限制（5次失败后锁定15分钟）
3. `authenticateUser()` 检查：
   - 用户名是否存在
   - 账号是否被禁用
   - 如果有临时密码且未使用 → 比对临时密码哈希，标记 `tempPasswordUsed = true`
   - 如果有正式密码 → 比对正式密码哈希
   - 临时密码超过 24h → 拒绝登录，标记过期
4. 检查该用户已有活跃 session 数量，≥3 则拒绝
5. 登录成功 → 生成 token，存入 `authSessions` Map，持久化到文件
6. 返回 `{ success, token, role, mustChangePassword }`
7. 前端检测 `mustChangePassword === true` → 跳转 `/change-password`

### 密码安全规则

- **临时密码**: 自动生成 10 位随机字符串（含大小写+数字+特殊符号）
- **临时密码过期**: 24 小时后失效（`tempPasswordCreatedAt` 时间戳比对）
- **临时密码一次性**: 使用后 `tempPasswordUsed = true`，不可再用
- **密码复杂度**: `validatePassword()` 校验
  - ≥ 8 位
  - 必须包含大写字母
  - 必须包含小写字母
  - 必须包含数字
  - 必须包含特殊符号 `!@#$%^&*()_+-=[]{};':"\|,.<>/?`
- **密码存储**: bcrypt hash，salt rounds = 10

### 默认管理员账户

| 项目 | 值 |
|------|------|
| **用户名** | `admin` |
| **密码** | `Sztu@123456` |
| **角色** | `admin` |

> **注意**: 生产环境部署前务必修改此默认密码！

### 初始管理员

首次启动时 `initAdminIfEmpty()` 自动创建：

| 项目 | 值 |
|------|------|
| 用户名 | `admin` |
| 当前密码 | `Sztu@123456` |
| 角色 | `admin` |
| 首次登录 | 必须修改密码 |

> **注意**: 临时密码 `Admin@2026` 仅在首次创建时有效，登录后会被强制要求修改密码。如果已经修改过密码，则使用修改后的密码登录。

**重置方法**：删除 `data/users.json`，重启服务器，自动重建 admin 账号（临时密码恢复为 `Admin@2026`）。

---

## 3. 账户密码发放流程（管理员操作手册）

### 前提条件

你必须以 **admin 角色登录**，才能看到用户管理面板。登录后在首页右上角点击「用户管理」按钮。

### 创建新用户（发放账户）

1. 登录 admin 账号，进入首页
2. 点击右上角「用户管理」按钮，打开管理面板
3. 在「创建用户」区域：
   - 输入用户名（3-20 位，仅限字母数字下划线）
   - 选择角色（admin / guest）
   - 点击「创建」
4. 系统生成临时密码，弹窗显示 **用户名 + 临时密码**
5. **立即将临时密码告知用户**（临时密码 24 小时后失效）
6. 发放记录自动写入 `issuanceLogs`

### 用户首次登录

1. 用户在登录页选择「账号登录」
2. 输入管理员告知的用户名和临时密码
3. 系统强制跳转到修改密码页
4. 用户设置自己的新密码（需满足复杂度要求）
5. 修改成功后自动跳转首页，正常使用

### 重置用户密码

1. 在用户管理面板，找到目标用户
2. 点击「重置密码」按钮
3. 系统生成新的临时密码，弹窗显示
4. 告知用户新的临时密码
5. 用户用临时密码登录后，再次被强制修改密码

### 删除用户

1. 在用户管理面板，找到目标用户
2. 点击「删除」按钮
3. 确认删除
4. 该用户的所有 session 立即失效

### 查看发放记录

用户管理面板底部显示所有密码发放记录：
- 谁发放的（issuedBy）
- 发给谁（username）
- 发放时间（issuedAt）
- 是否已使用（usedAt）
- 是否过期（expiredAt）

### 管理操作汇总

| 操作 | 入口 | API | 说明 |
|------|------|-----|------|
| 创建用户 | 管理面板 → 创建用户 | `POST /api/admin/users` | 返回临时密码 |
| 批量创建 | 管理面板 → 批量创建 | `POST /api/admin/users` | body 含 `batch: true` |
| 重置密码 | 管理面板 → 重置密码 | `PUT /api/admin/users` | 返回新临时密码 |
| 修改角色 | 管理面板 → 角色下拉 | `PUT /api/admin/users` | action: `changeRole` |
| 启用/禁用 | 管理面板 → 盾牌图标 | `PUT /api/admin/users` | action: `toggleDisabled` |
| 删除用户 | 管理面板 → 删除 | `DELETE /api/admin/users` | 不可恢复 |
| 踢出终端 | 管理面板 → 在线标签 | `PUT /api/admin/users` | action: `kickSession` |
| 查看用户列表 | 管理面板 | `GET /api/admin/users` | 含发放记录 |
| 查看审计日志 | 管理面板 → 审计标签 | `GET /api/admin/users?tab=audit` | 最近200条 |
| 查看登录日志 | 管理面板 → 登录标签 | `GET /api/admin/users?tab=logins` | 最近200条 |
| 搜索用户 | 管理面板 → 搜索框 | `GET /api/admin/users?search=xxx` | 按用户名/角色筛选 |
| 修改自己密码 | 右上角菜单 | `POST /api/auth/change-password` | 需验证旧密码 |
| 退出登录 | 右上角菜单 | `POST /api/auth/logout` | 释放终端 |

### 直接编辑数据文件（高级）

如果管理面板不可用，可以直接编辑 `data/users.json`：

```json
{
  "users": [
    {
      "id": "u_xxx",
      "username": "admin",
      "passwordHash": "$2a$10$...",
      "role": "admin",
      "disabled": false,
      "mustChangePassword": false,
      "tempPasswordHash": null,
      "tempPasswordCreatedAt": null,
      "tempPasswordUsed": false,
      "passwordChangedAt": "2026-05-09T00:00:00.000Z",
      "createdAt": "2026-05-09T00:00:00.000Z",
      "createdBy": "system"
    }
  ],
  "issuanceLogs": [...],
  "auditLogs": [
    {
      "id": "audit_xxx",
      "action": "create_user",
      "targetUser": "newuser",
      "operator": "admin",
      "detail": "创建用户 newuser，角色 guest",
      "timestamp": "2026-05-09T00:00:00.000Z"
    }
  ],
  "loginLogs": [
    {
      "id": "login_xxx",
      "username": "admin",
      "success": true,
      "ip": "127.0.0.1",
      "userAgent": "Mozilla/5.0...",
      "timestamp": "2026-05-09T00:00:00.000Z"
    }
  ]
}
```

**重置所有用户**：删除 `data/users.json`，重启服务器，自动重建 admin 账号。

---

## 4. API 路由一览

### 认证 & 用户

| 路由 | 方法 | 说明 | 鉴权 |
|------|------|------|------|
| `/api/auth/login` | POST | 登录（账号密码） | 无 |
| `/api/auth/verify` | GET | 验证 token 有效性 | Bearer token |
| `/api/auth/logout` | POST | 退出登录，释放终端 | Bearer token |
| `/api/auth/change-password` | POST | 修改密码 | Bearer token |
| `/api/admin/users` | GET | 获取用户列表和发放记录 | Bearer token (admin) |
| `/api/admin/users` | POST | 创建用户，返回临时密码 | Bearer token (admin) |
| `/api/admin/users` | DELETE | 删除用户 | Bearer token (admin) |
| `/api/admin/users` | PUT | 重置密码 / 修改角色 / 启用禁用 / 踢出终端 | Bearer token (admin) |
| `/api/user/profile` | GET/POST | 用户资料 | Bearer token |

---

## 5. MiniMax API 配置

### 配置步骤

1. 在项目根目录创建 `.env.local` 文件
2. 添加你的 MiniMax API Key：
   ```
   MINIMAX_API_KEY=your-minimax-api-key-here
   ```
3. 重启开发服务器

### 相关文件

- `app/api/lookup/route.ts` — MiniMax API 代理路由，支持多种 promptType：
  - `dictionary`（默认）— 英汉词典释义
  - `accent` — 口音分类，返回 british/american/other
  - `dashboard` — 学习数据分析建议
- `lib/dictionary.ts` — 前端查词封装
- `lib/translate.ts` — 翻译封装
- `lib/word-classify.ts` — 词汇分类
- `lib/local-dict.ts` — 本地词典（离线备选）
- `components/word-tooltip.tsx` — 单词悬浮提示

### 模型信息

- **当前模型**: `MiniMax-Text-01`
- **API 地址**: `https://api.minimaxi.chat/v1/text/chatcompletion_v2`
- **文档**: https://www.minimaxi.com/document

---

## 6. 前端页面一览

| 路由 | 文件 | 说明 |
|------|------|------|
| `/` | `app/page.tsx` + `components/home-client.tsx` | 首页，视频卡片列表 |
| `/login` | `app/login/page.tsx` | 登录页（账号密码） |
| `/change-password` | `app/change-password/page.tsx` | 强制修改密码页 |
| `/[id]` | `app/[id]/page.tsx` + `components/video-learning-page.tsx` | 视频学习页 |
| `/vocab` | `app/vocab/page.tsx` + `components/vocab-client.tsx` | 生词本（收藏、复习、MindMap） |
| `/dashboard` | `app/dashboard/page.tsx` + `components/dashboard-client.tsx` | AI 数据看板 |
| `/download` | `app/download/page.tsx` + `components/download-client.tsx` | 批量下载 |
| `/profile` | `app/profile/page.tsx` + `components/profile-client.tsx` | 个人中心 |

---

## 7. API 路由一览

### 认证 & 用户

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 登录 |
| `/api/auth/verify` | GET | 验证 token |
| `/api/auth/change-password` | POST | 修改密码 |
| `/api/admin/users` | GET/POST/PUT/DELETE | 用户管理（admin） |
| `/api/user/profile` | GET/POST | 用户资料 |

### 视频 & 字幕

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/videos` | GET | 视频列表 |
| `/api/videos/[id]` | GET | 视频详情 |
| `/api/videos/popular` | GET | 热门视频 |
| `/api/save-subtitles` | POST | 保存字幕编辑 |
| `/api/translate-subtitles` | POST | 翻译字幕 |
| `/api/preload-translations` | POST | 预加载翻译 |
| `/api/tag-video` | POST | 给视频打标签 |
| `/api/update-tags` | POST | 更新标签 |
| `/api/process-all` | POST | 批量处理视频 |

### 查词 & AI

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/lookup` | POST | MiniMax AI 查词/口音/建议 |

### 生词本

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/vocab` | GET/POST/DELETE | 生词 CRUD |
| `/api/vocab/lookup` | POST | 查词并收藏 |
| `/api/vocab/bank/build` | POST | 构建词库 |

### 测验

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/quiz/generate` | POST | 生成测验题 |
| `/api/quiz/draw` | POST | 抽题 |

### 活动 & 下载

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/activity/record` | POST | 记录学习活动 |
| `/api/activity/calendar` | GET | 获取日历数据 |
| `/api/batch-download` | POST | 批量下载 |
| `/api/download-progress` | GET | 下载进度 |

---

## 8. 核心组件说明

| 组件 | 文件 | 说明 |
|------|------|------|
| 视频播放器 | `components/video-player.tsx` | 基于 Plyr，支持倍速/音量/全屏 |
| 字幕面板 | `components/subtitle-panel.tsx` | 双语字幕同步高亮，查词交互 |
| 单词提示 | `components/word-tooltip.tsx` | 悬浮查词弹窗 |
| 生词图谱 | `components/vocab-mindmap.tsx` | D3 力导向图，3D 可视化 |
| 间隔复习 | `components/vocab-review.tsx` | 艾宾浩斯遗忘曲线复习 |
| 管理面板 | `components/admin-user-panel.tsx` | 用户创建/删除/密码重置/角色管理/启用禁用/终端管理/审计日志/登录日志 |
| 数据看板 | `components/dashboard-client.tsx` | Recharts 图表 + AI 建议 |
| 学习日历 | `components/learning-calendar.tsx` | 日历热力图 |
| 主题切换 | `components/theme-toggle.tsx` | 深色/浅色模式 |

---

## 9. 导入视频

### 单条视频下载

```bash
python downloader.py "https://www.youtube.com/watch?v=VIDEO_ID"
```

### 批量下载

创建 `urls.txt`，每行一个链接：
```
https://www.youtube.com/watch?v=a_ZsCMSNOuw
https://www.youtube.com/watch?v=another_id
```

然后运行：
```bash
python downloader.py urls.txt
```

### 后台监控自动下载

```bash
python batch_downloader.py --watch urls.txt
# 按 Ctrl+C 停止监控
```

### 日志查看

所有下载日志存放在 `logs/` 目录：
- `logs/download_YYYYMMDD_HHMMSS.log` — 单视频下载日志
- `logs/batch_YYYYMMDD_HHMMSS.log` — 批量下载日志

### 下载后的文件结构

```
public/content/
└── VIDEO_ID/
    ├── video.mp4          # 视频文件
    ├── video.en.vtt       # 英文字幕
    ├── video.zh-Hans.vtt  # 中文字幕（如果有）
    ├── thumbnail.jpg      # 缩略图
    └── meta.json          # 视频信息（含 accent 字段）
```

### 手动导入已有视频

如果不想用下载脚本，可以手动放置文件：
1. 在 `public/content/` 下创建文件夹，命名规则：`[a-zA-Z0-9_-]{11}`（模拟 YouTube ID）
2. 放入 `video.mp4` 和 `meta.json`
3. 可选：放入 `video.en.vtt` 英文字幕
4. 重启开发服务器或等待热更新

### 手动创建 meta.json

```json
{
  "id": "your_video_id",
  "title": "视频标题",
  "description": "视频描述（可选）",
  "duration": 600,
  "thumbnail": "/content/your_video_id/thumbnail.jpg",
  "downloadedAt": "2026-04-24T00:00:00",
  "accent": "british"
}
```

---

## 10. 前端页面批量下载

访问 `http://localhost:3000/download`：
1. 上传包含 YouTube 链接的 `.md` 或 `.txt` 文件
2. 系统自动提取链接并开始下载
3. 实时显示下载进度条和日志

---

## 11. 数据看板

访问 `http://localhost:3000/dashboard`：

### 统计数据来源

| 指标 | 数据来源 |
|------|----------|
| 视频总数 | `localStorage` 缓存的视频列表 |
| 总点击量 | `localStorage` `vibe-click-counts` |
| 生词数量 | `localStorage` `vibe-english-vocab` |
| 总时长 | 视频 meta.json 中的 duration |
| 口音分布 | 视频 meta.json 中的 accent |
| AI 建议 | MiniMax API 实时分析 |

### 点击统计原理

首页每个视频卡片被点击时，会写入 `localStorage`：
```js
localStorage.setItem('vibe-click-counts', JSON.stringify({ videoId: count }))
```

### 视频列表同步

首页加载时会将视频列表同步到 `localStorage`：
```js
localStorage.setItem('vibe-video-list', JSON.stringify(videos))
```

---

## 12. 常见问题排查

### 下载失败

1. 检查 `logs/` 目录下的日志文件
2. 确认 yt-dlp 已安装：`pip install yt-dlp`
3. 确认 FFmpeg 已下载（首次运行会自动下载）
4. 检查网络连接（需要能访问 YouTube）

### 字幕不显示

1. 确认视频目录下有 `.vtt` 字幕文件
2. 部分视频没有自动字幕，属于正常情况
3. 检查 VTT 文件编码是否为 UTF-8

### 查词失败

1. 确认 `.env.local` 中 `MINIMAX_API_KEY` 已配置
2. 检查 API Key 是否有效（额度是否用完）
3. 查看浏览器 Network 面板中 `/api/lookup` 的响应

### 登录问题

1. 忘记密码 → 管理员在用户管理面板重置密码
2. 临时密码过期 → 管理员重新发放临时密码
3. 重置所有用户 → 删除 `data/users.json`，重启服务器自动重建 admin
4. Token 过期 → 7 天后自动失效，需重新登录

### 网站崩溃

已添加全面的后端错误处理：
- `lib/videos.ts` — 文件读取和 JSON 解析 try-catch
- `lib/vtt-parser.ts` — 字幕解析错误返回空数组
- 所有 API Route — 统一错误响应

---

## 13. 开发命令

```bash
# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务器
npm start

# 代码检查
npm run lint
```

注意：Windows 上启动开发服务器需要设置环境变量：
```powershell
$env:NEXT_PRIVATE_SKIP_WORKER="1"; npx next dev
```

---

## 14. 部署注意事项

- `data/` 目录需要读写权限（JSON 文件存储）
- `public/content/` 目录需要足够磁盘空间（视频文件较大）
- `.env.local` 中的 `MINIMAX_API_KEY` 必须配置
- 首次部署后 admin 临时密码为 `Admin@2026`，务必尽快修改；重置方法：删除 `data/users.json` 后重启服务器
- 生产环境建议使用 `npm run build && npm start`

---

## 15. 测试流程指南（避免卡住）

### 核心原则：测试脚本会修改数据，测试后必须重置

运行 `test-auth.mjs` 会创建用户、修改密码、创建/删除 session，**admin 密码会被改成测试用的值**。测试结束后若要正常使用，必须重置数据。

### 重置数据的正确步骤（必须按顺序）

```
1. 停止服务器（StopCommand）
2. 删除数据文件：users.json、sessions.json、login-attempts.json
3. 启动服务器（npm run dev）
4. 用 admin / Admin@2026 登录，强制修改密码
```

**为什么必须先停服务器再删文件？** Next.js 把数据缓存在内存中，服务器运行时删除文件会被内存中的旧数据重新写回。

### 常见卡住场景及解决

| 场景 | 原因 | 解决方法 |
|------|------|----------|
| admin 登录提示"密码错误" | 测试脚本改了密码 | 停服务器 → 删 users.json → 重启 → 用 Admin@2026 登录 |
| admin 登录提示"3个终端已满" | 旧 session 未清理 | 停服务器 → 删 sessions.json → 重启 |
| admin 登录提示"失败次数过多，15分钟后重试" | 登录失败触发限流 | 停服务器 → 删 login-attempts.json → 重启 |
| 创建用户后管理面板显示为空 | 用普通用户身份访问管理面板 | 先退出普通用户，用 admin 登录再访问 |
| 临时密码登录失败 | 临时密码是一次性的，用过即失效 | 用 admin 重置该用户密码获取新临时密码 |
| 重启后 admin 密码变了 | 服务器内存中有旧 session 数据 | 确保先停服务器再删文件，不要在运行时删 |

### 运行自动化测试

```bash
# 1. 先停服务器
# 2. 删除数据
Remove-Item -Force "data\users.json","data\sessions.json","data\login-attempts.json" -ErrorAction SilentlyContinue
# 3. 启动服务器
npm run dev
# 4. 等服务器就绪后运行测试
node test-auth.mjs
```

### 测试后的清理

测试完成后，如果要恢复正常使用，**再次执行重置步骤**，然后用 `Admin@2026` 登录并修改为你自己的密码。
