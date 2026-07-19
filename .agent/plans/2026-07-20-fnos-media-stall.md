# FNOS 媒体浏览全局停顿优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 消除约 90 万媒体文件与缓存文件定时扫描对 Node.js 主事件循环造成的 6-20 秒全局阻塞，并保持现有媒体、扫描和状态 API 契约不变。

**架构：** 把目录读取和文件元数据读取抽取为基于 `fs.promises` 的有界并发遍历器，以小批次向现有扫描逻辑提供结果；缓存统计和媒体扫描共享后台 I/O 门禁，禁止两者重叠。使用 Node.js `perf_hooks` 记录事件循环延迟，让生产日志能够直接验证优化效果。

**技术栈：** Node.js CommonJS、`node:test`、`fs.promises`、Express、SQLite/FTS5、Docker Compose。

## 全局约束

- 不改变现有 HTTP API 路径、请求参数、鉴权方式和响应结构。
- 不引入第三方运行时依赖。
- 文件系统并发必须有上限，禁止一次为约 90 万个文件创建 Promise。
- 后台任务失败不得导致 Node 进程退出；停止扫描语义必须保留。
- 所有新增文档和注释使用简体中文。

---

### Task 1: 异步有界并发文件遍历器

**Files:**
- Create: `lib/background-file-walker.js`
- Create: `test/background-file-walker.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `collectCacheStats(root, options)`，返回 `{ count, size }`。
- Produces: `walkMediaFiles(roots, options)`，异步生成固定上限的小批量媒体元数据。

- [ ] **Step 1: 写失败测试**

覆盖递归缓存统计、媒体扩展名过滤、批量大小上限、停止条件，以及长遍历期间定时器仍能执行。

- [ ] **Step 2: 验证测试正确失败**

Run: `node --test test/background-file-walker.test.js`
Expected: FAIL，原因是 `lib/background-file-walker.js` 尚不存在或导出函数缺失。

- [ ] **Step 3: 实现最小异步遍历器**

使用 `fs.promises.readdir(..., { withFileTypes: true })` 与有界并发 `stat`；每批完成后通过 `setImmediate` 主动让出事件循环。错误通过可选回调上报，单个无权限或消失文件不终止整个任务。

- [ ] **Step 4: 验证测试转绿**

Run: `node --test test/background-file-walker.test.js`
Expected: PASS。

### Task 2: 接入缓存统计和周期媒体扫描

**Files:**
- Modify: `server.js`
- Modify: `test/background-file-walker.test.js`

**Interfaces:**
- Consumes: `collectCacheStats()` 与 `walkMediaFiles()`。
- Produces: 与现有 `updateGlobalCacheStats()`、`processScan()` 相同的外部行为。

- [ ] **Step 1: 写失败测试**

增加后台任务门禁状态测试：缓存统计运行时不得启动媒体扫描，媒体扫描运行时不得启动缓存统计。

- [ ] **Step 2: 验证测试正确失败**

Run: `node --test test/background-file-walker.test.js`
Expected: FAIL，原因是后台任务协调器尚未实现。

- [ ] **Step 3: 接入现有业务流程**

将缓存统计改为异步调用并维持最近一次成功统计；将 `processScan()` 的同步目录循环替换为异步批次消费，保留增量 mtime 判断、批量数据库写入、暂停和停止语义。后台任务使用单一协调器避免缓存统计与周期扫描重叠。

- [ ] **Step 4: 验证测试转绿**

Run: `node --test test/background-file-walker.test.js`
Expected: PASS。

### Task 3: 可观测性与回归验证

**Files:**
- Modify: `server.js`
- Modify: `release_notes.md`
- Modify: `.agent/handover.md`

**Interfaces:**
- Produces: 周期任务耗时日志与事件循环延迟告警，不改变 API。

- [ ] **Step 1: 增加事件循环延迟监控**

使用 `monitorEventLoopDelay()` 每分钟输出 p99/max；仅在超过阈值时告警，定时器调用 `unref()`，不得阻止进程退出。

- [ ] **Step 2: 运行回归验证**

Run: `node --test test/background-file-walker.test.js`
Expected: PASS。

Run: `node --check server.js && node --check lib/background-file-walker.js`
Expected: PASS。

Run: `npm run build`
Expected: PASS。

- [ ] **Step 3: 同步 DIA 与 HLG**

在 `release_notes.md` 记录生产性能优化；向 `.agent/handover.md` 追加标准时间戳记录，并重新生成 `.agent/handover-index.md`。

### Task 4: 生产部署与观测

**Files:**
- Modify: FNOS `/vol2/1000/APPDATA/Lumina` 下的运行镜像和 Compose 容器状态。

**Interfaces:**
- Consumes: 已推送的 `main` 提交。
- Produces: 运行新提交、保留 `9980:3001` 与既有卷映射的 `luvia-gallery` 容器。

- [ ] **Step 1: 提交并推送**

提交本次源码、测试和文档，推送到 `origin/main`。

- [ ] **Step 2: 部署并重建容器**

沿用生产真实 Compose 配置与本地镜像更新流程，不覆盖生产端口和卷映射。

- [ ] **Step 3: 生产验证**

确认容器提交、内存限制、重启/OOM、API smoke、事件循环告警、缓存统计耗时和周期扫描耗时；在一个 10/15 分钟窗口内确认 API 响应不再整体停顿。
