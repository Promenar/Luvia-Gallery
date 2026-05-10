# DeepSeek 审计报告：NAS 部署下新增文件无法入库 BUG

> 审计日期：2026-05-10
> 审计范围：`database.js`、`server.js`（扫描引擎、数据库层、FTS5 全文索引）
> 现象：NAS 设备稳定运行一段时间后，新增媒体文件手动/自动扫描均无法入库；目录视图文件夹卡片可见缩略图，但点进去空白。

---

## 一、现象还原

| 观察 | 分析 |
|------|------|
| 文件夹卡片显示新媒体缩略图 | `findCoverMedia()` 直接读文件系统，不依赖 DB |
| 点进文件夹内容空白 | `queryFiles()` 查询 `files` 表，文件未入库 |
| 手动扫描显示完成但不生效 | `processScan()` 批量插入失败后静默继续，状态仍标记 `idle` |

---

## 二、根因链路

### 问题 1（致命）：FTS5 AFTER DELETE 触发器缺失

**位置：** `database.js:228-250` `recreateFTS5Triggers()`

每次服务启动时调用，先 DROP 三个触发器，但只重建了 `files_fts_ai` 和 `files_fts_au`，**`files_fts_ad` 被删除后从未重建**。

```javascript
// 修复前
db.exec('DROP TRIGGER IF EXISTS files_fts_ad');   // 删了
// ... 只重建了 files_fts_ai 和 files_fts_au，缺 files_fts_ad
```

对比 `scripts/reset-database.js:55-57` 正确创建了三个触发器。
`createSchema()` 和 `migrateToFTS5()` 两处同样缺失此触发器。

### 问题 2（致命）：deleteFilesBatch 中 FTS 清理失败后仍删除 files 行

**位置：** `database.js:522-528`

```javascript
try {
    ftsStmt.run(file.id);       // FTS 清理失败只打日志
} catch (ftsErr) {
    console.error('...', ftsErr.message);
}
stmt.run(file.id);               // 文件行仍被删除
```

FTS 条目成为孤儿，其 `rowid` 永久占据 FTS 表空间。

### 问题 3（致命）：SQLite rowid 重用导致 FTS 插入冲突

SQLite 非 AUTOINCREMENT 模式下，`files` 表删除行后 `rowid` 会被回收。新 INSERT 获得已回收的 rowid → `files_fts_ai` 触发器向 FTS 表插入时遇到 rowid UNIQUE 冲突 → 整个批量事务回滚。

### 问题 4（严重）：insertFilesBatch 返回值被忽略

**位置：** `server.js:1133`

```javascript
database.insertFilesBatch(batchBuffer, shouldSave);
// 返回 false 时 scan 无感知 → 文件静默丢失
```

### 问题 5（严重）：outer try-catch 过于宽泛

**位置：** `server.js:1047-1149`（修复前）

单个文件的 `fs.statSync()` 抛异常会触发外层 `catch`，**整个目录的剩余文件全部跳过**。

### 问题 6（轻微）：lastMtime 的 `||` 判定误判 `0` 值

**位置：** `server.js:1077`

```javascript
const lastMtime = lastMtimeNormalized || lastMtimeOriginal;
// 当 lastMtimeNormalized 为 0 时（Unix epoch），被误判为 falsy
```

---

## 三、触发时序

```
服务启动 → recreateFTS5Triggers() 删除 files_fts_ad 且不重建
    ↓
长期运行 → 清理阶段 deleteFilesBatch FTS 清理偶尔失败
    ↓
files 行被删除，FTS 条目残留（孤儿 rowid）
    ↓
新文件入库 → INSERT 获得已回收 rowid
    ↓
files_fts_ai 触发器 INSERT 冲突 → 事务回滚
    ↓
insertFilesBatch 返回 false → scan 忽略继续
    ↓
scan 标记完成，文件未入库 → 目录视图空白
```

---

## 四、修复方案

### 4.1 database.js —— 补全 FTS5 触发器

| 函数 | 修复内容 |
|------|----------|
| `createSchema()` | 添加 `CREATE TRIGGER IF NOT EXISTS files_fts_ad` |
| `migrateToFTS5()` | 添加 `CREATE TRIGGER IF NOT EXISTS files_fts_ad` |
| `recreateFTS5Triggers()` | 添加 `CREATE TRIGGER files_fts_ad` |

### 4.2 database.js —— 新增孤立条目修复

新增 `repairOrphanedFTS()` 函数，启动时自动执行：

```sql
DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)
```

清理历史遗留的孤儿 FTS 条目，避免现有数据库在修复后仍有问题。

### 4.3 server.js —— 扫描引擎加固

| 修改点 | 内容 |
|--------|------|
| 批量插入 | 检查 `insertFilesBatch` 返回值，失败时打印 `console.error` |
| lastMtime 判定 | `||` 改为 `!== undefined ? :` 三元运算符 |
| 单文件处理 | 拆入独立 try-catch，仅跳过失败文件不影响同目录其他文件 |

### 4.4 部署建议

1. 重新构建 Docker 镜像并部署
2. 首次启动后观察日志中的 `[Repair]` 行，确认孤儿条目清理数量
3. 执行一次手动全量扫描验证新文件入库正常
4. 若问题仍存在，检查 Docker 容器日志中是否有 `Batch insert FAILED` 错误
