# Lumina Gallery 完整开发历史记录 (Consolidated)

本文档归档了自项目启动以来的核心技术决策、重构路径及 Bug 修复记录。作为项目的“长期记忆库”，旨在确保 AI 助手在任何环境下都能保持开发的连续性。

---

## 📅 最近更新 (2025-12-19)
### 核心架构与稳定性
- **统一数据加载流**：`App.tsx` 中的数据加载已从分散的 `useEffect` 合并为统一的副作用管理（依据 `activeTab` 和 `currentPath`）。彻底解决了子文件夹进入不加载和切换标签不刷新的顽疾。
- **SQLite 并发初始化防护**：`Database.ts` 引入 Promise 单例模式确保 `initDatabase` 在高并发启动时仅执行一次，根治了 Android 端的 `prepareAsync` 崩溃。
- **SQLite 并发写入队列**：在 `Database.ts` 中引入全局 Promise 写入队列，强制分批存储任务顺序执行，彻底解决了“无法在事务中开启事务”的并发冲突。
- **Glide (expo-image) 稳定性加固**：移除了轮播图背景的高风险原生 `transition`，并配合 `Reanimated` 透明度动画，实现了“视觉无损”的崩溃方案，根治了原生层的 `IllegalStateException`。
- **导航零闪烁优化**：稳定了 `App.tsx` 中的组件挂载结构，实现了平滑的文件夹切换体验。
- **首页性能优化**：实现“缓存优先”加载策略。先秒开本地缓存内容，再静默替换线上最新数据，解决首页闪白问题。

---

## 📅 最近更新 (2025-12-21)
### 关键稳定性与安全修复 (v2.1.0)
- **后端崩溃修复 (500 Error)**: 修复了 `/api/scan/status` 调用未定义的 `database.db` 导致的崩溃。通过重构为使用 `database.getStats()` 安全接口解决此类问题。
- **认证体系加固 (403/401 Error)**: 
    - 前端 `App.tsx` 实现全局 `authFetch` 拦截器，确保所有 API 请求（含初始化自检）均携带 JWT Token。
    - 修复了 `initApp` 由于使用未认证 fetch 导致的配置加载失败和无限 401 循环。
- **用户隔离与权限管理**:
    - **Config Persistence**: 修复了 `POST /api/config` 和 `POST /api/users/:targetUser` 的合并逻辑，解决了编辑用户时 `allowedPaths` 和 `isAdmin` 字段意外丢失的问题。
    - **UI 安全**: 限制了非管理员对 `/api/config` 写入接口的调用。
    - **Thumbnail 403 修复**: 统一了 `checkFileAccess` 的管理员判定逻辑，支持从 JWT 负载中识别 `role: 'admin'`，解决了管理员无法查看私有缩略图的 Bug。
- **扫描器体验优化**:
    - **状态同步回显**: 解决了媒体扫描器启动后因异步延迟导致的 UI 误报“完成”的问题。通过在 API 响应前同步锁定状态，确保前端轮询始终能获取到 `scanning` 状态。
- **Docker 部署**: 修复了容器内代码版本与本地不一致的问题，确保补丁成功上线。

---

## 🏛️ 历史归档 (迁移自前期开发记录)

### 安全与认证体系 (v1.2.0)
- **JWT 全局覆盖**：服务端引入 JWT 校验，所有 `/api/*` 路由（除登录、公开配置外）均需 `Bearer` Token。
- **媒体流式加载**：为解决标签无法直接访问受限资源的问题，在 Media URL 中注入 `?token=<jwt>`。
- **API 封装**：移动端与 Web 端均封装了 `authenticatedFetch` / `apiFetch` 拦截器。

### 响应式与大屏适配
- **动态布局算法**：建立栅格标准。媒体卡片目标宽度 ~110px，文件夹卡片 ~160px，列数随窗口宽度动态计算并强制重绘。
- **多列轮播图**：首页轮播图在平板/折叠屏模式下支持侧并侧显示 2-3 个项，增强大屏空间利用率。
- **Window Hook 化**：全站弃用 `Dimensions.get`，改用 `useWindowDimensions()` 以响应旋转和分屏。

### 桌面端与 Web 性能优化 (Lighthouse)
- **代码分割 (Code Splitting)**：使用 `React.lazy` 和 `Suspense` 异步加载 `VirtualGallery` 等大组件，大幅降低首屏 JS 体积。
- **移除阻塞资源**：弃用了 Tailwind CDN，完全采用 Vite 预编译 CSS。
- **容器化部署**：优化 `Dockerfile`，支持卷挂载（`/app/data`, `/app/cache`, `/media`）以实现数据持久化。

### 渲染黑科技与体验细节
- **流式画廊 (Unified Stream)**：在文件夹视图中，将子文件夹和媒体文件合并入同一个 `VirtualGallery` 列表，消除布局断层。
- **视频增强**：视频播放器改为沉浸式底部控制条，支持自动/手动旋转切换。
- **CSS 视觉加固**：
    - 移除了所有 GPU 开销巨大的 `blur-xl`（曾导致 Ghosting 鬼影）。
    - 解决了 `AutoSizer` 在容器伸缩时导致的 0 高度“黑屏”问题（改用 `absolute inset-0` 强制撑开方案）。

---

## 🛠️ 后端维护工具
- **智能扫描器**：支持异步递归扫描，提供暂停、继续、停止控制流。
- **缓存管理**：
    - `Clear Cache`: 全量清理。
    - `Prune Cache`: 仅清理孤立的（原图已删除的）缩略图。
    - **WebP 标准化**：缩略图生成默认切换为 WebP 格式以平衡画质与加载速度。
