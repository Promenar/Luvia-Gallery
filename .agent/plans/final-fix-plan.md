# 最终修复方案：NAS 新增媒体文件入库失败

> **日期**: 2026-05-10
> **汇总依据**: DeepSeek / GLM / MiniMax 三份独立审计报告交叉验证
> **已合并**: 远程 e5cff90 (Gemini 3 Pro FTS 触发器修复) + 本地 DeepSeek 补充修复

---

## 一、三份报告对比评估

### 1.1 DeepSeek 审计 ✅ 准确度最高（已应用）

| 编号 | 问题 | 判定 | 说明 |
|------|------|------|------|
| P1 | FTS5 `files_fts_ad` 触发器缺失 | ✅ **正确且致命** | 三个函数（`createSchema`、`migrateToFTS5`、`recreateFTS5Triggers`）均缺少 AFTER DELETE 触发器，是根因链的核心起点 |
| P2 | `deleteFilesBatch` FTS 清理失败后仍删 files 行 | ✅ **正确** | 现存代码确认（`database.js:554-559`），FTS 异常被吞掉后 files 行照删不误 |
| P3 | SQLite rowid 重用导致 FTS 插入冲突 | ✅ **正确且是直接触发原因** | 非 AUTOINCREMENT 的 files 表，删除行后 rowid 被回收 → 新 INSERT 获得已用 rowid → `files_fts_ai` 触发器 UNIQUE 冲突 → 事务回滚 |
| P4 | `insertFilesBatch` 返回值被忽略 | ✅ **正确** | 已修复，现有代码已检查返回值（`server.js:1142-1149`） |
| P5 | outer try-catch 过于宽泛 | ✅ **正确** | 已修复，拆为独立 try-catch（`server.js:1069-1155`） |
| P6 | lastMtime `\|\|` 判定误判 0 值 | ✅ **正确** | 已修复为三元运算符（`server.js:1086`） |

### 1.2 GLM 审计 ⚠️ 部分正确，有过度诊断

| 编号 | 问题 | 判定 | 说明 |
|------|------|------|------|
| 2.1 | 增量扫描路径不一致 | ⚠️ **现象描述正确但非本次根因** | NAS 上确实存在路径格式风险，但当前 BUG 的直接原因是 FTS 触发器缺失导致的 rowid 冲突，路径问题在现有环境中并未实际触发 |
| 2.2 | `smartNormalizePath` 规范化不足 | ⚠️ **理论风险，非即时问题** | 对所有路径都 `path.resolve()` 会改变已有 DB 记录的路径匹配，反而可能引入新问题 |
| 2.3 | 清理阶段误删风险 | ⚠️ **理论风险** | 需与 2.1/2.2 联合才成立，当前环境路径格式稳定 |
| 2.4 | 批量写入错误被静默吞掉 | ✅ **正确** | 与 DeepSeek P4 一致 |
| 2.5 | `startPeriodicScanner` 重复调用 | ✅ **正确** | `server.js:2944-2945` 确实存在重复调用 |
| 2.6 | on-the-fly 缩略图缺少 file 对象字段 | ✅ **正确** | `server.js:2422` 只传 `{ path: filePath }`，而 `updateDbWithDimensions` 使用 `filePayload.id/name/folderPath` 等字段，全为 `undefined` |

### 1.3 MiniMax 审计 ⚠️ 分析较浅，有错有对

| 编号 | 问题 | 判定 | 说明 |
|------|------|------|------|
| 1 | `allScannedPaths` 路径选择混乱 | ⚠️ **方向正确但非根因** | 这在 DeepSeek 修复后已通过规范化路径逻辑缓解 |
| 2 | 新文件路径确定逻辑边缘情况 | ⚠️ **理论风险** | 与 GLM 2.1 类似的路径一致性问题 |
| 3 | `shouldSave` 参数被忽略 | ❌ **部分不准确** | `database.js` 的 `insertFilesBatch` 签名确实没接收该参数，但 `shouldSave` 在 WAL 模式下实为空操作，不构成 BUG 原因 |
| 4 | 清理阶段可能误删新文件 | ⚠️ **理论风险** | 需要扫描中断这一前提条件 |

---

## 二、根因链路确认（最终结论）

```
服务启动 → recreateFTS5Triggers() 删除 files_fts_ad 且不重建  ← 根因起点
    ↓
长期运行 → deleteFilesBatch FTS 清理偶尔失败（但 files 行照删）
    ↓
files 行被删除，FTS 条目残留（孤儿 rowid 占据空间）
    ↓
新文件入库 → INSERT 获得已回收的 rowid
    ↓
files_fts_ai 触发器向 FTS 表 INSERT 时遇到 rowid 冲突 → 事务回滚
    ↓
insertFilesBatch 返回 false → 之前 scan 忽略继续（现已修复检查）
    ↓
scan 标记完成，文件未入库 → 目录视图空白
```

**核心结论**: DeepSeek 的 FTS 触发器缺失分析完全命中了根因，其他报告聚焦的路径规范化问题是潜在的次生风险，但不是本次 BUG 的直接原因。

---

## 三、已完成的修复（DeepSeek 方案，已应用）

### 3.1 database.js ✅

1. **补全 `files_fts_ad` 触发器** — `createSchema()`、`migrateToFTS5()`、`recreateFTS5Triggers()` 三处均已添加
2. **新增 `repairOrphanedFTS()` 函数** — 启动时自动清理历史遗留孤儿 FTS 条目
3. `initDatabase()` 中调用 `repairOrphanedFTS()`

### 3.2 server.js ✅

1. **单文件独立 try-catch** — `processScan()` 中每个文件处理包裹在独立异常捕获中
2. **检查 `insertFilesBatch` 返回值** — 失败时打印 `Batch insert FAILED` 日志
3. **lastMtime 判定修复** — `||` 改为三元运算符 `!== undefined ? :`
4. **目录读取异常处理** — 拆分外层 try-catch，避免单个目录异常影响全局

---

## 四、待完成的修复（从三份报告中提取的补充项）

### 4.1 P1 — 删除重复的 `startPeriodicScanner` 调用 🔴 高优先级

**来源**: GLM 审计 2.5
**位置**: `server.js:2944-2945`
**问题**: 连续两次调用 `startPeriodicScanner()`，可能导致定时器 ID 覆盖

```javascript
// 修复前 (line 2944-2945)
startPeriodicScanner(libraryPaths, scanInterval);
startPeriodicScanner(libraryPaths, scanInterval);  // ← 删除此行

// 修复后
startPeriodicScanner(libraryPaths, scanInterval);
```

### 4.2 P2 — on-the-fly 缩略图生成缺少 file 对象字段 🔴 高优先级

**来源**: GLM 审计 2.6
**位置**: `server.js:2422`
**问题**: `generateThumbnail({ path: filePath })` 缺少 `id`/`name`/`folderPath` 等字段，导致 `updateDbWithDimensions` 写入 `undefined` 值

```javascript
// 修复前
const success = await generateThumbnail({ path: filePath });

// 修复后：从数据库获取完整记录
const dbFile = database.getFileByPath(filePath);
const success = await generateThumbnail(dbFile || {
    id: Buffer.from(smartNormalizePath(filePath)).toString('base64'),
    path: smartNormalizePath(filePath),
    name: path.basename(filePath),
    folderPath: smartNormalizePath(path.dirname(filePath)),
    size: fs.statSync(filePath).size,
    type: 'image/jpeg',
    mediaType: 'image',
    lastModified: Math.floor(fs.statSync(filePath).mtimeMs / 1000),
    sourceId: 'local'
}, true);
```

### 4.3 P3 — `deleteFilesBatch` FTS 清理失败后不应继续删除 files 行 🟡 中优先级

**来源**: DeepSeek 审计 P2
**位置**: `database.js:554-559`
**问题**: FTS 删除异常被吞掉后，files 行照删不误，导致 FTS 孤儿条目
**现状**: 修复了 `files_fts_ad` 触发器后，此问题在未来不会再产生新的孤儿条目。但 `deleteFilesBatch` 中的异常处理仍应改为：FTS 清理失败时，将该文件从批量删除中跳过并记录，而非静默继续。

### 4.4 P4 — `insertFilesBatch` 的 `shouldSave` 参数未接收 🟢 低优先级

**来源**: MiniMax 审计 3
**位置**: `database.js` 的 `insertFilesBatch` 函数签名
**问题**: `server.js` 传入了 `shouldSave`，但函数签名未接收
**现状**: WAL 模式下 `saveDatabase()` 是空操作，不影响功能。但为代码一致性应修正签名。

---

## 五、不采纳的建议

| 建议 | 来源 | 不采纳原因 |
|------|------|-----------|
| 对所有路径都 `path.resolve()` | GLM 修复 1 | 会改变已有 DB 记录的路径匹配，风险大于收益 |
| 批量写入增加重试 + `sleep` | GLM 修复 3 | `execSync('sleep ...')` 在容器环境下不优雅；better-sqlite3 同步 API 事务失败通常是逻辑错误而非暂时性错误 |
| 清理阶段增加 `fs.existsSync` 验证 | MiniMax 方案三 | 每个路径额外做一次 `fs.existsSync` I/O 开销大，且扫描阶段已经遍历了所有文件 |
| `insertFilesBatch` 失败不清空 buffer | GLM 修复 3 | 会导致死循环（buffer 永远满、永远插入失败） |

---

## 六、执行计划

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1a | 远程 Gemini 方案（FTS 触发器标准 DELETE 语法） | ✅ 已合并 (e5cff90) |
| 1b | DeepSeek 方案（`repairOrphanedFTS` 孤儿清理） | ✅ 已追加到 database.js |
| 1c | DeepSeek 方案（扫描引擎加固：单文件 try-catch + 返回值检查 + lastMtime 严格判定） | ✅ 已追加到 server.js |
| 2 | 删除重复 `startPeriodicScanner`（§4.1） | ✅ 已实施 |
| 3 | 修复 on-the-fly 缩略图 file 对象（§4.2） | ✅ 已实施 |
| 4 | 修正 `deleteFilesBatch` 异常处理（§4.3） | ✅ 已实施 |
| 5 | 修正 `insertFilesBatch` 签名（§4.4） | ✅ 已实施 |
| 6 | 构建部署 + 实机验证 | ⬜ 待实施 |

### 合并策略说明

远程提交 `e5cff90` 将 FTS 触发器中的 `INSERT INTO files_fts(files_fts, rowid, ...) VALUES('delete', ...)` 改为标准 `DELETE FROM files_fts WHERE rowid = old.rowid`。此方案更简洁安全，因为项目使用的是普通 FTS5 表（非 contentless），标准 DELETE 语义更清晰。

本地 DeepSeek 方案的三个额外修复（孤儿清理、扫描加固、返回值检查）在远程基础上手动追加，无冲突。
