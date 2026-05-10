# GLM 审计报告：NAS 媒体库新增文件扫描失败

> 审计日期：2026-05-10
> 审计范围：`server.js`、`database.js`、`runner.js`
> 症状：部署到 NAS 后稳定运行一段时间，新增媒体文件无法通过扫描入库；目录视图可见缩略图但进入后空白。

---

## 一、BUG 现象复现路径

1. 用户在 NAS 媒体库路径下新增图片/视频文件。
2. 手动触发扫描（`POST /api/scan/start`）或等待定时扫描。
3. Web 前端「目录视图」文件夹图标上能看到新媒体文件的缩略图（因为该接口直接读文件系统）。
4. 点击进入文件夹，内容为空白（因为文件列表接口 `/api/scan/results` 从 SQLite 数据库查询，新文件未被正确写入）。

---

## 二、根因定位

### 2.1 核心缺陷：增量扫描路径不一致导致新文件被跳过或误删

**位置**：`server.js` `processScan()` 函数，第 1072–1091 行。

```js
const normalizedPath = smartNormalizePath(fullPath);

const lastMtimeNormalized = existingFilesMtime.get(normalizedPath);
const lastMtimeOriginal = existingFilesMtime.get(fullPath);
const lastMtime = lastMtimeNormalized || lastMtimeOriginal;
const currentMtimeSec = Math.floor(stats.mtimeMs / 1000);
if (lastMtime && Math.abs(lastMtime - currentMtimeSec) < 1) {
    // 跳过：认为文件未变化
    allScannedPaths.add(...);
    continue;
}
```

**问题链路**：

| 步骤 | 存储路径 | 扫描路径 | 是否一致 |
|------|---------|---------|---------|
| 首次扫描写入 DB | `path.join(dir, item.name)` → 可能是 `/volume1/photos/IMG.jpg` | 同左 | ✅ |
| NAS 路径变化（挂载点/symlink解析） | DB 中为 `/volume1/photos/IMG.jpg` | `fs.readdirSync` 返回 `/volume1/photos/IMG.jpg` 但 `path.join` 后可能为 `/volume1/photos/IMG.jpg` 或 `/Photos/IMG.jpg`（取决于 symlink） | ❌ |
| 后续扫描对比 | `existingFilesMtime.get()` 查询 DB 路径 | 当前扫描生成的路径 | 可能不匹配 |

当路径不匹配时：
- **情况 A**：`lastMtime` 找不到 → 文件被视为"新文件" → 进入 `batchBuffer` → 但 `allScannedPaths.add(pathToUse)` 添加的路径与 DB 中已有路径不同 → 清理阶段不会误删旧路径 → 出现同文件的重复记录（path 不同但指向同一文件）。
- **情况 B**（更严重）：NAS 上 `path.join` 的行为在不同时间点可能因挂载点变化产生微妙差异。如果 `smartNormalizePath` 对某次路径未做规范化（因为已是绝对路径且不含 `..`），而 DB 中存储的是另一种表示（例如末尾多了 `/` 或大小写不同），则：
  - 新文件首次扫描成功写入 DB。
  - 第二次扫描时 `existingFilesMtime.get()` 用新路径查 → 查不到（DB 里是旧路径）→ 被当作新文件再写一次 → `ON CONFLICT(path)` 不触发（因为 path 不同）→ 出现重复。
  - 清理阶段：`allDbPaths` 有旧路径，`allScannedPaths` 只有新路径 → 旧路径被标记为"已删除" → **原有文件记录被从 DB 中误删**。

### 2.2 `smartNormalizePath` 在 NAS 环境下规范化不足

**位置**：`server.js` 第 23–33 行。

```js
function smartNormalizePath(filePath) {
    if (!filePath) return filePath;
    if (path.isAbsolute(filePath) && !filePath.includes('..') && !filePath.includes('/.')) {
        return filePath;  // 直接返回，不做任何处理
    }
    return path.resolve(filePath);
}
```

此函数仅在路径包含 `..` 或 `/.` 时才调用 `path.resolve()`。NAS 环境下常见的路径问题：
- **大小写差异**：NAS 文件系统（如 Synology 的 ext4/btrfs）大小写敏感，但 SMB 挂载可能改变大小写。
- **符号链接解析**：`/volume1/photos` 和 `/photos` 可能指向同一目录，但字符串不同。
- **尾部分隔符**：`/volume1/photos/` vs `/volume1/photos`。
- **正反斜杠混用**：Windows 容器或 SMB 路径可能产生 `\` 混入。

### 2.3 清理阶段误删风险

**位置**：`server.js` 第 1161–1188 行。

```js
const allDbPaths = database.getAllFilePaths();
const pathsToDelete = allDbPaths.filter(p => !allScannedPaths.has(p));
```

清理逻辑纯粹依赖字符串精确匹配，没有考虑路径等价性。结合 2.1 和 2.2 的问题，这会导致合法文件记录被误删。

### 2.4 批量写入错误被静默吞掉

**位置**：`database.js` 第 287–298 行。

```js
function insertFilesBatch(files) {
    try {
        const insertTx = db.transaction((filesList) => {
            for (const file of filesList) upsertFile(file);
        });
        insertTx(files);
        return true;
    } catch (error) {
        console.error('Batch insert failed:', error);  // 仅打印日志
        return false;  // 调用方未检查返回值
    }
}
```

`processScan()` 中调用 `insertFilesBatch()` 后未检查返回值（第 1133 行）。在 NAS 上，磁盘 I/O 较慢时 SQLite 事务可能因锁定超时失败，整批 1000 个文件静默丢失。

### 2.5 `startPeriodicScanner` 重复调用

**位置**：`server.js` 第 2929–2930 行。

```js
startPeriodicScanner(libraryPaths, scanInterval);
startPeriodicScanner(libraryPaths, scanInterval);  // 重复
```

虽然内部有 `stopPeriodicScanner()` 保护，但属于代码缺陷，可能在极端时序下导致定时器 ID 覆盖。

### 2.6 `generateThumbnail` 缺少 `file.id` 导致 `updateDbWithDimensions` 写入冲突

**位置**：`server.js` 第 2407 行（on-the-fly 缩略图生成）。

```js
const success = await generateThumbnail({ path: filePath });  // 缺少 id, name, folderPath 等
```

`generateThumbnail` 内部 `updateDbWithDimensions`（第 1716–1740 行）调用 `database.upsertFile()`，传入的对象缺少必要字段（`id`、`name`、`folderPath` 等），会导致 `upsertFile` 写入不完整记录或触发 `ON CONFLICT(path)` 时将已有记录的关键字段覆盖为 `undefined`。

---

## 三、修复方案

### 修复 1：统一路径规范化（最高优先级）

**目标**：确保扫描写入、增量比对、清理阶段使用完全一致的路径表示。

**方案**：增强 `smartNormalizePath`，对所有路径做完整规范化：

```js
function smartNormalizePath(filePath) {
    if (!filePath) return filePath;
    // 统一：resolve（消除 ..、.、尾部分隔符）、统一分隔符为 /
    let normalized = path.resolve(filePath).replace(/\\/g, '/');
    // 去除尾部分隔符（根路径 "/" 除外）
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
```

**影响范围**：
- `processScan()` 中的 `normalizedPath` 和 `normalizedFolderPath`
- `processFileForDB()` 中的路径处理
- `database.js` 中所有 path 比较逻辑

**需同步修改**：所有将路径写入数据库的地方（扫描、重命名、on-the-fly 缩略图生成）都应使用同一函数。

### 修复 2：清理阶段使用规范化路径比对

```js
// 清理阶段
const allDbPaths = database.getAllFilePaths();
const normalizedDbPaths = new Map(); // normalizedPath -> originalPath
allDbPaths.forEach(p => normalizedDbPaths.set(smartNormalizePath(p), p));

const pathsToDelete = allDbPaths.filter(p => !allScannedPaths.has(smartNormalizePath(p)));
```

### 修复 3：检查批量写入返回值并增加重试

**`database.js`**：

```js
function insertFilesBatch(files, shouldSave) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const insertTx = db.transaction((filesList) => {
                for (const file of filesList) upsertFile(file);
            });
            insertTx(files);
            return true;
        } catch (error) {
            console.error(`Batch insert failed (attempt ${attempt + 1}/${MAX_RETRIES}):`, error.message);
            if (attempt < MAX_RETRIES - 1) {
                // 指数退避
                const delay = Math.pow(2, attempt) * 100;
                require('child_process').execSync(`sleep ${delay / 1000}`);
            }
        }
    }
    return false;
}
```

**`server.js` `processScan()` 调用处**：

```js
if (batchBuffer.length >= BATCH_SIZE) {
    const success = database.insertFilesBatch(batchBuffer, shouldSave);
    if (!success) {
        console.error(`[SCAN] 批量写入失败，${batchBuffer.length} 个文件可能丢失！`);
        // 不清空 buffer，下次重试
        continue;
    }
    batchBuffer = [];
}
```

### 修复 4：删除重复的 `startPeriodicScanner` 调用

**位置**：`server.js` 第 2929–2930 行，删除第二行重复调用。

### 修复 5：修复 on-the-fly 缩略图生成的 file 对象

**位置**：`server.js` 第 2407 行附近。

```js
// 修复前
const success = await generateThumbnail({ path: filePath });

// 修复后：从数据库查询完整记录，或至少补全必要字段
const dbFile = database.getFileByPath(filePath);
if (dbFile) {
    await generateThumbnail(dbFile, true);
} else {
    // 文件不在数据库中，构建最小完整对象
    const ext = path.extname(filePath).toLowerCase();
    const videoExts = ['.mp4', '.webm', '.mov'];
    const normalized = smartNormalizePath(filePath);
    await generateThumbnail({
        id: Buffer.from(normalized).toString('base64'),
        path: normalized,
        name: path.basename(filePath),
        folderPath: smartNormalizePath(path.dirname(filePath)),
        size: fs.statSync(filePath).size,
        type: videoExts.includes(ext) ? 'video/mp4' : 'image/jpeg',
        mediaType: videoExts.includes(ext) ? 'video' : 'image',
        lastModified: Math.floor(fs.statSync(filePath).mtimeMs / 1000),
        sourceId: 'local'
    }, true);
}
```

---

## 四、优先级与影响评估

| 编号 | 修复项 | 优先级 | 影响范围 | 风险 |
|------|-------|--------|---------|------|
| 1 | 统一路径规范化 | **P0** | 全局扫描流程 | 需要数据库迁移，对已有数据做路径重写 |
| 2 | 清理阶段规范化比对 | **P0** | 扫描清理逻辑 | 低风险，与修复 1 配合 |
| 3 | 批量写入重试 | **P1** | 数据库写入可靠性 | 低风险，纯增强 |
| 4 | 删除重复调用 | **P2** | 启动流程 | 零风险 |
| 5 | on-the-fly 缩略图修复 | **P1** | 运行时数据完整性 | 低风险 |

---

## 五、验证建议

1. **修复后首次启动**需执行路径迁移脚本（`scripts/normalize-paths.js`），将数据库中所有路径统一为规范化格式。
2. 在 NAS 实机上测试：
   - 新增文件 → 手动扫描 → 验证文件出现在文件列表中。
   - 新增文件 → 等待定时扫描 → 验证同上。
   - 修改文件（触发 mtime 变化） → 扫描 → 验证记录更新而非重复。
   - 删除文件 → 扫描 → 验证清理正确。
3. 检查 `data/lumina.db` 中 `files` 表是否有路径格式不一致的记录。

---

## 六、涉及文件清单

| 文件 | 修改类型 |
|------|---------|
| `server.js` | 修改 `smartNormalizePath()`、`processScan()`、启动逻辑、on-the-fly 缩略图 |
| `database.js` | 修改 `insertFilesBatch()` 增加重试 |
| `scripts/normalize-paths.js` | 确认迁移脚本覆盖所有路径字段 |
