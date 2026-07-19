# Luvia Gallery v1.2.2 (Large Library Responsiveness)

本次更新针对超大媒体库在定时扫描期间出现的全站内容请求暂停进行性能优化，并加强扫描清理的数据安全门禁。

### 性能与稳定性
- 缓存统计和媒体扫描改用 `opendir` 异步流式遍历，文件状态读取限制为 16 路并发、每批最多 256 项，并在固定批次主动让出 Node.js 事件循环。
- 缓存统计与媒体扫描使用单一后台任务协调器，禁止两个约 90 万文件级任务重叠执行。
- 增量扫描不再一次性加载整个数据库；修改时间查询最多 512 条，清理使用 `rowid` 游标按 256 条分批执行。
- 任意目录读取、文件状态或数据库写入失败都会将本轮标记为不完整，并禁止删除索引和收藏，避免存储短暂离线时误清理。
- FTS、文件表和收藏删除纳入同一 SQLite 事务；任一写入失败会整体回滚并停止后续清理。
- 增加事件循环 p99/max 延迟监控，便于从生产日志直接识别主线程阻塞。
- 新增 Node 原生测试，覆盖流式让出、并发上限、扫描互斥、停止语义、游标清理和事务回滚。

# Luvia Gallery v1.2.1 (Production Stability)

本次更新针对 FNOS 生产环境中 `luvia-gallery` 容器内存持续膨胀与媒体浏览间歇卡顿进行稳定性修复。

### 修复与优化
- 修复 `runner.js` 代理层缺少连接生命周期清理的问题：客户端断开、上游异常、空闲超时都会主动销毁对应 socket，避免内部 `runner.js -> server.js` 连接长期滞留。
- 代理到内部后端时强制使用短连接并关闭 keep-alive 复用，降低图片/视频 Range 请求堆积导致的 socket 缓冲占用。
- 为 Supervisor HTTP 服务设置明确的 keep-alive、headers timeout 与代理空闲超时，提升异常网络场景下的鲁棒性。
- 为 Docker Compose 增加 `mem_limit`、`memswap_limit` 与 `NODE_OPTIONS=--max-old-space-size=2048`，防止容器无上限占用 FNOS 内存与 swap。

# 🚀 Luvia Gallery v1.2.0 (Kotlin Native Refactor)

本次更新完成了移动端从 React Native 到 Android 原生 Kotlin (Jetpack Compose) 的全面重构。

### 🆕 核心特性
- **Jetpack Compose UI**：100% 原生声明式 UI，带来更丝滑的交互体验与更低的内存占用。
- **类型安全导航**：全新的路由系统，彻底消除旧版中常见的导航状态异常。
- **动态服务器接入**：登录界面支持输入自定义服务器地址，完美支持私有化部署。
- **Stitch 设计系统**：完美复刻 Stitch 产出的高保真设计，提供极致的视觉质感。

### 🛠️ 架构升级
- **MVVM + Hilt**：标准化的原生开发模式，提升了代码的鲁棒性与可测试性。
- **Coil 图片加载**：优化的位图缓存管理，图库滚动帧率稳定在 120fps (支持高刷设备)。

# 🚀 Luvia Gallery v1.1.0

本次更新带来了搜索性能的质感飞跃以及移动端交互深度的全面进化。

### 🆕 核心特性
- **FTS5 搜索引擎**：服务端与移动端同步升级至 SQLite FTS5 原生全文检索，支持毫秒级模糊匹配。
- **层级文件夹跳转**：移动端现已支持点击“跳转到文件夹”后保留完整的父级目录回退栈，体验与 Web 端对齐。
- **极简 Header UI**：移除了所有页面冗余的副标题，优化主标题垂直居中对齐，界面更清爽。

### 🐞 修复与优化
- **分页加载修复 (GLM-5)**：彻底重构了图库与文件夹视图的 `onEndReached` 锁循环机制，解决无限重复加载导致的内存溢出。
- **安装包瘦身**：通过锁定 `arm64-v8a` 架构编译与清除多余本地库，包体积从 97MB 缩减至 **37MB**。
- **多端一致性**：同步了 Web 与 Mobile 的搜索占位符与交互反馈。

### 📦 构建信息
- **Android**: v1.1.0 (Release Build)
- **Architecture**: arm64-v8a
- **Signing**: Production Keystore Signed (promenar)
