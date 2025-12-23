## Core Technical Decisions
- **Unified Data Loading**: Managed via a single `useEffect` in `App.tsx` observing `activeTab` and `currentPath`. Eliminates duplicate fetch and stale views.
- **并发数据同步**：在 `Database.ts` 中实现全局写入队列。所有涉及事务的操作必须进入该队列排队执行，严禁在 Native 回调内直接触发可能导致嵌套事务的异步更新。
- **图片加载稳定性**：针对 `expo-image`，在频繁切换或背景层渲染时，优先移除原生 `transition` 属性，转而使用 `react-native-reanimated` 控制容器透明度。这能有效规避 Native 层的声明周期冲突（`IllegalStateException`）。
- **组件持久化导航**：在文件夹浏览等需要数据感知但视觉连贯的场景中，避免在容器视图上绑定基于路径的 `key`，通过状态驱动内容更新以消除闪烁。
- **SQLite Concurrency**: `initDatabase` uses a singleton Promise pattern to prevent race conditions during early-stage multi-component initialization. Added `updateFavoriteStatus` for optimistic local sync before server confirmation.
- **Modal Stability**: Hoist complex dialogs (e.g., `ConfirmDialogComponent`) to the top level of the screen component. This prevents recreation on every render, resolving UI flicker and animation glitches.
- **Grid Layout**: Precision pixel-based calculations for standard 8px gaps.
    - **Standard sizes**: Media items ~110px, Folder items ~160px. Use `useWindowDimensions` for responsiveness.
- **Elite UI & Interaction Standards** (Updated 2025-12-19):
    - **Haptic Lock**: High-frequency updates (e.g., download progress) MUST use a `useRef` based lock to filtering vibrations. Only crucial state changes trigger haptics.
    - **Portal First**: All global overlays (Toasts, Dialogs) MUST use `Portal` to bypass z-index stacking context completely.
    - **Theme Namespace**: The global theme hook is strictly renamed to `useAppTheme` to avoid conflict with `react-native-paper`'s `useTheme`.
    - **Zero-Blank Strategy**: Critical implementations like Home Carousel MUST implement a cache-first strategy (load Database -> Display -> Background Fetch -> Update).
    - **Anti-Jitter**: Dynamic text (percentages) in notifications must be wrapped in fixed-width containers to preserve layout stability.
    - **Permission Consistency**: In `server.js`, always check for both `user.isAdmin` (direct object property) and `user.role === 'admin'` (from JWT payload) to ensure consistent access control across all middleware and helpers (e.g., `checkFileAccess`).
    - **Scanner State Sync**: When starting background tasks (like `processScan`), the `status` flag must be updated * synchronously* before returning the HTTP response. This prevents race conditions where the frontend's first status poll hits an `idle` state before the async task has technically started.
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

