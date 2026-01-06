<div align="center">
  <img src="mobile/assets/icon.png" width="120" height="120" style="border-radius: 24px" alt="Luvia Gallery Logo">
  <h1>Luvia Gallery</h1>
  <p><strong>优雅浏览已归档媒体的无侵入方案</strong></p>
  <p><i>Non-destructive media browsing for existing archives.</i></p>
</div>

---

# 🇨🇳 中文说明 (Chinese)

Luvia Gallery 专为“已有归档媒体”设计：它不搬动、不重命名、也不上传您的文件。只需通过 Docker 映射现有目录，即可在 Web 和移动端优雅地浏览 NAS 或本地硬盘中的海量图片与视频。

## 🌟 核心特性

- 🛡️ **零侵入存储**: 纯读取模式，不对原始文件进行任何改动。
- 🔌 **即插即用**: 通过 Docker 卷映射 `/media` 即可入库，无需复杂的迁移过程。
- 🚀 **极速响应**: 异步流式扫描 + 虚拟滚动技术，支持万级文件秒级预览。
- 📱 **全端覆盖**: 统一的 Web (React) 与 移动端 (React Native) 体验。
- 🧭 **非同步工具**: 专注“浏览”而非“同步/备份”，不具备上传功能，确保文件系统纯净。

## 🏗️ Docker 部署 (推荐)

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    ports:
      - "3000:3000"
    volumes:
      - /您的/真实/媒体目录:/media:ro
      - ./data:/app/data
      - ./cache:/app/cache
```

## 🛠️ 技术架构

- **后端**: Node.js / Express / SQLite
- **核心**: FFmpeg (视频转码与封面)
- **前端**: React / Vite / Tailwind
- **移动**: React Native / Expo

## ⚠️ 使用须知

- 本项目定位为“媒体浏览器”，**不具备上传功能**。
- 建议将 `/media` 设为只读挂载 (`:ro`)。
- 请务必持久化挂载 `/app/data` 和 `/app/cache`。

---

# 🇺🇸 English Description

Luvia Gallery is a non-destructive media browser for pre-archived libraries. It doesn't move or modify your files; it simply scans and serves them via Docker volume mapping for a fast, elegant experience across devices.

## 🌟 Highlights

- 🛡️ **Non-Destructive**: Read-only core—no moves, renames, or modifications.
- 🔌 **Volume-First**: Map your library to `/media` and start browsing instantly.
- 🚀 **Performance**: Async scanning and virtualized grids for massive libraries.
- 📱 **Cross-Platform**: Seamless experience on both Web and Mobile.
- 🧭 **Library Focused**: Designed for browsing archives; no upload features to keep your filesystem clean.

## 🏗️ Docker Compose

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    ports:
      - "3000:3000"
    volumes:
      - /your/media/path:/media:ro
      - ./data:/app/data
      - ./cache:/app/cache
```

## 🛠️ Tech Stack

- **Backend**: Node.js / SQLite
- **Processing**: FFmpeg
- **Frontend**: React / Vite
- **Mobile**: React Native / Expo

---

## 📄 License | 协议

本项目基于 **Apache-2.0** 协议授权。

Licensed under the **Apache-2.0** License.
