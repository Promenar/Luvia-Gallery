<div align="center">
  <img src="mobile/assets/icon.png" width="120" height="120" style="border-radius: 24px" alt="Luvia Gallery Logo">
  <h1>Luvia Gallery</h1>
  <p><strong>优雅浏览已归档媒体的无侵入方案</strong></p>
  <p><i>Non-destructive media browsing for existing archives.</i></p>
</div>

---

# 🇨🇳 中文说明 (Chinese)

Luvia Gallery 专为"已有归档媒体"设计：它不搬动、不重命名、也不上传您的文件。只需通过 Docker 映射现有目录，即可在 Web 和移动端优雅地浏览 NAS 或本地硬盘中的海量图片、视频与音频。

## 🌟 核心特性

- 🛡️ **零侵入存储**: 纯读取模式，不对原始文件进行任何改动。
- 🔌 **即插即用**: 通过 Docker 卷映射 `/media` 即可入库，无需复杂的迁移过程。
- 🚀 **极速响应**: 异步流式扫描 + 虚拟滚动技术，支持万级文件秒级预览。
- 📱 **全端覆盖**: 统一的 Web (React) 与 移动端 (React Native) 体验。
- 🧭 **非同步工具**: 专注"浏览"而非"同步/备份"，不具备上传功能，确保文件系统纯净。
- 🔐 **用户认证**: 多用户支持，JWT 安全认证，用户级别路径访问控制。
- ⭐ **收藏功能**: 快速收藏文件和文件夹，支持收藏夹浏览。
- 🎵 **音频支持**: 支持 MP3、FLAC、WAV、AAC 等格式播放。
- 🖼️ **壁纸服务**: 为 Wallpaper Engine 提供动态壁纸 API。
- 🔄 **热更新**: 支持 Git 拉取自动重部署，无需重建镜像。
- 📂 **多库支持**: 支持多个媒体库路径，分号分隔配置。
- 🚀 **GPU 加速**: NVIDIA NVENC 视频转码加速。

## 🏗️ Docker 部署 (推荐)

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    container_name: luvia-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"  # 宿主机端口:容器端口
    volumes:
      # 媒体库：支持多个目录映射（建议只读）
      - /您的/真实/媒体目录:/media:ro
      # - /另一个/媒体目录:/mnt/ext:ro

      # 持久化配置和数据库
      - ./data:/app/data

      # 缩略图缓存
      - ./cache:/app/cache

      # SSH 密钥（可选，用于私有仓库热更新）
      # - ./ssh:/tmp/ssh_mount:ro
    environment:
      - NODE_ENV=production
      # 多媒体库路径（分号分隔）
      - MEDIA_ROOT=/media
      # 热更新 API 安全令牌（可选）
      # - UPDATE_TOKEN=your_secret_token
      # GPU 加速配置（NVIDIA）
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    # NVIDIA GPU 支持
    privileged: true
    runtime: nvidia
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

## 🛠️ 技术架构

- **后端**: Node.js / Express / SQLite (sql.js)
- **核心**: FFmpeg (视频转码与封面)
- **前端**: React / Vite / Tailwind CSS
- **移动**: React Native / Expo

## ⚠️ 使用须知

- 本项目定位为"媒体浏览器"，**不具备上传功能**。
- 建议将 `/media` 设为只读挂载 (`:ro`)。
- 请务必持久化挂载 `/app/data` 和 `/app/cache`。
- 首次访问会引导创建管理员账户。

---

# 🇺🇸 English Description

Luvia Gallery is a non-destructive media browser for pre-archived libraries. It doesn't move or modify your files; it simply scans and serves them via Docker volume mapping for a fast, elegant experience across devices.

## 🌟 Highlights

- 🛡️ **Non-Destructive**: Read-only core—no moves, renames, or modifications.
- 🔌 **Volume-First**: Map your library to `/media` and start browsing instantly.
- 🚀 **Performance**: Async scanning and virtualized grids for massive libraries.
- 📱 **Cross-Platform**: Seamless experience on both Web and Mobile.
- 🧭 **Library Focused**: Designed for browsing archives; no upload features to keep your filesystem clean.
- 🔐 **Authentication**: Multi-user support with JWT security and path-based access control.
- ⭐ **Favorites**: Quick bookmark for files and folders.
- 🎵 **Audio Support**: MP3, FLAC, WAV, AAC playback.
- 🖼️ **Wallpaper API**: Dynamic wallpaper service for Wallpaper Engine.
- 🔄 **Hot Update**: Git-based auto-redeployment without rebuilding images.
- 📂 **Multi-Library**: Multiple media paths supported via semicolon delimiter.
- 🚀 **GPU Acceleration**: NVIDIA NVENC video transcoding.

## 🏗️ Docker Compose

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    container_name: luvia-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"  # host:container
    volumes:
      # Media libraries (read-only recommended)
      - /your/media/path:/media:ro
      # - /another/media/path:/mnt/ext:ro

      # Persistent config and database
      - ./data:/app/data

      # Thumbnail cache
      - ./cache:/app/cache

      # SSH keys (optional, for private repo hot updates)
      # - ./ssh:/tmp/ssh_mount:ro
    environment:
      - NODE_ENV=production
      # Multi-library paths (semicolon-separated)
      - MEDIA_ROOT=/media
      # Hot update API token (optional)
      # - UPDATE_TOKEN=your_secret_token
      # GPU acceleration (NVIDIA)
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    # NVIDIA GPU support
    privileged: true
    runtime: nvidia
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

## 🛠️ Tech Stack

- **Backend**: Node.js / Express / SQLite (sql.js)
- **Processing**: FFmpeg
- **Frontend**: React / Vite / Tailwind CSS
- **Mobile**: React Native / Expo

---

## 📄 License | 协议

本项目基于 **Apache-2.0** 协议授权。

Licensed under the **Apache-2.0** License.
