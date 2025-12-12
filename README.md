<div align="center">
  <img src="/public/icon.png" width="128" height="128" alt="Lumina Gallery Logo" />
  <h1>Lumina Gallery</h1>
  <p>
    <strong>A modern, high-performance, self-hosted media gallery server.</strong><br>
    <strong>现代、高性能的自托管媒体画廊服务器。</strong>
  </p>

  <p>
    <a href="#english">English</a> • <a href="#chinese">中文</a>
  </p>

  <img src="https://img.shields.io/docker/pulls/promenarleng/lumina-gallery?style=flat-square" alt="Docker Pulls">
  <img src="https://img.shields.io/github/license/NarcisWL/Lumina-Gallery?style=flat-square" alt="License">
</div>

---

<a name="english"></a>
## ✨ Features

Lumina Gallery is designed to browse massive local media libraries with ease and elegance.

- **🚀 High Performance**: Built with `Virtualization` technology to handle thousands of photos and videos with buttery smooth scrolling.
- **📁 Folder-First Design**: Respects your existing file structure. Browse by directories or timeline.
- **🎨 Beautiful UI**: Support for **Masonry**, **Grid**, and **Timeline** layouts with a polished dark/light mode adaptable interface.
- **⚡ Hardware Acceleration**: Native FFmpeg support with **NVIDIA CUDA** and **Intel VAAPI** integration for lightning-fast thumbnail generation and video transcoding.
- **🔄 Smart Sync**: active file monitoring and intelligent scanning ensure your gallery is always in sync with your disk.
- **👥 Multi-User**: Create multiple user accounts, manage favorites, and customize viewing preferences independently.
- **🐳 Docker Ready**: One-command deployment for any comprehensive homelab setup.

## 🛠️ Quick Start (Docker)

The easiest way to run Lumina Gallery is via Docker Compose.

### 1. Create `docker-compose.yml`

```yaml
version: '3.8'
services:
  lumina-gallery:
    image: promenarleng/lumina-gallery:latest
    container_name: lumina-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"
    volumes:
      # Your media files
      - /path/to/your/media:/media
      # Database and config storage
      - ./data:/app/data
      # Thumbnail cache
      - ./cache:/app/cache
    environment:
      - MEDIA_ROOT=/media
      # Optional: Enable NVIDIA GPU Support
      # - NVIDIA_VISIBLE_DEVICES=all
      # - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    # Optional: Hardware resource reservation
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
```

### 2. Run the Service

```bash
docker-compose up -d
```

Visit `http://localhost:3000` to start. The first user created will be the **Administrator**.

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `MEDIA_ROOT` | Path inside container where media is mounted | `/media` |
| `PORT` | Internal application port | `3001` |
| `NVIDIA_VISIBLE_DEVICES` | For GPU Passthrough | `all` |

## 🏗️ Development

To build and run locally:

1. Clone the repository.
2. Install dependencies: `npm install`.
3. Start the dev server: `npm run dev`.
4. Run the backend: `node server.js`.

---

<a name="chinese"></a>
## ✨ 功能特性

Lumina Gallery 是一款专为浏览海量本地媒体库而设计的现代化画廊应用。

- **🚀 极致性能**：采用虚拟滚动（Virtualization）技术，即使面对数万张照片和视频也能保持丝般顺滑的浏览体验。
- **📁 目录优先**：完全尊重您现有的文件整理习惯。支持按文件夹浏览，也支持时间轴视图。
- **🎨 精美界面**：提供 **瀑布流 (Masonry)**、**网格 (Grid)** 和 **时间轴 (Timeline)** 多种布局，适配深色/浅色模式，视觉体验一流。
- **⚡ 硬件加速**：深度集成 FFmpeg，支持 **NVIDIA CUDA** 和 **Intel VAAPI** 硬件加速，缩略图生成与视频转码速度飞快。
- **🔄 智能同步**：支持文件变动监听与智能扫描，确保画廊内容与磁盘文件实时保持一致，不留“幽灵文件”。
- **👥 多用户支持**：支持创建多用户，独立管理收藏夹与浏览偏好。
- **🐳 Docker 部署**：开箱即用，仅仅需要一个 Compose 文件即可部署到您的 NAS 或服务器。

## 🛠️ 快速开始 (Docker)

推荐使用 Docker Compose 进行部署。

### 1. 创建 `docker-compose.yml`

```yaml
version: '3.8'
services:
  lumina-gallery:
    image: promenarleng/lumina-gallery:latest
    container_name: lumina-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"
    volumes:
      # 映射您的媒体文件目录
      - /path/to/your/media:/media
      # 数据与配置持久化
      - ./data:/app/data
      # 缩略图缓存
      - ./cache:/app/cache
    environment:
      - MEDIA_ROOT=/media
      # 可选：开启 NVIDIA GPU 支持
      # - NVIDIA_VISIBLE_DEVICES=all
      # - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    # 可选：硬件资源预留（根据 Docker 版本选择）
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: all
    #           capabilities: [gpu]
```

### 2. 启动服务

```bash
docker-compose up -d
```

访问 `http://localhost:3000` 即可使用。首次注册的用户将自动成为**管理员**。

## ⚙️ 配置说明

| 环境变量 | 说明 | 默认值 |
|----------|-------------|---------|
| `MEDIA_ROOT` | 容器内媒体文件的挂载路径 | `/media` |
| `PORT` | 应用内部监听端口 | `3001` |
| `NVIDIA_VISIBLE_DEVICES` | GPU 直通配置 | `all` |

## 🏗️ 本地开发

如果您想参与开发：

1. 克隆本项目。
2. 安装依赖：`npm install`。
3. 启动前端开发服务器：`npm run dev`。
4. 启动后端服务：`node server.js`。

---
<div align="center">
  <p>Made with ❤️ by NarcisWL</p>
</div>
