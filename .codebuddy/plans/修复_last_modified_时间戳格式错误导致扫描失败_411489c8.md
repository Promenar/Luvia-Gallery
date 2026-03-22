---
name: 修复 last_modified 时间戳格式错误导致扫描失败
overview: 修复数据库中 last_modified 字段存储毫秒级时间戳导致 SQL 逻辑错误，以及修复代码将毫秒时间戳写入数据库的问题
todos:
  - id: fix-server-timestamps
    content: 修改 server.js 中 5 处时间戳格式，将 mtimeMs 转换为秒级
    status: completed
  - id: create-migration-script
    content: 创建 scripts/fix-timestamps.js 数据库迁移脚本
    status: completed
  - id: test-fix-locally
    content: 本地测试修复效果
    status: completed
    dependencies:
      - fix-server-timestamps
      - create-migration-script
  - id: deploy-hot-update
    content: 提交代码并通知生产环境热更新
    status: completed
    dependencies:
      - test-fix-locally
  - id: run-migration-production
    content: 在生产容器中执行数据库迁移脚本
    status: completed
    dependencies:
      - deploy-hot-update
  - id: verify-fix
    content: 验证修复效果，执行扫描测试新文件入库
    status: completed
    dependencies:
      - run-migration-production
---

## 产品概述

修复生产环境中媒体文件扫描入库失败的问题

## 核心问题

- **根本原因**：`server.js` 使用 `stats.mtimeMs`（毫秒级时间戳）存储到数据库的 `last_modified INTEGER` 字段，导致 SQL 逻辑错误
- **错误表现**：`Batch insert failed: SqliteError: SQL logic error`
- **影响范围**：3月15日后新扫描的文件无法入库（约20个异常时间戳记录）

## 修复目标

1. 修改代码：统一使用秒级时间戳
2. 修复数据库：将异常的毫秒时间戳转换为秒级
3. 调整增量扫描比较逻辑

## 技术栈

- 后端：Node.js / Express / SQLite (better-sqlite3)
- 数据库迁移：Node.js 脚本

## 实现方案

### 问题分析

| 位置 | 当前代码 | 问题 |
| --- | --- | --- |
| `server.js:501` | `lastModified: stats.mtimeMs` | 毫秒时间戳 |
| `server.js:1108` | `lastModified: stats.mtimeMs` | 毫秒时间戳 |
| `server.js:1076` | `Math.abs(lastMtime - stats.mtimeMs) < 100` | 比较逻辑错误 |
| `server.js:787` | `lastModified = fs.statSync(folderPath).mtimeMs` | 毫秒时间戳 |
| `server.js:877` | `lastModified = stats.mtimeMs` | 毫秒时间戳 |


### 修复策略

1. **代码修复**：将 `mtimeMs` 除以 1000 转换为秒级时间戳
2. **数据库修复**：创建迁移脚本，将异常的毫秒时间戳转换为秒级
3. **增量扫描逻辑**：调整比较阈值从毫秒级改为秒级

### 修改文件清单

```
project-root/
├── server.js              # [MODIFY] 修复时间戳格式（5处）
└── scripts/
    └── fix-timestamps.js  # [NEW] 数据库迁移脚本，修复异常时间戳
```

## 实现细节

### 1. server.js 修改

- 第 501 行：`lastModified: Math.floor(stats.mtimeMs / 1000)`
- 第 1108 行：`lastModified: Math.floor(stats.mtimeMs / 1000)`
- 第 1076 行：`Math.abs(lastMtime - Math.floor(stats.mtimeMs / 1000)) < 1`
- 第 787 行：`lastModified = Math.floor(fs.statSync(folderPath).mtimeMs / 1000)`
- 第 877 行：`lastModified = Math.floor(stats.mtimeMs / 1000)`

### 2. 数据库迁移脚本

创建 `scripts/fix-timestamps.js`：

- 检测并修复毫秒级时间戳（值 > 2000000000）
- 将毫秒时间戳转换为秒级
- 添加迁移标记防止重复执行

### 性能考虑

- 迁移脚本使用事务批量处理，避免逐条更新
- 热更新后自动执行，无需重建容器