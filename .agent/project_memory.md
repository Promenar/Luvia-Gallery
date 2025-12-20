## Core Technical Decisions
- **Unified Data Loading**: Managed via a single `useEffect` in `App.tsx` observing `activeTab` and `currentPath`. Eliminates duplicate fetch and stale views.
- **并发数据同步**：在 `Database.ts` 中实现全局写入队列。所有涉及事务的操作必须进入该队列排队执行，严禁在 Native 回调内直接触发可能导致嵌套事务的异步更新。
- **图片加载稳定性**：针对 `expo-image`，在频繁切换或背景层渲染时，优先移除原生 `transition` 属性，转而使用 `react-native-reanimated` 控制容器透明度。这能有效规避 Native 层的声明周期冲突（`IllegalStateException`）。
- **组件持久化导航**：在文件夹浏览等需要数据感知但视觉连贯的场景中，避免在容器视图上绑定基于路径的 `key`，通过状态驱动内容更新以消除闪烁。
- **SQLite Concurrency**: `initDatabase` uses a singleton Promise pattern to prevent race conditions during early-stage multi-component initialization.
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

## Anti-Patterns to Avoid
- **Raw DB Access**: Never access `database.db` directly in `server.js`. It is private. Always use or create public helper methods (e.g., `getStats()`) in `database.js`.
- **Implicit Undefined in SQL**: Never pass `undefined` to `expo-sqlite` Native calls; sanitize with `?? null`.
- **Layout Collapsing**:
    - Avoid `return null` in major UI sections (Carousel/Grid) during loading; always provide skeleton/placeholder view.
    - Fix `VirtualGallery` zero-height bugs by using `absolute inset-0` on container wrappers.
- **Image Ghosting & Blur**: Never use `blur-xl` or high GPU-cost blurs in recurring list items (especially `FolderCard`); this causes "gray ghosting" during transitions.
- **Authenticated Media**: Direct `<img>` or `<Image>` tags will fail if `?token=<jwt>` is not appended to the URL query parameters.
- **Animation Overload**: Avoid bouncy/spring animations for system-level dialogs; prefer subtle Fade+Scale for a premium, non-distracting feel.

## Development Workflows
- **Performance**: Heavy UI components (VirtualGallery, ImageViewer) must be loaded using `React.lazy`.
- **Docs Path**: Reference `docs/antigravity/` for detailed maintenance logs.
