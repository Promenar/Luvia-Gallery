# 生产级 90万 数据体量架构升级与 FTS5 搜索方案

> 文档日期: 2026-03-07  
> 执笔: Gemini 3.1 Pro (Antigravity)  
> 审核指引: 建议交由 Kilo Code (GLM-5) 进行架构审核及风险推演

---

## 🚀 一、背景诊断与挑战

系统实际生产环境中将面临 `90,000` 条媒体资产数据存储量。
当前服务端使用的 `sql.js` (SQLite WASM 版) 已暴露严重架构缺陷：

1. **写放大噩梦与 I/O 阻塞**
   `sql.js` 属于纯内存数据库引擎，不支持增量 `WAL` 日志写入硬盘。所有修改（点赞、重命名、新增或扫描文件）均触发 `fs.writeFileSync`，将高达数百 MB 的内存数据库全量回写硬盘。频繁写入会彻底阻塞 Node.js 生态的主线程。
2. **全文搜索（FTS5）缺失**
   项目中使用的 `sql.js` 包自身并未编译挂载 `FTS5` 模块，导致面对 90 万字符串无法实现毫秒级倒排索引，强制回退至耗时极长且容易导致请求超时的 `LIKE '%text%'` 全表扫描。

---

## 🛠 二、核心升级计划 (The Plan)

为此我们需要启动架构替换：**从 `sql.js` 驱逐并无缝切换至原生模块 `better-sqlite3`（天然集成 FTS5，并且采用高效的 WAL 持久化策略）。**

### 1. 引擎无缝切换 (Drop-in Replacement)
通过 `npm i better-sqlite3` 替换原本 `sql.js` 及其配套胶水代码。该原生模块底层具备同样的接口思想并且更适配 V8 Vm。

### 2. 初始化流程重塑与 IO 优化
剥除原有 `database.js` 里面通过 `db.export()` 手动维护内存落盘的代码：
```javascript
// Before (sql.js 阻塞式保存)
function saveDatabase() {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data)); // 阻塞！
}

// After (better-sqlite3)
const db = require('better-sqlite3')(DB_FILE);
db.pragma('journal_mode = WAL'); // 启用预写式日志，高频增删改不阻塞
// saveDatabase 机制直接作废，由 SQLite 原生持久化接管
```

### 3. FTS5 原生检索引擎及触发器构建
在第一次初始化表结构时，通过 `TRIGGER` 让 SQLite 内核全自动为媒体属性字段（如名字 `name`，所属目录 `folder_path`）同步全文索引，前端及服务端不再需要显式维护搜索条目。
```sql
-- 1. 建立虚拟搜索表
CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, folder_path, content='files', content_rowid='id');

-- 2. 挂载自动化同步触发器
CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.id, new.name, new.folder_path);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.id, old.name, old.folder_path);
END;

CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.id, old.name, old.folder_path);
    INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.id, new.name, new.folder_path);
END;
```

### 4. 数据查询改造与搜索联调
所有的模糊查询直接进化为分词检索。当 API 接口收到 `search` 关键字参数：
```sql
-- 从前
SELECT * FROM files WHERE name LIKE '%text%' COLLATE NOCASE;

-- 进化后
SELECT f.* FROM files_fts fts 
JOIN files f ON f.id = fts.rowid 
WHERE files_fts MATCH 'text';
```
在前端及移动端界面追加状态关联和输入防抖策略，通过 URL Params 透传给改写的接口层。

---

## ⚠️ 三、重点审计请求 (To Kilo Code)

请 Kilo Code 架构师针对本实施方案进行深度架构风险排查：

1. **环境兼容验证：** 我们存在三端协作，且服务端部署可能在各种架构的宿主体。由 WebAssembly 换回依赖 N-API 编译底层的 `better-sqlite3` `C++` 依赖是否在部署（移动端构建流程/服务端 CI流程）中有踩坑风险？是否有更好的一致性降级替代（例如 Node.js 原生 `sqlite` api 或者 Prisma）？
2. **已有数据迁移验证：** `better-sqlite3` 对于之前 `sql.js` 生成的老版本纯二进制 `lumina.db` 在开启 WAL pragma 模式时的表现？原有 90 万数据启动时是否要单独起一个迁移脚本运行重构 fts5 的 `INSERT INTO ... SELECT` 全扫描过程？
3. **接口重构盲区：** 我们会一并修改 `database.js` 中的游标，目前代码将 `.step()` 取数组项改写为了直接 `.all()` 捞取，对于几十万数据量的接口暴露是否有内存爆表的隐患？是否需要改写为 yield 生成器处理？

---

> 完成以上方案审核并修改后即可指导代码执行阶段落地。
