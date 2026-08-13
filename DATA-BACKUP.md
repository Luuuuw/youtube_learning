# 用户数据备份与恢复

维护用户数据 / 公共资产 / 部署迁移时的操作手册。

## 数据分层（3 类）

| 类型 | 文件 | 存放 | 丢失后果 |
|------|------|------|----------|
| 公共资产 | `data/flashcards.json`、`data/vocab-system.json`、`data/local-dict.json`、`data/word-lists/` | git 托管 | 无（可从 git 恢复，空盘自动播种） |
| 用户资产 | `users.json`、`sessions.json`、`activity.json`、`vocab.json`、`flashcard-state.json`、`flashcard-logs.json`、`review-log.json`、`flashcard-daily.json`、`announcement.json` | Render 持久盘（`DATA_DIR`） | 需备份才能恢复 |
| 可丢/临时 | `flashcard-gen-progress.json`、`login-attempts.json`、`ai-audit-log.json`、`ai-pending/`、`whisper-*` | 盘/内存 | 无 |

说明：

- 公共资产随代码打包在 git 的 `./data` 下，`lib/seed-data.ts` 在**空盘**首次启动时播种到 `DATA_DIR`（`seedBundledFlashcards` / `seedBundledVocab`），**只在目标文件为空时拷贝，绝不覆盖已有数据**。
- `vocab.json` 混存系统词 + 用户词：系统词（`owner='system'` 自动查词 / `'__system__'` 预热缓存）是公共资产；用户自建词（`owner=用户名`）是用户资产。

## 备份（从 Render 拉下来）

前置：线上已部署 `app/api/admin/backup`（admin 只读导出用户数据文件）。

```powershell
cd D:\油管学习\vibe-english
$env:ADMIN_USER='admin'
$env:ADMIN_PASS='你的管理员密码'
node scripts/backup-user-data.mjs
```

- 脚本自动登录拿 token → 调 `/api/admin/backup` → 存到本地 `backups/<时间戳>/`。
- 也可直接给 token 跳过登录：`$env:ADMIN_TOKEN='...'`。
- 只读，不写线上任何数据。

## 恢复（重新上传）

当前**只做了拉取，未做写入接口**（写入有覆盖风险，需确认后再做）。

恢复路径：

1. Render 控制台直接操作持久盘文件（若 Render 提供文件访问）。
2. 做 admin 恢复接口 + 本地 `restore` 脚本（带 dry-run + 一次确认，再落盘）。
3. 换部署平台时，把 `backups/<时间戳>/` 里的文件放进新 `DATA_DIR`。

## 维护 checklist

- 定期跑备份脚本（建议每次大改前 / 每周一次）。
- 系统词库积累变多后，重跑 `node scripts/extract-vocab-system.mjs` 更新 `data/vocab-system.json` 并提交。
- 新增用户数据文件时，更新 `app/api/admin/backup/route.ts` 的 `BACKUP_FILES` 列表。
- 新增内容数据文件（公共资产）时，在 `.gitignore` 加 `!data/<file>` 例外，并在 `lib/seed-data.ts` 加对应 seed。
