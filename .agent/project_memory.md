## Core Technical Decisions
- **Unified Data Loading**: Managed via a single `useEffect` in `App.tsx` observing `activeTab` and `currentPath`. Eliminates duplicate fetch and stale views.
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
