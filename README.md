# VibeEnglish — YouTube 沉浸式英语学习平台

通过真实的 YouTube 视频内容学习英语，支持双语字幕同步、实时单词查询、个人生词本管理、AI 数据看板和用户认证系统。

![VibeEnglish](public/content/a_ZsCMSNOuw/thumbnail.jpg)

## 功能特性

### 视频学习

- **视频播放学习** — 本地播放下载的 YouTube 视频，支持倍速、音量、全屏等常用控制
- **双语字幕同步** — 英文字幕与视频时间轴实时同步，支持中文字幕对照
- **字幕搜索** — 快速搜索视频中的任意台词，点击跳转到对应时间点
- **单词即时查询** — 鼠标悬停或点击字幕中的单词，弹出释义提示框（接入 MiniMax AI API）
- **盲听模式** — 隐藏字幕进行听力训练
- **口音自动分类** — 下载时自动识别视频是英音还是美音

### 生词本 & 复习

- **生词收藏** — 一键收藏陌生单词，记录上下文和释义
- **3D MindMap** — 生词关系图谱可视化，D3 力导向图展示词与词之间的联系
- **间隔复习** — 基于艾宾浩斯遗忘曲线的生词复习系统
- **词汇统计** — 生词数量、掌握进度、学习趋势等数据可视化

### AI 功能

- **AI 数据看板** — 统计视频点击量、学习时长、口音分布，AI 智能给出学习建议
- **AI 单词释义** — MiniMax 大模型驱动的英汉词典
- **AI 口音分类** — 自动判断视频口音（英音/美音/其他）
- **AI 翻译** — 字幕智能翻译

### 用户系统

- **账号登录** — 用户名 + 密码登录，支持管理员和访客两种角色
- **首次强制改密** — 新用户首次登录必须修改临时密码
- **自助改密** — 用户可主动修改密码，需验证旧密码
- **密码复杂度** — ≥8 位，必须包含大小写字母、数字和特殊符号
- **临时密码机制** — 管理员发放一次性临时密码，24 小时后自动失效
- **发放记录追溯** — 记录谁、何时、发给谁，便于审计
- **角色管理** — 管理员可修改用户角色（admin/guest）
- **启用/禁用** — 管理员可临时禁用用户，无需删除
- **在线终端管理** — 查看在线设备，支持远程踢出
- **批量创建** — 一次性创建多个用户账号
- **登录保护** — 连续 5 次登录失败后锁定 15 分钟
- **审计日志** — 记录所有管理操作（创建/删除/改密/角色变更等）
- **登录日志** — 记录登录时间、IP、成功/失败

### 其他

- **深色/浅色主题** — 支持白天模式和夜间模式切换
- **批量下载** — 支持 MD 文件上传批量下载 YouTube 视频，带进度条显示
- **学习日历** — 记录每日学习活动，日历视图展示学习轨迹
- **个人中心** — 用户资料管理

## 技术栈

### 前端

| 技术 | 用途 |
|------|------|
| **Next.js 14** | React 全栈框架，App Router 架构 |
| **React 18** | UI 组件库 |
| **TypeScript** | 类型安全 |
| **Tailwind CSS** | 原子化 CSS 框架 |
| **Plyr** | 视频播放器 |
| **D3.js** | 3D MindMap 力导向图 |
| **Recharts** | 数据看板图表 |
| **Lucide React** | 图标库 |

### 后端

| 技术 | 用途 |
|------|------|
| **Next.js API Routes** | 服务端 API（查词、下载、认证、生词管理等） |
| **bcryptjs** | 密码哈希加密 |
| **JSON 文件存储** | 轻量级数据持久化（用户、生词、活动记录等） |
| **MiniMax AI API** | 单词释义、口音分类、学习建议、翻译 |
| **yt-dlp + FFmpeg** | YouTube 视频下载与音视频合并 |

### 数据存储

| 文件 | 内容 |
|------|------|
| `data/users.json` | 用户账号、密码哈希、发放记录 |
| `data/vocab.json` | 用户生词数据 |
| `data/activity.json` | 学习活动记录 |
| `data/review-log.json` | 复习日志 |
| `public/content/` | 视频、字幕、缩略图 |

## 快速开始

### 环境要求

- Node.js 18+
- Python 3.8+（用于下载视频）
- Windows / macOS / Linux

### 安装运行

```bash
# 1. 克隆项目
git clone <repo-url>
cd vibe-english

# 2. 安装前端依赖
npm install

# 3. 安装 Python 依赖
pip install yt-dlp

# 4. 配置 MiniMax API Key（用于单词查询和 AI 建议）
# 在项目根目录创建 .env.local 文件，添加：
# MINIMAX_API_KEY=your-minimax-api-key-here

# 5. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

### 默认账号

首次启动自动创建管理员账号：

- **用户名**: `admin`
- **临时密码**: `Admin@2026`
- 首次登录后必须修改密码

### 下载学习视频

```bash
# 下载单个 YouTube 视频
python downloader.py "https://www.youtube.com/watch?v=a_ZsCMSNOuw"

# 批量下载（创建 urls.txt，每行一个链接）
python downloader.py urls.txt

# 后台监控自动下载
python batch_downloader.py --watch urls.txt
```

下载完成后刷新页面即可看到视频卡片。

## 使用指南

### 学习流程

1. **登录** — 使用账号密码登录
2. **选择视频** — 在首页浏览已下载的视频，点击进入学习
3. **观看视频** — 播放器支持 0.5x ~ 2x 倍速调节
4. **阅读字幕** — 右侧字幕面板自动跟随视频进度高亮当前句子
5. **查词收藏** — 点击字幕中的单词查看释义，加入生词本
6. **盲听训练** — 在视频页面开启盲听模式，隐藏字幕练习听力
7. **生词复习** — 在生词本页面使用间隔复习和 MindMap 可视化复习

### 主题切换

点击页面右上角的月亮/太阳图标，在深色模式和浅色模式之间切换。

### AI 数据看板

点击首页右上角的「数据看板」，查看：
- 视频总数、总点击量、生词数量、总学习时长
- 英音/美音视频分布
- 点击排行 Top 5
- AI 智能学习建议

## 项目结构

```
vibe-english/
├── app/                          # Next.js 应用路由
│   ├── api/                      # API 路由
│   │   ├── auth/                 # 认证相关（登录、验证、改密）
│   │   ├── admin/                # 管理员操作（用户管理）
│   │   ├── lookup/               # MiniMax AI 查词
│   │   ├── vocab/                # 生词本 CRUD
│   │   ├── videos/               # 视频列表与详情
│   │   ├── quiz/                 # 词汇测验
│   │   ├── activity/             # 学习活动记录
│   │   ├── batch-download/       # 批量下载
│   │   └── ...                   # 其他 API
│   ├── login/                    # 登录页
│   ├── change-password/          # 修改密码页
│   ├── dashboard/                # AI 数据看板
│   ├── download/                 # 批量下载页
│   ├── vocab/                    # 生词本页
│   ├── profile/                  # 个人中心页
│   └── [id]/                     # 视频学习页（动态路由）
├── components/                   # React 组件
│   ├── video-player.tsx          # 视频播放器
│   ├── subtitle-panel.tsx        # 字幕面板
│   ├── word-tooltip.tsx          # 单词悬浮提示
│   ├── vocab-mindmap.tsx         # 3D 生词图谱
│   ├── vocab-review.tsx          # 间隔复习
│   ├── admin-user-panel.tsx      # 管理员用户管理面板
│   ├── dashboard-client.tsx      # 数据看板
│   ├── learning-calendar.tsx     # 学习日历
│   └── ...                       # 其他组件
├── lib/                          # 工具函数和数据管理
│   ├── user-db.ts                # 用户数据管理（CRUD、密码哈希、发放记录）
│   ├── auth-sessions.ts          # 会话管理
│   ├── auth-context.tsx          # 认证上下文
│   ├── videos.ts                 # 视频数据读取
│   ├── vtt-parser.ts             # VTT 字幕解析
│   ├── dictionary.ts             # 查词封装
│   ├── vocab-db.ts               # 生词数据管理
│   ├── vocab-graph.ts            # 生词图谱算法
│   ├── activity-db.ts            # 学习活动记录
│   └── ...                       # 其他工具
├── data/                         # JSON 数据存储
├── public/content/               # 视频、字幕、缩略图存储
├── logs/                         # 下载日志存放
├── downloader.py                 # YouTube 视频下载脚本
├── batch_downloader.py           # 批量下载脚本
└── .env.local                    # 环境变量（API Key）
```

## 注意事项

- 本项目仅供个人学习使用
- 下载的 YouTube 视频请遵守当地版权法规
- 中文字幕依赖 YouTube 自动字幕，部分视频可能没有
- 日志文件存放在 `logs/` 目录下，方便排查下载问题

## License

MIT
