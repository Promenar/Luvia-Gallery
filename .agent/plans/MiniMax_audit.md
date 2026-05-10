# Luvia-Gallery 媒体库扫描 BUG 审计报告

**日期**: 2026-05-10
**审计范围**: 媒体库扫描逻辑、数据库写入、清理阶段

---

## 问题现象

项目部署到实机 NAS 设备稳定运行一段时间后，当设定的媒体库路径添加了新的图片等媒体文件后，手动或自动扫描媒体库均无法成功将其添加入媒体库。通过 Web 前端的目录视图可以看到相关新媒体文件的目录上的文件夹图标上有新媒体文件的缩略图，但是点进去看是一片空白。

---

## 根本原因

### 1. 增量扫描路径追踪逻辑缺陷 (`server.js:1083-1087`)

```javascript
if (lastMtimeOriginal) {
    allScannedPaths.add(fullPath);
} else {
    allScannedPaths.add(normalizedPath);
}
```

**问题**：当文件未变化时跳过后续处理，但添加到 `allScannedPaths` 时路径选择逻辑混乱。如果数据库中存的是原始路径但 `normalizedPath` 不同，会导致清理阶段误判。

### 2. 新文件路径确定逻辑存在边缘情况 (`server.js:1109-1111`)

```javascript
const useNormalized = !existingFilesMtime.has(fullPath) || existingFilesMtime.has(normalizedPath);
const pathToUse = useNormalized ? normalizedPath : fullPath;
```

**问题**：对于全新文件，路径格式可能在原始路径和规范路径之间摇摆，导致数据库中同一文件出现多条记录或路径不匹配。

### 3. `insertFilesBatch` 的 `shouldSave` 参数被忽略 (`database.js:287`)

```javascript
function insertFilesBatch(files) {  // ← shouldSave 参数被忽略！
    try {
        const insertTx = db.transaction((filesList) => {
            for (const file of filesList) upsertFile(file);
        });
        insertTx(files);
        return true;
    } catch (error) {
        console.error('Batch insert failed:', error);
        return false;
    }
}
```

调用处 (`server.js:1133`) 传入了 `shouldSave` 参数但函数签名没有接收。

### 4. 清理阶段路径比较可能导致误删 (`server.js:1173`)

```javascript
const pathsToDelete = allDbPaths.filter(p => !allScannedPaths.has(p));
```

**问题场景**：
- 新文件首次扫描，记录到 `batchBuffer` 但还没执行 `insertFilesBatch`
- 此时 `allScannedPaths` 还没有这个新文件的路径
- 如果扫描过程中发生错误或进程重启，清理阶段会删除所有不在 `allScannedPaths` 中的路径（包括刚添加的新文件）

---

## 为什么目录视图能看到缩略图

目录视图 API (`/api/library/folders`) 直接读取文件系统（不查数据库）：
- `server.js:844`: `getSubfolders(parentPath)` 直接调用 `fs.readdirSync`

所以目录视图能正确显示文件系统中的文件，但数据库中的记录可能因路径不匹配而查不到。

---

## 修复方案

### 方案一：统一路径规范化策略

**目标**：确保 `path` 和 `folder_path` 字段全程使用一致的格式

1. 修改 `smartNormalizePath()` 对所有路径都进行 `path.resolve()` 规范化
2. 移除"保持原样"的逻辑，统一使用绝对路径
3. 添加数据库迁移脚本，将历史数据中的非规范化路径统一处理

**文件**: `server.js:23-33`

### 方案二：修复 `insertFilesBatch` 参数传递

**目标**：使 `shouldSave` 参数真正生效

修改 `database.js:287`：
```javascript
function insertFilesBatch(files, shouldSave = false) {
    try {
        const insertTx = db.transaction((filesList) => {
            for (const file of filesList) upsertFile(file);
        });
        insertTx(files);
        if (shouldSave) saveDatabase();
        return true;
    } catch (error) {
        console.error('Batch insert failed:', error);
        return false;
    }
}
```

**文件**: `database.js:287-298`

### 方案三：修复清理阶段逻辑

**目标**：在删除数据库记录前，验证文件是否真的不存在于文件系统

修改 `server.js:1173-1183`：
```javascript
const pathsToDelete = allDbPaths.filter(dbPath => {
    // 先检查是否在 allScannedPaths 中
    if (allScannedPaths.has(dbPath)) return false;
    // 再验证文件是否真的不存在于文件系统
    if (fs.existsSync(dbPath)) return false;
    return true;
});
```

**文件**: `server.js:1155-1189`

### 方案四：添加增量扫描路径一致性保证

**目标**：确保 `allScannedPaths` 中的路径格式与数据库中一致

在 `server.js:1083-1087` 处修改：
```javascript
// 统一使用数据库中存储的路径格式
const dbPath = lastMtimeOriginal ? fullPath : normalizedPath;
allScannedPaths.add(dbPath);
```

---

## 关键代码位置汇总

| 功能 | 文件位置 |
|------|----------|
| 扫描入口 API | `server.js:1242` (`POST /api/scan/start`) |
| 扫描核心逻辑 | `server.js:1001` (`processScan()`) |
| 路径规范化 | `server.js:23` (`smartNormalizePath()`) |
| 增量扫描路径追踪 | `server.js:1083-1087` |
| 路径确定逻辑 | `server.js:1109-1111` |
| 批量插入 | `database.js:287` (`insertFilesBatch()`) |
| 清理/同步 | `server.js:1155-1189` |
| 数据库操作 | `database.js` (全文) |
| 目录浏览 API | `server.js:732` (`GET /api/library/folders`) |

---

## 测试建议

1. 在 NAS 环境中添加新文件后执行扫描
2. 检查数据库 `files` 表中新增记录的 `path` 和 `folder_path` 字段格式
3. 验证 `allScannedPaths` 与数据库路径的一致性
4. 确认清理阶段不会误删新增文件

---

## 迁移脚本

存在迁移脚本处理路径规范化问题：
- `scripts/normalize-paths.js` - 用于规范化数据库中的 `folder_path`

如需要可以参考此脚本创建类似的 `path` 字段规范化脚本。