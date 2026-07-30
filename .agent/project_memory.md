## Core Technical Decisions
- **Android Compose 原生重构 Phase 1 边界**（2026-07-30）：`native-ui/` 以
  `com.promenar.luvia` 建立 `:app`、`:core:model`、`:core:network`、`:core:designsystem`、
  `:feature:auth` 五模块 Kotlin/Compose 工程；`mobile/` 的 Expo/React Native 实现仍是生产移动端基线。
  当前只提供受控 HTTP/HTTPS 地址解析、协程登录、Material 3 登录页与迁移中主壳；成功后必须立即清除
  ViewModel 中的密码，但返回的 `Session` / token 尚未保存，已测试的 Bearer Header 组件也尚未接入
  后续认证客户端。图库、媒体、设置、管理、会话持久化与完整导航留待后续；AndroidTest 仅完成编译，
  无真机或模拟器运行证据，不得宣称原生移动端已完成或可替代生产版本。
- **macOS 在线目录浏览边界**（2026-07-30）：在线文件夹模式统一使用 `GET /api/library/folders` 按当前用户授权范围逐层懒加载，禁止改用权限更宽的 `/api/fs/list` 或一次性预取整棵树。目录 Token 只放在 `Authorization: Bearer`，不进入目录 URL 或日志；客户端兼容 `{"folders":[...]}` 与旧边界顶层数组，并以请求代次阻止旧响应覆盖新导航。虚拟授权根不可选，未选择实际目录时禁止开始文件夹轮播。
- **macOS 每显示器位置 V2**（2026-07-30）：悬浮窗不得用 `CGDirectDisplayID` 或 `CGDisplayCreateUUIDFromDisplayID` 作为跨重启物理身份，也不得持久化全局绝对 frame。位置以目标屏 `visibleFrame` 内的归一化横向/顶部比例与窗口尺寸保存；内置屏使用 vendor/model，外接屏优先 vendor/model/serial，无 serial 时使用名称与物理尺寸。身份不完整或当前连接指纹冲突时只使用进程内 session 档案。旧数字 ID 档案失败关闭，不自动迁移。
- **目录封面索引范围查询**（2026-07-29）：`/api/library/folders` 不得对每个子目录复用通用递归媒体查询；目录封面必须通过 `idx_folder_path` 的“目录自身 + 带分隔符的半开后代范围”查询，并在路由中先批量取得封面再组装响应。该路径需保持同前缀兄弟隔离、尾分隔符原始键回填，以及 `last_modified DESC, id ASC` 的稳定选择语义。
- **慢请求最小化日志**（2026-07-29）：后端对超过 1 秒的请求记录 method、`req.path`、status、duration 和 finish/close 结果，且同一请求最多记录一次；禁止将查询字符串、Authorization、Cookie 或请求正文写入慢请求日志。
- **WebUI 可恢复导航三层边界**（2026-07-26）：浏览器 History 是目录、视图、搜索、排序和媒体查看器的唯一历史事实源；`ViewportSnapshot` 仅保存会话级项目锚点、项目内偏移和已加载偏移；TanStack Query 按用户与服务端请求字段隔离媒体缓存。普通滚动捕获不得发布恢复命令，旧请求写入必须同时通过导航世代、位置键、请求所有权和取消信号校验。
- **WebUI 平行位置与统一工具栏**（2026-07-26）：`GalleryLocation.view` 是媒体库、收藏夹和文件夹的唯一空间判别，禁止新增并行路由状态；非 `folders` 位置在 URL、History 和 key 构造边界必须清空 `folderPath/path`。统一工具栏复用同一中央容器显示地址或作用域搜索，提交搜索使用 push，排序、筛选和布局使用 replace；1024px 以下使用 compact 结构，避免侧栏展开时压缩长路径。
- **超大媒体库后台 I/O**（2026-07-20）：缓存统计与媒体扫描必须使用 `opendir` 流式遍历、有界 `stat` 并发和批次级事件循环让出；两个全库任务由同一协调器互斥，禁止在 Node 主事件循环中使用递归 `readdirSync`/`statSync`。
- **扫描清理安全门禁**（2026-07-20）：目录读取、文件状态、增量查询或批量写入任一失败时，本轮扫描标记为不完整并禁止清理。数据库对账使用完整扫描路径集合与 `rowid` 游标批次；FTS、文件表和收藏删除必须处于同一事务并向上返回失败。
- **Unified Data Loading**: Managed via a single `useEffect` in `App.tsx` observing `activeTab` and `currentPath`. Eliminates duplicate fetch and stale views.
- **并发数据同步**：在 `Database.ts` 中实现全局写入队列。所有涉及事务的操作必须进入该队列排队执行，严禁在 Native 回调内直接触发可能导致嵌套事务的异步更新。
- **图片加载稳定性**：针对 `expo-image`，在频繁切换或背景层渲染时，优先移除原生 `transition` 属性，转而使用 `react-native-reanimated` 控制容器透明度。这能有效规避 Native 层的声明周期冲突（`IllegalStateException`）。
- **组件持久化导航**：在文件夹浏览等需要数据感知但视觉连贯的场景中，避免在容器视图上绑定基于路径的 `key`，通过状态驱动内容更新以消除闪烁。
- **SQLite Concurrency**: `initDatabase` uses a singleton Promise pattern to prevent race conditions during early-stage multi-component initialization. Added `updateFavoriteStatus` for optimistic local sync before server confirmation.
- **Modal Stability**: Hoist complex dialogs (e.g., `ConfirmDialogComponent`) to the top level of the screen component. This prevents recreation on every render, resolving UI flicker and animation glitches.
- **Grid Layout**: Precision pixel-based calculations for standard 8px gaps.
    - **Standard sizes**: Media items ~110px, Folder items ~160px. Use `useWindowDimensions` for responsiveness.
- **Elite UI & Interaction Standards** (Updated 2026-01-27):
    - **Soft-Border Aesthetic (软化边框)**：废弃高对比度的 `border-white/10`，改用极细的 `border-white/5` 或透明边框。利用背景色差（如 `bg-black/20` 对比 `bg-white/5`）和内阴影（Inset Shadow）营造层次感，避免界面被“白线”切割。
    - **下沉式输入设计 (Inset Input)**：输入框背景应使用比容器更深的色调（如 `bg-black/20`），配合微弱的外投影或内高光，营造视觉上的稳定感。
    - **含义明确的反馈动画**：避免使用可能引起歧义的动画（如旋转放大镜图标）。对后台非阻塞任务，优先使用淡入淡出（Opacity）或呼吸感（Pulse）动画；仅对重建/重启等阻塞任务使用强制旋转。
    - **Haptic Lock**: High-frequency updates (e.g., download progress) MUST use a `useRef` based lock to filtering vibrations. Only crucial state changes trigger haptics.
    - **Portal First**: All global overlays (Toasts, Dialogs) MUST use `Portal` to bypass z-index stacking context completely.
    - **Theme Namespace**: The global theme hook is strictly renamed to `useAppTheme` to avoid conflict with `react-native-paper`'s `useTheme`.
    - **Zero-Blank Strategy**: Critical implementations like Home Carousel MUST implement a cache-first strategy (load Database -> Display -> Background Fetch -> Update).
    - **Anti-Jitter**: Dynamic text (percentages) in notifications must be wrapped in fixed-width containers to preserve layout stability.
    - **Permission Consistency**: In `server.js`, always check for both `user.isAdmin` (direct object property) and `user.role === 'admin'` (from JWT payload) to ensure consistent access control across all middleware and helpers (e.g., `checkFileAccess`).
    - **Scanner State Sync**: When starting background tasks (like `processScan`), the `status` flag must be updated * synchronously* before returning the HTTP response. This prevents race conditions where the frontend's first status poll hits an `idle` state before the async task has technically started.
- **System Self-Healing Update System**: `runner.js` 具备环境自愈能力。在执行 Git 更新前，会自动执行 `git init`、`remote set-url` 及 `safe.directory` 补全。同时通过 `prepareSSHSync` 机制在 Linux 容器内动态挂载并修正宿主机 Windows 的 SSH 密钥权限。
- **Admin Auth Decoupling (鉴权分离)**：系统级操作遵循“查询宽容、执行严谨”策略。`GET /update/status` 等只读接口开放免鉴权以实现 UI 端的无缝版本检测；而 `POST` 类涉及敏感配置或系统重启的操作必须严格校验 `Authorization: Bearer` 令牌。
- **Config Caching**: `server.js` implements an in-memory TTL cache for `lumina-config.json` to minimize disk I/O. API endpoints and middleware should always use `getConfig()` helper.
- **Frontend Debounce**: UI configuration inputs (Title, Subtitle) in `App.tsx` MUST use the debounced `persistData` call to prevent excessive server syncs during typing.
- **Phoenix Protocol (Refactoring)**: For components with inexplicable freezes (like the original `SettingsScreen`), use a "burn and rebuild" approach. Create a V2 version from scratch, prioritize stability (no complex animations), and migrate features incrementally.
- **API Robustness (MIME Check)**: Network wrappers (like `adminFetch`) MUST check the `Content-Type` header before calling `.json()`. If the server returns HTML (e.g., a 404 or 500 error page), the wrapper must handle it gracefully or log it as a text response to prevent "Unexpected character: <" parsing errors.
- **Maintenance UI (Inline Progress)**: Server maintenance tasks (scan, thumb-gen) must use inline animated progress bars instead of modals. This includes real-time control (Pause/Cancel) integrated directly into the progress row for a seamless UX.
- **Concurrency Parity (Standardized)**: Thumbnail threads (`thumbnail_threads`) are capped at **64** on all platforms. A mandatory one-time safety warning is triggered when the value exceeds **16**. Implement using `useRef` (Mobile) or `window.confirm` (Web) to ensure the warning is non-intrusive.
- **UI Non-Intrusion**: System versioning information should be placed at the bottom of the scrollable content area rather than fixed overlays, preserving screen real-estate for functional controls.
- **Tailwind Build**: Standard Vite/PostCSS pipeline. No CDN links in `index.html`. Primary colors and fonts must be defined in `tailwind.config.js`.
- **Frontend State Resilience (Dual-Layer Navigation)** (Added 2025-12-23):
    - **Priority 1 (Hash)**: Always check `window.location.hash` (`#folder=...`) for deep-linking.
    - **Priority 2 (Storage)**: Use `localStorage` (`lumina_current_path`) as a fallback if the hash is lost due to aggressive browser navigation/refresh.
    - **Cleanup**: Clear storage when explicitly switching to root views ('home', 'all').
- **Component File Structure (Hoisting Strategy)**:
    - For large components like `App.tsx`, satisfy dependencies by ordering:
        1. **Static Constants** (Keys, IDs).
        2. **Main Function & Context Hooks**.
        3. **State & Ref Definitions**.
        4. **Auth Handlers (Logout/Login)**: Must be early as they delete tokens.
        5. **Secure Fetch Helper (`apiFetch`)**: Must follow Auth handlers.
        6. **Core Data Fetchers (`fetchServerFiles`, `fetchSystemStatus`)**: Must follow `apiFetch`.
        7. **High-Level Handlers & Polling Logic**: Call fetchers; must be placed after them to avoid `Cannot find name` errors.
        8. **Initialization Effects (`useEffect`)**: The entry point for the component lifecycle.


## Anti-Patterns to Avoid
- **Raw DB Access**: Never access `database.db` directly in `server.js`. It is private. Always use or create public helper methods (e.g., `getStats()`) in `database.js`.
- **Implicit Undefined in SQL**: Never pass `undefined` to `expo-sqlite` Native calls; sanitize with `?? null`.
- **Layout Collapsing**:
    - Avoid `return null` in major UI sections (Carousel/Grid) during loading; always provide skeleton/placeholder view.
    - Fix `VirtualGallery` zero-height bugs by using `absolute inset-0` on container wrappers.
- **Image Ghosting & High-DPI Blur**: 
    - Never use `backdrop-filter` on full-screen overlays, especially on high-DPI (4K) screens; it causes extreme GPU fill-rate bottlenecks. 
    - Prefer high-opacity solid backgrounds (e.g., `bg-black/80`) for modal backdrops. 
    - Never nest elements with `backdrop-filter`; redundant sampling will cause recursive performance drops.
- **Authenticated Media**: Direct `<img>` or `<Image>` tags will fail if `?token=<jwt>` is not appended to the URL query parameters.
- **Animation Overload**: Avoid bouncy/spring animations for system-level dialogs; prefer subtle Fade+Scale for a premium, non-distracting feel.
- **Native Bridge Deadlock (Haptics Trap)**: During massive UI recalculations (e.g., Theme switching via NativeWind 4 or complex Tab switching), AVOID synchronous Native-Bridge calls like `expo-haptics`. These calls can block the JS thread while the Native UI thread is also busy rendering, leading to an unrecoverable system freeze.
- **Hard-Line Dividers (生硬分割线)**：严禁在深色模式下使用纯白色或高透明度边框（如 `border-white/10`）作为列表分割线。优先使用边距（Padding/Gap）或微弱的背景灰度差（如 `bg-white/3`）进行逻辑分区，以保持界面的沉浸感。

- **Development Workflows**: 
    - **Performance**: Heavy UI components (VirtualGallery, ImageViewer) must be loaded using `React.lazy`.
    - **Windows Android Build**: When `eas build --local` is restricted by platform (macOS/Linux required), use `npx expo prebuild --platform android` followed by `gradlew.bat assembleRelease` in the `android` folder.
    - **Docs Path**: Reference `docs/antigravity/` for detailed maintenance logs.

- **Recursive Media Scanning**: The `/api/scan/results` endpoint (backend) and `fetchFiles` (frontend) now support a `recursive=true` flag. When combined with `favorites=true`, this recursively specifically expands *favorited folders* to include all their contained media, merging them with directly favorited files. This ensures "Favorites" mode is comprehensive.
- **Network Error Humanization**: 
    - API layer (`api.ts`) must classify errors into `NETWORK_OFFLINE` (TypeError), `NETWORK_TIMEOUT` (AbortError), and `SERVER_ERROR` (HTTP 500+).
    - Frontend must use a unified `getErrorMessage(e, t)` helper to convert technical errors into user-friendly i18n strings.
    - **Toast Integration**: All caught API errors should be displayed via the global `ToastContext` (BlurView/Haptics) rather than `alert()`.
    - **RedBox Policy**: Do NOT disable RedBox (LogBox) in development. It is vital for catching unhandled runtime crashes, while handled API errors should be toasted.

    - **Fix**: Before running `npx expo prebuild --clean` or `rm -rf android`, you **MUST** terminate all running node processes (`taskkill /F /IM node.exe`) and stop the Expo development server.

- **Docker & Deployment Architecture** (Updated 2025-12-23):
    - **Supervisor Pattern (The Undying Process)**: Use a lightweight Node.js entrypoint (`runner.js`) to spawn and monitor the main application (`server.js`). This enables:
        - **Crash Loop Detection**: Automatically enter "Safe Mode" (hosting a static recovery page) if the app crashes repeatedly.
        - **Zero-External-Downtime Updates**: The supervisor remains running while the child process is killed, updated via `git pull`, and restarted.
        - **Self-Evolution**: The supervisor hashes its own file content at startup. If an update modifies the supervisor code, it exits (`process.exit(0)`), triggering the Docker daemon's `restart: unless-stopped` policy to reload the new code.
    - **Data-Driven Security**: Support hot-swappable authentication for admin endpoints by reading secrets from a mounted volume (e.g., `/app/data/update_secret.txt`) on every request, rather than relying solely on static environment variables.

- **Windows Docker Bind Mounts (The 777 Trap)**:
    - **Problem**: Mounting `~/.ssh` directly into a Linux container on Windows results in `0777` permissions, causing OpenSSH to fail with "Bad owner or permissions".
    - **Solution**: Mount the folder to a temporary location (e.g., `/tmp/ssh_mount:ro`) and use an entrypoint script (`update.sh`) to `cp` keys to `/root/.ssh/` and `chmod 600` them at runtime. Never mount directly to `~/.ssh` on Windows hosts.

- **Production Dependency Build**:
    - When `NODE_ENV=production`, `npm install` skips `devDependencies`. If your build process (e.g., `vite build`) relies on dev tools, you MUST explicitly run `npm install --include=dev` in your update/build scripts.

- **Steam Workshop Compliance (创意工坊合规性)**:
    - **Zero-Broken Policy**: 为避免被 Steam 标记为失效组件，壁纸端 (`public/wallpaper`) 必须具备离线回退能力。
    - **Demo Mode**: 当无法连接到 Luvia 服务端或配置缺失时，前端自动切换至演示模式，使用 `assets/demo/` 下内置的高清素材进行循环展播。
    - **Visual Feedback**: 在演示模式下，UI 必须显式展示 `DEMO MODE` 标签，引导用户进行正确配置。

### WebUI 浮层层级表
- 统一工具栏全局层级固定为 `z-[35]`：高于媒体卡片交互层 `z-30`，低于移动侧栏与时间轴控件 `z-40`、图片查看器和普通模态框 `z-50`、系统进度层 `z-[60]`。
- 工具栏根使用 `relative isolate` 建立局部层叠上下文；内部关闭遮罩使用 `z-10`，可操作菜单面板使用 `z-20`。禁止通过高于 `z-50` 的魔法值解决媒体卡片遮挡，以免反向覆盖全屏查看器或模态框。
