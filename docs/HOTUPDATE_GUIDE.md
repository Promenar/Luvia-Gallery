# 热更新与数据库迁移指南

## 概述

本文档说明如何通过 runner.js 热更新功能自动执行数据库迁移，无需手动操作或容器重建。

## 热更新流程

### 1. 自动更新流程

当通过 `runner.js` 执行热更新时：

```bash
# 触发热更新
curl -X POST http://localhost:3001/api/admin/system/update
```

**执行步骤**：
1. ✅ 停止当前应用
2. ✅ 拉取最新代码 (`git pull`)
3. ✅ 安装依赖 (`npm install`)
4. ✅ 构建前端 (`npm run build`)
5. ✅ **自动运行数据库迁移** (新增)
6. ✅ 重启应用

### 2. 数据库迁移详情

迁移脚本 `scripts/normalize-paths.js` 会：

- 🔍 检查是否需要迁移（基于标记文件）
- 🛠️ 规范化 `folder_path` 字段（智能规范化，不破坏现有路径）
- 🧹 清理孤立的 FTS5 索引条目
- ⚡ 优化数据库性能
- ✅ 创建迁移完成标记

**迁移标记**：`.migration_normalization_completed`
- 位置：`data/` 目录（与数据库同级）
- 记录迁移完成时间和版本
- 防止重复运行

### 3. 手动触发迁移

如果需要在热更新外单独运行迁移：

#### 方法 1：通过 API

```bash
# 触发迁移（需要 UPDATE_TOKEN，如果设置了）
curl -X POST http://localhost:3001/api/admin/system/migrate \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### 方法 2：直接运行脚本

```bash
# 在容器内或宿主机上
node scripts/normalize-paths.js
```

#### 方法 3：通过安全模式页面

如果系统崩溃进入安全模式，访问页面时会显示迁移选项：
- 点击"运行数据库迁移"链接
- 输入 Update Token（如果需要）
- 查看迁移结果

## 迁移逻辑

### 智能路径规范化

迁移脚本使用与 `server.js` 相同的规范化逻辑：

```javascript
function smartNormalizePath(filePath) {
    if (!filePath) return filePath;

    // 已是绝对路径且无相对部分，保持不变
    if (path.isAbsolute(filePath) && !filePath.includes('..') && !filePath.includes('/.')) {
        return filePath;
    }

    // 否则规范化
    return path.resolve(filePath);
}
```

**示例**：

| 原始路径 | 规范化后 | 原因 |
|---------|---------|------|
| `/media` | `/media` | ✅ 绝对路径，无相对部分 |
| `/media/photo` | `/media/photo` | ✅ 绝对路径，无相对部分 |
| `./media` | `/path/to/media` | ⚠️ 相对路径，需要规范化 |
| `/media/../video` | `/video` | ⚠️ 包含 `..`，需要规范化 |
| `/media/./photo` | `/media/photo` | ⚠️ 包含 `.`，需要规范化 |

### 向后兼容性

即使不运行迁移，新版本代码也支持：
- 查询时同时尝试规范化和原始路径
- 增量扫描兼容新旧路径格式
- 自动适配现有数据

## 故障排查

### 问题 1：迁移脚本未运行

**症状**：热更新后路径问题仍然存在

**原因**：
- 迁移脚本文件丢失
- 执行权限问题
- 迁移已标记为完成（但需要重新运行）

**解决**：

```bash
# 1. 检查脚本是否存在
ls -la scripts/normalize-paths.js

# 2. 检查执行权限
chmod +x scripts/normalize-paths.js

# 3. 删除迁移标记以强制重新运行
rm -f data/.migration_normalization_completed

# 4. 手动运行迁移
node scripts/normalize-paths.js
```

### 问题 2：迁移失败

**症状**：热更新日志显示迁移错误

**原因**：
- 数据库文件损坏
- 数据库被其他进程锁定
- 权限不足

**解决**：

```bash
# 1. 停止应用
docker-compose down
# 或
docker stop <container>

# 2. 备份数据库
cp data/gallery.db data/gallery.db.backup

# 3. 手动运行迁移
node scripts/normalize-paths.js

# 4. 检查迁移结果
sqlite3 data/gallery.db "SELECT DISTINCT folder_path FROM files LIMIT 10;"

# 5. 重启应用
docker-compose up -d
```

### 问题 3：热更新后系统无法启动

**症状**：热更新后应用崩溃或无法访问

**原因**：
- 代码错误
- 依赖问题
- 迁移脚本阻塞

**解决**：

```bash
# 1. 检查日志
docker logs -f <container>

# 2. 删除迁移标记，下次启动时跳过迁移
docker exec -it <container> rm -f /app/data/.migration_normalization_completed

# 3. 回滚到上一个版本
git checkout HEAD~1
docker restart <container>

# 4. 检查手动迁移
docker exec -it <container> node scripts/normalize-paths.js
```

### 问题 4：路径显示仍然为空

**症状**：迁移完成，但文件夹显示空白

**原因**：
- 数据库路径格式与查询不匹配
- 缓存问题
- 权限问题

**解决**：

```sql
-- 检查数据库中的路径格式
SELECT DISTINCT folder_path FROM files LIMIT 20;

-- 检查查询的路径格式
-- 在浏览器开发者工具 Network 面板查看请求

-- 如果不一致，删除迁移标记并重新运行
-- 或手动更新特定路径
UPDATE files SET folder_path = '/media' WHERE folder_path = './media';
```

## 最佳实践

### 1. 生产环境更新流程

```bash
# 1. 检查更新状态
curl http://localhost:3001/api/admin/system/update/status

# 2. 触发热更新
curl -X POST http://localhost:3001/api/admin/system/update \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. 监控日志
docker logs -f <container>

# 4. 验证更新
# 访问 Web 界面，检查之前有问题的文件夹
```

### 2. 数据库维护

```bash
# 定期运行迁移（安全操作，幂等性）
node scripts/normalize-paths.js

# 重建 FTS5 索引（如搜索异常）
sqlite3 data/gallery.db <<EOF
DROP TABLE IF EXISTS files_fts;
.exit
EOF
# 重启应用会自动重建
```

### 3. 备份策略

```bash
# 更新前自动备份
cp data/gallery.db data/gallery.db.backup.$(date +%Y%m%d_%H%M%S)

# 定期清理旧备份（保留最近 7 天）
find data -name "gallery.db.backup.*" -mtime +7 -delete
```

## API 参考

### 检查更新状态

```http
GET /api/admin/system/update/status
```

响应：
```json
{
  "updatable": true,
  "local": "abc123...",
  "remote": "def456...",
  "config": {
    "repoUrl": "git@github.com:NarcisWL/Luvia-Gallery.git",
    "branch": "main"
  },
  "isUninitialized": false
}
```

### 触发热更新

```http
POST /api/admin/system/update
Authorization: Bearer YOUR_TOKEN
```

响应：
```json
{
  "status": "started",
  "message": "Update process started."
}
```

### 触发数据库迁移

```http
POST /api/admin/system/migrate
Authorization: Bearer YOUR_TOKEN
```

响应：
```json
{
  "status": "started",
  "message": "Database migration started."
}
```

## 支持与反馈

如遇问题，请提供：
- 容器日志
- 数据库路径示例（脱敏）
- 迁移脚本输出
- 复现步骤

---

**版本**：1.0.0
**最后更新**：2026-03-18
