<div align="center">
  <img src="mobile/assets/icon.png" width="120" height="120" style="border-radius: 24px" alt="Luvia Gallery Logo">
  <h1>Luvia Gallery</h1>
  <p><strong>优雅浏览已归档媒体的无侵入方案</strong></p>
  <p><i>Non-destructive, volume-mapped media browsing for existing archives.</i></p>
</div>

---

# 🇨🇳 中文说明 (Chinese)

Luvia Gallery 专为“已有归档媒体”的浏览场景而设计：它不搬动、不中断、也不上传您的原始文件，只通过 Docker 卷映射读取并索引现有目录，让家庭 NAS/移动硬盘/本地磁盘里的图片与视频以优雅的方式被浏览。

## 🌟 核心特性

- 🛡️ **不侵入存储**: 纯读取，零重命名、零移动、零上传；文件仍由原有备份/归档体系管理。
- 🔌 **卷映射即上库**: 通过 Docker 将 `/media` 指向现有媒体根目录，将 `/app/data`、`/app/cache` 挂载到持久卷即可完成索引与缩略图缓存。
- 🚀 **极速浏览**: 异步流式扫描 + 虚拟滚动网格，大型目录也能秒级打开与分页浏览。
- 📱 **跨端体验**: Web（Vite/React）+ 移动端（Expo/React Native）统一数据模型，收藏与配置跨端同步。
- 🔒 **安全访问**: JWT 保护的 API 与媒体流，可选本地存储令牌；无公网上传入口，降低泄露风险。
- 🧭 **非同步相册定位**: 聚焦“浏览既有海量媒体”，默认不提供上传/备份功能，避免破坏原有文件系统。

## 🏗️ 目录与卷挂载

- `/media`：指向您的原始媒体库（只读推荐）。
- `/app/data`：配置、索引与用户数据。
- `/app/cache`：缩略图与计算缓存。

示例（docker-compose）：
```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    ports:
      - "3000:3000"
    volumes:
      - /path/to/your/media:/media:ro
      - luvia-data:/app/data
      - luvia-cache:/app/cache
volumes:
  luvia-data:
  luvia-cache:
```

启动后，进入首次配置界面，添加媒体路径并开始索引即可。

## 🚀 本地启动（非 Docker）

```bash
npm install
npm start
```

移动端（可选）：
```bash
cd mobile
npm install
npx expo start
```

## 🛠️ 技术栈

- Backend: Node.js, Express, SQLite, FFmpeg, JWT
- Web: React 19, Vite, Tailwind CSS, Framer Motion
- Mobile: React Native (Expo), Reanimated, Lucide Icons

## 使用须知

- 本项目定位为“已归档媒体浏览器”，默认不开放上传；如需上传/同步，请自行在反向代理或旁路服务中实现并确保安全性。
- 为确保非侵入，建议对 `/media` 仅读挂载；对数据/缓存目录使用持久卷，避免容器重启后索引丢失。

---

# 🇺🇸 English Description

Luvia Gallery is a non-destructive media browser for large, already-archived libraries. It does not move, rename, or upload your files; it only scans what you mount via Docker volumes and serves a fast, elegant UI across web and mobile.

## 🌟 Highlights

- 🛡️ **Non-Destructive**: Read-only by default—no moves, renames, or uploads; your existing backup/archival layout stays intact.
- 🔌 **Volume-Mapped Ingestion**: Map `/media` to your library (preferably read-only) and `/app/data`, `/app/cache` to persistent volumes; scanning and thumbnails stay local.
- 🚀 **Fast Browsing**: Async streaming scanner plus virtualized grids keep large folders responsive.
- 📱 **Cross-Platform**: Shared data model for Vite/React web and Expo/React Native mobile; favorites and settings stay in sync.
- 🔒 **Secure by Design**: JWT-protected APIs and media streams; no built-in public upload endpoints, reducing exposure.
- 🧭 **Not a Sync Tool**: Purpose-built for browsing existing archives, not phone-photo backup.

## 🏗️ Volumes

- `/media`: your source library (recommend read-only)
- `/app/data`: config, index, users
- `/app/cache`: thumbnails/cache

Compose example:
```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    ports:
      - "3000:3000"
    volumes:
      - /path/to/your/media:/media:ro
      - luvia-data:/app/data
      - luvia-cache:/app/cache
volumes:
  luvia-data:
  luvia-cache:
```

## Local Run (non-Docker)

```bash
npm install
npm start
```

Mobile (optional):
```bash
cd mobile
npm install
npx expo start
```

## Notes

- No upload/sync built-in. If you add upload behind a proxy, secure it and keep `/media` backed up externally.
- Keep `/media` read-only to prevent accidental changes; persist `/app/data` and `/app/cache` for stable indexing.

---

## 📄 License | 协议

本项目基于 **Apache-2.0** 协议授权。详细信息请参阅 [LICENSE](LICENSE) 文件。

Licensed under the **Apache-2.0** License. See the [LICENSE](LICENSE) file for more details.
