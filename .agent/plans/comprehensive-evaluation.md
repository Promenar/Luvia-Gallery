# 综合修复方案评估：生产系统可用性验证

> **日期**: 2026-05-10
> **前置条件**: Gemini 单独修复方案已在生产 NAS 实机验证失败

---

## 一、为什么 Gemini 单独方案不够

Gemini 方案（远程 e5cff90）只修复了：
1. ✅ FTS 触发器语法（`'delete'` → 标准 `DELETE`）
2. ✅ 补全 `files_fts_ad` 触发器

**缺失的关键环节**：
- ❌ **没有清理已存在的孤儿 FTS 条目** — 生产系统中因长期缺少 `files_fts_ad` 已积累大量孤儿 rowid，新 INSERT 仍会遇到 UNIQUE 冲突
- ❌ **没有修复扫描引擎** — `insertFilesBatch` 返回值被忽略、单文件异常导致整个目录跳过、`lastMtime` 误判

**结论**: Gemini 修了"以后不再产生新孤儿的根因"，但没修"现有孤儿导致的 rowid 冲突"。

---

## 二、综合修复方案覆盖分析

### 修复链路验证

```
[启动阶段]
  ✅ recreateFTS5Triggers() — 标准 DELETE 语法重建触发器（Gemini）
  ✅ repairOrphanedFTS() — 清理历史孤儿 FTS 条目（DeepSeek）
     ↓
  孤儿清除后，现有 rowid 冲突消失
     ↓

[扫描阶段]
  ✅ 单文件独立 try-catch — 单个文件异常不影响同目录其他文件（DeepSeek）
  ✅ insertFilesBatch 返回值检查 — 批量写入失败有日志可追溯（DeepSeek）
  ✅ lastMtime 严格判定 — 避免 Unix epoch 0 误判（DeepSeek）
  ✅ files_fts_ad 触发器就绪 — 删除操作正确同步 FTS（Gemini）
     ↓
  新文件 INSERT 获得干净 rowid → FTS 正常写入 → 入库成功

[缩略图阶段]
  ✅ on-the-fly 缩略图生成传入完整 file 对象 — 避免 updateDbWithDimensions 写入 undefined（GLM 补充）

[清理阶段]
  ✅ deleteFilesBatch FTS 失败时跳过 files 行删除 — 不产生新孤儿（DeepSeek P2 修复）

[启动流程]
  ✅ 删除重复 startPeriodicScanner — 避免定时器覆盖风险（GLM 补充）
  ✅ insertFilesBatch 签名接收 shouldSave — 接口一致性（MiniMax 补充）
```

### 生产系统上的预期行为

| 阶段 | 修复前 | 修复后 |
|------|--------|--------|
| 服务启动 | 触发器重建但缺 `files_fts_ad` | 三触发器完整 + 孤儿清理 |
| 首次扫描 | 新 INSERT rowid 冲突 → 事务回滚 → 静默失败 | 孤儿已清 → INSERT 成功 → 文件入库 |
| 后续扫描 | `lastMtime` 为 0 时误判为 unchanged | 严格 undefined 判定 |
| 文件删除 | FTS 残留 → 新孤儿积累 | FTS 同步删除 + 失败时跳过 |
| 缩略图生成 | 写入 undefined 字段到 DB | 从 DB 查询完整记录 |
| 定时扫描 | 双重启动风险 | 单次启动 |

---

## 三、修复清单汇总

| 来源 | 修复项 | 文件 | 行号 |
|------|--------|------|------|
| Gemini | FTS 触发器标准 DELETE 语法 | database.js | 87-100, 178-191, 236-248 |
| Gemini | 补全 `files_fts_ad` 触发器 | database.js | 同上 |
| DeepSeek | `repairOrphanedFTS()` 孤儿清理 | database.js | 249-268 |
| DeepSeek | `initDatabase()` 调用孤儿清理 | database.js | 40 |
| DeepSeek | 单文件独立 try-catch | server.js | 1069-1155 |
| DeepSeek | `insertFilesBatch` 返回值检查 | server.js | 1142-1150 |
| DeepSeek | `lastMtime` 严格判定 `!== undefined` | server.js | 1086 |
| DeepSeek | `deleteFilesBatch` FTS 失败跳过 | database.js | 554-559 |
| DeepSeek | `insertFilesBatch` 签名接收 shouldSave | database.js | 319 |
| GLM | 删除重复 `startPeriodicScanner` | server.js | 2942 |
| GLM | on-the-fly 缩略图完整 file 对象 | server.js | 2420-2432 |

**总计**: 2 个文件，+70/-16 行改动

---

## 四、部署后验证清单

1. **观察启动日志** — 确认 `[Repair] Cleaned N orphaned FTS entries` 或 `No orphaned FTS entries found`
2. **手动全量扫描** — `POST /api/scan/start`，确认新文件入库
3. **检查批量写入** — 日志中不应出现 `Batch insert FAILED`
4. **缩略图验证** — 新文件的缩略图应正常生成，`files` 表中不应有 `undefined` 字段
5. **清理验证** — 从文件系统删除一个文件 → 再次扫描 → 确认 DB 记录被正确清理
6. **定时扫描** — 等待一个扫描周期或手动触发，确认不会双重启动

---

## 五、风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 孤儿清理耗时（大量数据时） | 低 | `DELETE FROM files_fts WHERE rowid NOT IN (...)` 对索引表效率可接受 |
| `repairOrphanedFTS` 在启动时执行可能短暂锁定 | 低 | better-sqlite3 同步 API，WAL 模式下影响极小 |
| on-the-fly 缩略图 fallback 构造对象时 `fs.statSync` 可能失败 | 低 | 已在 try-catch 内，失败不影响主流程 |
| `deleteFilesBatch` FTS 失败跳过 → 文件未被删除 | 中 | 该文件会在下次扫描中被重新尝试删除；日志有记录可追溯 |

**结论**: 综合方案覆盖了从根因修复（触发器 + 孤儿清理）到防御加固（扫描引擎 + 异常处理）的完整链路，可以解决现有生产系统的 BUG。
