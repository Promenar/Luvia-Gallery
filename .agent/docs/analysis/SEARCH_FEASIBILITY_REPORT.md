# 搜索功能可行性分析报告

> 分析日期: 2026-03-07  
> 分析范围: 后端架构、数据库结构、前端数据流

---

## 一、结论摘要

**✅ 现有架构可以直接实现搜索功能，无需重大重构。**

推荐方案：**方案 A - LIKE 模糊搜索**（最小改动，立即可用）

---

## 二、现有架构分析

### 2.1 后端架构

| 组件 | 技术栈 | 说明 |
|------|--------|------|
| Web 框架 | Express.js | RESTful API |
| 数据库 | SQL.js (SQLite) | 内存数据库 + 文件持久化 |
| 数据文件 | `data/lumina.db` | SQLite 二进制文件 |

**主要 API 端点：**
```
GET /api/scan/results
  ?offset=0
  &limit=100
  &folder=<path>
  &favorites=true
  &random=true
  &recursive=true
  &sort=dateDesc|dateAsc|nameAsc|nameDesc
  &mediaType=image|video|audio
  &excludeMediaType=<type>
```

**当前不支持：** 文本搜索参数

### 2.2 数据库结构

**files 表结构：**
```sql
CREATE TABLE files (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,           -- 可搜索字段
    folder_path TEXT NOT NULL,    -- 可搜索字段
    size INTEGER NOT NULL,
    type TEXT NOT NULL,
    media_type TEXT NOT NULL,
    last_modified INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    created_at INTEGER,
    thumb_width INTEGER,
    thumb_height INTEGER,
    thumb_aspect_ratio REAL
)
```

**现有索引：**
```sql
CREATE INDEX idx_name ON files(name COLLATE NOCASE);        -- ✅ 支持大小写不敏感搜索
CREATE INDEX idx_folder_path ON files(folder_path);
CREATE INDEX idx_last_modified ON files(last_modified DESC);
CREATE INDEX idx_media_type ON files(media_type);
CREATE INDEX idx_source_id ON files(source_id);
```

**关键发现：** `idx_name` 索引已使用 `COLLATE NOCASE`，可直接用于大小写不敏感的 LIKE 查询。

### 2.3 前端数据流

**Web 端：**
```
App.tsx
  └── fetchServerFiles()
        └── GET /api/scan/results
              └── database.queryFiles()
```

**Mobile 端：**
```
mobile/App.tsx
  └── mobile/utils/api.ts::fetchFiles()
        └── GET /api/scan/results
              └── database.queryFiles()
```

---

## 三、实现方案对比

### 方案 A：LIKE 模糊搜索（推荐）

**实现方式：**
```sql
SELECT * FROM files WHERE name LIKE '%keyword%' COLLATE NOCASE
```

**优点：**
- ✅ 改动最小（3个文件，约50-80行代码）
- ✅ 无需数据库迁移
- ✅ 利用现有 `idx_name` 索引
- ✅ 立即可用

**缺点：**
- ⚠️ 前缀通配符 `%keyword` 无法利用索引（但数据量小时影响不大）
- ⚠️ 不支持分词搜索

**性能评估：**
| 数据量 | 预期响应时间 |
|--------|--------------|
| < 10,000 | < 50ms |
| 10,000 - 50,000 | 50-200ms |
| > 50,000 | 可能需要优化 |

---

### 方案 B：SQLite FTS5 全文搜索

**实现方式：**
```sql
CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files');
SELECT * FROM files_fts WHERE files_fts MATCH 'keyword';
```

**优点：**
- ✅ 支持高级搜索（分词、布尔运算、排序）
- ✅ 大数据量性能更优

**缺点：**
- ❌ 需要数据库迁移
- ❌ 实现复杂度高
- ❌ 需要同步维护 FTS 表

---

### 方案 C：前端本地过滤

**实现方式：**
```typescript
const filtered = loadedFiles.filter(f => 
    f.name.toLowerCase().includes(keyword.toLowerCase())
);
```

**优点：**
- ✅ 无需后端改动
- ✅ 响应即时

**缺点：**
- ❌ 只能搜索已加载的数据
- ❌ 不适合大数据量场景
- ❌ 无法搜索未加载的分页数据

---

## 四、推荐实现路径

### 阶段 1：LIKE 搜索（立即可行）

**后端改动：**

1. **database.js** - 添加搜索参数
```javascript
function queryFiles(options = {}) {
    const {
        // ... 现有参数
        search = null,  // 新增：搜索关键词
    } = options;
    
    // 在 WHERE 子句中添加
    if (search) {
        query += ' AND f.name LIKE ?';
        params.push(`%${search}%`);
    }
}
```

2. **server.js** - API 端点支持
```javascript
app.get('/api/scan/results', (req, res) => {
    const search = req.query.search;  // 新增
    // ...
    const files = database.queryFiles({
        // ... 现有参数
        search
    });
});
```

**前端改动：**

1. **App.tsx** - 添加搜索状态和 UI
```typescript
const [searchQuery, setSearchQuery] = useState('');

// 修改 fetchServerFiles
const url = `/api/scan/results?...&search=${encodeURIComponent(searchQuery)}`;
```

2. **mobile/utils/api.ts** - Mobile 端同步支持
```typescript
interface FetchFilesOptions {
    // ... 现有参数
    search?: string;
}

export const fetchFiles = async (options: FetchFilesOptions = {}) => {
    if (options.search) url += `&search=${encodeURIComponent(options.search)}`;
};
```

### 阶段 2：性能优化（可选，大数据量时）

- 添加搜索结果缓存
- 实现搜索防抖（300ms）
- 考虑升级到 FTS5

---

## 五、改动清单

| 文件 | 改动类型 | 改动量 |
|------|----------|--------|
| `database.js` | 添加搜索参数 | ~10 行 |
| `server.js` | API 参数解析 | ~5 行 |
| `App.tsx` | 搜索 UI + 状态 | ~30 行 |
| `mobile/utils/api.ts` | 参数支持 | ~5 行 |
| `mobile/App.tsx` | 搜索 UI | ~30 行 |

**总计：约 80 行代码改动**

---

## 六、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 性能问题（大数据量） | 低 | 阶段性升级到 FTS5 |
| 前端状态管理复杂度 | 低 | 使用现有状态模式 |
| Mobile 端同步 | 低 | 复用 Web 端逻辑 |

---

## 七、下一步建议

1. **立即执行：** 实现方案 A（LIKE 搜索）
2. **后续优化：** 根据实际数据量决定是否升级到 FTS5
3. **UI 设计：** 在顶部导航栏添加搜索图标和输入框

---

## 附录：关键代码位置

| 功能 | 文件位置 |
|------|----------|
| 数据库查询 | [database.js:224-345](file:///Users/promenar/Codex/Luvia-Gallery/database.js#L224-L345) |
| API 端点 | [server.js:1217-1350](file:///Users/promenar/Codex/Luvia-Gallery/server.js#L1217-L1350) |
| Web 数据获取 | [App.tsx:718-800](file:///Users/promenar/Codex/Luvia-Gallery/App.tsx#L718-L800) |
| Mobile API | [mobile/utils/api.ts:217-280](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/api.ts#L217-L280) |
