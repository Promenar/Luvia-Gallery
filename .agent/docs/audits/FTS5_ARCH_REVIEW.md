# FTS5 搜索方案架构审核报告

> 审核日期: 2026-03-07  
> 审核方: Kilo Code (GLM-5)  
> 方案来源: Gemini 3.1 Pro (Antigravity)

---

## 📋 一、审核结论

| 审核项 | 结论 | 风险等级 |
|--------|------|----------|
| 环境兼容性 | ⚠️ 需要修改 | **中** |
| 数据迁移 | ⚠️ 需要修改 | **高** |
| 接口重构 | ⚠️ 需要修改 | **中** |
| 整体方案 | ✅ 通过（需修正） | - |

**总体评价：** Gemini 的方案方向正确，`better-sqlite3` 确实是解决 90 万数据量搜索问题的最佳选择。但存在 **3 处关键设计缺陷** 需要修正后方可执行。

---

## 🔍 二、风险点深度分析

### 风险 1：环境兼容性 - Docker 构建流程需调整

**Gemini 原方案问题：**
> 直接 `npm i better-sqlite3` 替换 `sql.js`

**实际风险分析：**

| 环境 | sql.js (WASM) | better-sqlite3 (Native) |
|------|---------------|-------------------------|
| Docker x86_64 | ✅ 无需编译 | ✅ 需预编译工具链 |
| Docker ARM64 | ✅ 无需编译 | ✅ 需预编译工具链 |
| Windows 本地开发 | ✅ 无需编译 | ⚠️ 需 Visual Studio Build Tools |
| macOS 本地开发 | ✅ 无需编译 | ✅ 需 Xcode Command Line Tools |

**当前 Dockerfile 分析：**
```dockerfile
# Stage 2: prod-deps 阶段
FROM node:20-bookworm as prod-deps
RUN npm install --production  # ❌ 缺少编译工具
```

**修正方案：**
```dockerfile
# Stage 2: prod-deps 阶段（需添加编译依赖）
FROM node:20-bookworm as prod-deps
WORKDIR /app
COPY package*.json ./

# 添加 better-sqlite3 编译所需的系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com/ && npm install --production
```

**Mobile 端影响：**
- Mobile 端使用 `expo-sqlite`（已存在于 `mobile/package.json`）
- `expo-sqlite` 与服务端 `better-sqlite3` 是**独立的两个包**
- Mobile 端**不需要任何改动**，搜索请求通过 API 发送到服务端执行

**结论：** ✅ 可行，需修改 Dockerfile 添加编译工具链

---

### 风险 2：数据迁移 - FTS5 触发器设计有严重缺陷

**Gemini 原方案问题：**
```sql
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    name, folder_path, 
    content='files', 
    content_rowid='id'  -- ❌ 致命错误！
);
```

**问题分析：**

1. **`id` 字段是 TEXT 类型，不是 INTEGER ROWID**
   - 当前 `files` 表定义：`id TEXT PRIMARY KEY`
   - FTS5 的 `content_rowid` 必须是 INTEGER 类型
   - 这会导致触发器执行失败

2. **缺少 `tokenize` 参数**
   - 默认分词器不支持中文
   - 90 万媒体文件名可能包含中文、日文等

**修正方案：**

```sql
-- 方案 A：使用 rowid 而非 id（推荐）
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
    name, 
    folder_path,
    tokenize='unicode61'  -- 支持中文分词
);

-- 使用 SQLite 内部 rowid 关联
CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, name, folder_path) 
    VALUES (new.rowid, new.name, new.folder_path);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder_path) 
    VALUES('delete', old.rowid, old.name, old.folder_path);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder_path) 
    VALUES('delete', old.rowid, old.name, old.folder_path);
    INSERT INTO files_fts(rowid, name, folder_path) 
    VALUES (new.rowid, new.name, new.folder_path);
END;
```

**数据迁移脚本（首次部署时）：**

```javascript
async function migrateToFTS5() {
    console.log('[Migration] Starting FTS5 migration...');
    
    // 1. 检查是否已迁移
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'").get();
    if (tables) {
        console.log('[Migration] FTS5 already exists, skipping.');
        return;
    }
    
    // 2. 创建 FTS5 虚拟表
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            name, folder_path, tokenize='unicode61'
        );
    `);
    
    // 3. 批量导入现有数据（分批处理避免内存溢出）
    const BATCH_SIZE = 10000;
    let offset = 0;
    let total = 0;
    
    while (true) {
        const rows = db.prepare(`
            SELECT rowid, name, folder_path FROM files LIMIT ? OFFSET ?
        `).all(BATCH_SIZE, offset);
        
        if (rows.length === 0) break;
        
        const insert = db.prepare(`
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (?, ?, ?)
        `);
        
        const insertMany = db.transaction((items) => {
            for (const item of items) {
                insert.run(item.rowid, item.name, item.folder_path);
            }
        });
        
        insertMany(rows);
        total += rows.length;
        offset += BATCH_SIZE;
        console.log(`[Migration] Indexed ${total} files...`);
    }
    
    // 4. 创建触发器
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
        END;
        -- ... 其他触发器
    `);
    
    console.log(`[Migration] FTS5 migration complete. Total: ${total} files.`);
}
```

**结论：** ⚠️ 需要修正 FTS5 schema 设计，并添加迁移脚本

---

### 风险 3：接口重构 - 内存溢出风险

**Gemini 原方案问题：**
> 将 `.step()` 改为 `.all()` 捞取

**问题分析：**

当前 `queryFiles` 使用游标模式：
```javascript
while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
}
```

`better-sqlite3` 的 `.all()` 会一次性返回所有结果：
```javascript
const results = stmt.all(...params);  // 90万条 → 内存爆炸！
```

**内存估算：**
- 单条 MediaItem 约 500 bytes
- 90 万条 = 450 MB 内存占用
- 多用户并发请求 → OOM 崩溃

**修正方案：**

```javascript
// better-sqlite3 正确的分页查询方式
function queryFiles(options = {}) {
    const { offset = 0, limit = 500, search, ...otherOptions } = options;
    
    let query, params;
    
    if (search) {
        // FTS5 搜索
        query = `
            SELECT f.*, fav.id as is_fav 
            FROM files f
            LEFT JOIN favorites fav ON f.id = fav.item_id AND fav.user_id = ?
            JOIN files_fts fts ON f.rowid = fts.rowid
            WHERE files_fts MATCH ?
            ORDER BY f.last_modified DESC
            LIMIT ? OFFSET ?
        `;
        params = [userId, search, limit, offset];
    } else {
        // 常规查询（保持原有逻辑）
        query = `SELECT f.*, fav.id as is_fav FROM files f ... LIMIT ? OFFSET ?`;
        params = [...otherParams, limit, offset];
    }
    
    // better-sqlite3 的 .all() 配合 LIMIT 是安全的
    return db.prepare(query).all(...params);
}
```

**关键点：**
1. 所有查询必须带 `LIMIT` 子句
2. 搜索结果也必须分页
3. 前端需配合实现"加载更多"或虚拟滚动

**结论：** ✅ 可行，但必须强制分页

---

## 🛠 三、修正后的完整实施方案

### 阶段 1：依赖替换与 Dockerfile 修改

```dockerfile
# Dockerfile 修改
FROM node:20-bookworm as prod-deps
WORKDIR /app
COPY package*.json ./

# 添加编译依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm install --production
```

```json
// package.json 修改
{
  "dependencies": {
    "better-sqlite3": "^11.0.0"  // 替换 sql.js
  }
}
```

### 阶段 2：database.js 重写

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data', 'lumina.db');
let db = null;

function initDatabase() {
    db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');  // 启用 WAL 模式
    
    createSchema();
    migrateToFTS5();  // FTS5 迁移
}

function createSchema() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            size INTEGER NOT NULL,
            type TEXT NOT NULL,
            media_type TEXT NOT NULL,
            last_modified INTEGER NOT NULL,
            source_id TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            thumb_width INTEGER,
            thumb_height INTEGER,
            thumb_aspect_ratio REAL
        );
        
        CREATE INDEX IF NOT EXISTS idx_folder_path ON files(folder_path);
        CREATE INDEX IF NOT EXISTS idx_media_type ON files(media_type);
        CREATE INDEX IF NOT EXISTS idx_last_modified ON files(last_modified DESC);
    `);
    // saveDatabase() 不再需要！WAL 模式自动持久化
}

// 搜索函数
function searchFiles(keyword, options = {}) {
    const { offset = 0, limit = 100, userId } = options;
    
    return db.prepare(`
        SELECT f.*, fav.id as is_fav 
        FROM files f
        LEFT JOIN favorites fav ON f.id = fav.item_id AND fav.user_id = ?
        JOIN files_fts fts ON f.rowid = fts.rowid
        WHERE files_fts MATCH ?
        ORDER BY f.last_modified DESC
        LIMIT ? OFFSET ?
    `).all(userId, keyword, limit, offset);
}
```

### 阶段 3：API 端点

```javascript
// server.js
app.get('/api/scan/results', (req, res) => {
    const search = req.query.search;
    
    if (search) {
        const files = database.searchFiles(search, { userId, offset, limit });
        return res.json({ files, total: files.length });
    }
    
    // 原有逻辑...
});
```

---

## 📊 四、性能预期

| 操作 | sql.js (当前) | better-sqlite3 (预期) |
|------|---------------|----------------------|
| 全文搜索 90 万条 | > 30s (超时) | < 50ms |
| 单次写入 | 阻塞 500ms+ | < 1ms |
| 并发读取 | 单线程阻塞 | 多线程并行 |
| 内存占用 | 450MB+ 常驻 | ~50MB |

---

## ⚠️ 五、执行前检查清单

- [ ] 确认部署环境为 x86_64 或 ARM64 Linux
- [ ] 备份现有 `data/lumina.db` 文件
- [ ] 修改 Dockerfile 添加编译工具
- [ ] 修改 package.json 替换依赖
- [ ] 重写 database.js
- [ ] 添加 FTS5 迁移脚本
- [ ] 测试环境验证迁移流程
- [ ] 生产环境灰度发布

---

## 📝 六、最终结论

**方案通过，需执行以下修正：**

1. ✅ `better-sqlite3` 替换方向正确
2. ⚠️ Dockerfile 需添加 `python3 make g++` 编译工具
3. ⚠️ FTS5 schema 需使用 `rowid` 而非 `id`
4. ⚠️ 添加 `tokenize='unicode61'` 支持中文
5. ⚠️ 添加迁移脚本处理现有数据
6. ✅ Mobile 端无需改动

**建议执行顺序：**
1. 先在测试环境验证迁移脚本
2. 确认 FTS5 搜索功能正常
3. 生产环境备份后执行迁移

---

> 审核完成，方案可执行。
