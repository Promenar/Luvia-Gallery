# 路径规范化问题修复指南

## 问题背景

在生产环境热更新后，扫描时出现 SQL 错误：
```
Batch insert failed: SqliteError: SQL logic error
```

根本原因：之前的修改对路径进行了过度规范化，导致：
1. 数据库中存储的路径与 ID 计算不一致
2. 触发 UNIQUE 约束冲突
3. FTS5 索引同步失败

## 修复方案

### 核心修改

1. **智能路径规范化函数** (`smartNormalizePath`)
   - 只在必要时规范化路径（相对路径、包含 `.` 或 `..`）
   - 保留已有的绝对路径不变
   - 避免破坏数据库中现有的路径记录

2. **存储策略**
   - `id`: 使用原始 `fullPath` 生成（保持与数据库一致）
   - `path`: 存储原始路径
   - `folderPath`: 使用智能规范化路径

3. **查询兼容性**
   - 查询时同时尝试规范化路径和原始路径
   - 支持向后兼容旧数据

## 部署步骤

### 1. 停止服务

```bash
docker-compose down
# 或
docker stop <container_name>
```

### 2. 备份数据库

```bash
# 进入容器
docker exec -it <container_name> bash

# 备份数据库
cp /app/data/gallery.db /app/data/gallery.db.backup.$(date +%Y%m%d_%H%M%S)
```

### 3. 拉取最新代码

```bash
git pull origin main
```

### 4. 运行迁移脚本（可选）

如果数据库中有需要规范化的路径，运行迁移脚本：

```bash
# 在容器内或宿主机上运行
node scripts/normalize-paths.js
```

### 5. 重启服务

```bash
docker-compose up -d
# 或
docker start <container_name>
```

### 6. 验证

- 检查容器日志：`docker logs -f <container_name>`
- 访问 Web 界面，查看之前显示空的文件夹
- 执行一次完整扫描

## 故障排查

### 问题：扫描后仍然显示空白

**原因**：数据库中存储的路径格式与新查询不匹配

**解决**：
```sql
-- 检查数据库中的路径格式
SELECT DISTINCT folder_path FROM files LIMIT 20;

-- 如果发现格式不一致，运行迁移脚本
node scripts/normalize-paths.js
```

### 问题：SQL 错误仍然存在

**原因**：数据库损坏或 FTS5 索引不一致

**解决**：
```bash
# 进入容器
docker exec -it <container_name> bash

# 删除并重建 FTS5 索引
sqlite3 /app/data/gallery.db <<EOF
DROP TABLE IF EXISTS files_fts;
.exit
EOF

# 重启服务，会自动重建 FTS5 索引
```

### 问题：某些文件无法访问

**原因**：路径权限或符号链接问题

**解决**：
```bash
# 检查文件权限
ls -la /media /video

# 检查符号链接
ls -la / | grep media
ls -la / | grep video
```

## 技术细节

### 路径规范化规则

| 原始路径 | 规范化后 | 说明 |
|---------|---------|------|
| `/media` | `/media` | ✅ 保持不变（绝对路径，无相对部分） |
| `/media/photo` | `/media/photo` | ✅ 保持不变 |
| `./media` | `/path/to/media` | ⚠️ 规范化为绝对路径 |
| `/media/../video` | `/video` | ⚠️ 解析相对路径 |
| `/media/./photo` | `/media/photo` | ⚠️ 移除 `.` |

### 数据库查询优化

```sql
-- 递归查询：同时匹配两种路径格式
SELECT * FROM files
WHERE (folder_path = ? OR folder_path LIKE ?)
   OR (folder_path = ? OR folder_path LIKE ?);

-- 非递归查询：精确匹配
SELECT * FROM files
WHERE folder_path = ? OR folder_path = ?;
```

## 联系支持

如遇问题，请提供：
- 容器日志
- 数据库路径示例
- 问题的具体文件夹路径
