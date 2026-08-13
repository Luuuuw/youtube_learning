# scripts/_archive

一次性迁移脚本归档区。这些脚本**已执行过**，不需要再跑。

如果将来要重新跑（如词表回滚后想再搬一次），就 `mv ../scripts/`，否则放着即可。

| 脚本 | 干什么 | 执行日期 |
|---|---|---|
| `migrate-local-dict.mjs` | 把 `lib/local-dict.ts` 里 662 行硬编码 DICT 搬到 `data/local-dict.json` | 2026-06-18 |
| `migrate-word-lists.mjs` | 把 `lib/word-classify.ts` 里 5 个硬编码词表搬到 `data/word-lists/*.json` | 2026-06-18 |
