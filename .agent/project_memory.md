## Core Technical Decisions
- **Unified Data Loading**: Managed via a single `useEffect` in `App.tsx` observing `activeTab` and `currentPath`. Eliminates duplicate fetch and stale views.
- **并发数据同步**：在 `Database.ts` 中实现全局写入队列。所有涉及事务的操作必须进入该队列排队执行，严禁在 Native 回调内直接触发可能导致嵌套事务的异步更新。
- **图片加载稳定性**：针对 `expo-image`，在频繁切换或背景层渲染时，优先移除原生 `transition` 属性，转而使用 `react-native-reanimated` 控制容器透明度。这能有效规避 Native 层的声明周期冲突（`IllegalStateException`）。
- **组件持久化导航**：在文件夹浏览等需要数据感知但视觉连贯的场景中，避免在容器视图上绑定基于路径的 `key`，通过状态驱动内容更新以消除闪烁。
- **SQLite Concurrency**: `initDatabase` uses a singleton Promise pattern to prevent race conditions during early-stage multi-component initialization.
- **Grid Layout**: Precision pixel-based calculations for standard 8px gaps.
    - **Standard sizes**: Media items ~110px, Folder items ~160px. Use `useWindowDimensions` for responsiveness.

## Anti-Patterns to Avoid
- **Implicit Undefined in SQL**: Never pass `undefined` to `expo-sqlite` Native calls; sanitize with `?? null`.
- **Layout Collapsing**:
    - Avoid `return null` in major UI sections (Carousel/Grid) during loading; always provide skeleton/placeholder view.
    - Fix `VirtualGallery` zero-height bugs by using `absolute inset-0` on container wrappers.
- **Image Ghosting & Blur**: Never use `blur-xl` or high GPU-cost blurs in recurring list items (especially `FolderCard`); this causes "gray ghosting" during transitions.
- **Authenticated Media**: Direct `<img>` or `<Image>` tags will fail if `?token=<jwt>` is not appended to the URL query parameters.

## Development Workflows
- **Performance**: Heavy UI components (VirtualGallery, ImageViewer) must be loaded using `React.lazy`.
- **Docs Path**: Reference `docs/antigravity/` for detailed maintenance logs.
