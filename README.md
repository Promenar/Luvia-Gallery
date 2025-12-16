<div align="center">
  <img src="public/icon.png" width="128" height="128" alt="Logo" />
  <h1>小姐姐之家简易图库</h1>
  <h3>Lumina Gallery</h3>
  <p>
    <strong>一个高性能、高颜值、专为您珍藏的“小姐姐”们打造的自托管媒体画廊。</strong><br>
    <strong>A high-performance, aesthetic, self-hosted media gallery for your precious collection.</strong>
  </p>

  <p>
    <a href="#chinese">中文</a> • <a href="#english">English</a>
  </p>

  <img src="https://img.shields.io/docker/pulls/promenarleng/lumina-gallery?style=flat-square" alt="Docker Pulls">
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat-square" alt="License">
</div>

---

<a name="chinese"></a>
## 🌟 项目简介

欢迎来到 **Lumina Gallery**。
这是一个为松鼠党们量身定制的本地媒体库管理系统。无论你是想管理设计素材、摄影作品，还是珍藏的“小姐姐”视频与写真，它都能提供极致流畅、赏心悦目的浏览体验。

我们拒绝臃肿，拒绝复杂的数据库导入。**所见即所得**，它直接读取你的文件夹结构，搭配极速的虚拟滚动技术，让你的海量收藏触手可及。

## ✨ 核心功能

- **🚀 极致性能**：基于虚拟滚动技术（Virtualization），单页加载数万张图片/视频也能丝滑流畅，告别卡顿。
- **📱 PWA 与移动端优化**：支持添加到手机主屏幕，像原生 App 一样使用。首屏强制沉浸式暗黑模式，带来影院级视觉享受。
- **🎨 绝美 UI 设计**：
  - **沉浸式轮播**：首页支持全屏视频背景，氛围感拉满。
  - **多视图切换**：内置 **瀑布流 (Masonry)**、**网格 (Grid)**、**时间轴 (Timeline)** 三种视图，满足不同浏览习惯。
  - **动态主题**：支持日间/夜间模式自动切换，细节打磨到位。
- **⚡ 硬件加速转码**：后端集成 FFmpeg，支持 **NVIDIA CUDA** 和 **Intel VAAPI** 硬解，生成缩略图和预览视频快如闪电。
- **📂文件即真理**：基于文件系统的目录结构，不搞私有数据库绑定。你的文件在哪里，画廊就展示什么。
- **🔐 多用户与隐私**：支持多用户系统，每个人都有独立的收藏夹和偏好设置。
- **🐳 Docker 一键部署**：无需复杂环境配置，一行命令即可启动。

## 🛠️ 技术栈

- **前端**: React 19, Vite, TailwindCSS, Framer Motion
- **后端**: Node.js, Express, SQLite (sql.js)
- **核心组件**: FFmpeg (转码), Exifr (元数据), React-Window (虚拟化)

## 🚀 部署指南 (Docker)

最简单的方式是使用 Docker Compose。

### 1. 创建 `docker-compose.yml`

```yaml
version: '3.8'
services:
  lumina-gallery:
    image: promenarleng/lumina-gallery:latest
    container_name: lumina-gallery
    restart: unless-stopped
    ports:
      - "3000:3001" # 主机端口 : 容器端口
    volumes:
      - /your/local/media/folder:/media  # <--- 修改这里为你存放“小姐姐”们的目录
      - ./data:/app/data                # 数据库和配置
      - ./cache:/app/cache              # 缩略图缓存目录
    environment:
      - MEDIA_ROOT=/media
      # 权限设置 (建议设置，防止文件权限问题)
      # - PUID=1000
      # - PGID=1000
      # 显卡加速 (可选，需要安装 NVIDIA Container Toolkit)
      # - NVIDIA_VISIBLE_DEVICES=all
      # - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
```

### 2. 启动服务
```bash
docker-compose up -d
```
在浏览器访问 `http://localhost:3000`。你注册的第一个账号将自动获得**管理员**权限。

---

<a name="english"></a>
## 🌟 Introduction

Welcome to **Lumina Gallery** . This project was born out of a need for a lightweight, fast, and beautiful way to browse large local collections of images and videos. Whether you are organizing your design assets, photography portfolio, or your curated collection of "小姐姐" (Miss Sisters), Lumina provides a seamless experience.

## ✨ Features

- **🚀 Extreme Performance**: Powered by `react-window` and virtualization technology, handling folders with tens of thousands of files without breaking a sweat.
- **📱 PWA & Mobile First**: Installable as a native app on your phone. Features immersive **Force Dark Mode** on the home screen and native-like gestures.
- **🎨 Stunning UI**:
  - **Immersive Carousel**: Full-screen video backgrounds with a cinematic feel.
  - **Multiple Layouts**: Switch between **Masonry**, **Grid**, and **Timeline** views instantly.
  - **Adaptive Theme**: Automatic dark/light mode with a special immersive mode for the home screen.
- **⚡ Hardware Acceleration**: Built-in `FFmpeg` support with **NVIDIA CUDA** and **Intel VAAPI** integration for blazing fast video transcoding and thumbnail generation.
- **📂 Folder-Centric**: Respects your file system. No proprietary databases hiding your files. What you see on disk is what you get in the gallery.
- **🔐 Secure & Multi-User**: Role-based access control with isolated favorites and settings for each user.
- **🐳 Docker Native**: Deploy in seconds with a single compose file.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, TailwindCSS, Framer Motion, Lucide React
- **Backend**: Node.js, Express, SQLite (via sql.js for portability)
- **Media Processing**: FFmpeg (with hardware accel support), Exifr

## 🚀 Deployment Guide (Docker)

The recommended way to run Lumina Gallery is via Docker Compose.

### 1. `docker-compose.yml`

```yaml
version: '3.8'
services:
  lumina-gallery:
    image: promenarleng/lumina-gallery:latest
    container_name: lumina-gallery
    restart: unless-stopped
    ports:
      - "3000:3001" # Host Port : Container Port
    volumes:
      - /path/to/your/media:/media   # <--- CHANGE THIS to your media folder
      - ./data:/app/data            # Config and Database
      - ./cache:/app/cache          # Thumbnails
    environment:
      - MEDIA_ROOT=/media
      # Identify your User ID (optional, fixes permission issues)
      # - PUID=1000
      # - PGID=1000
      # Enable GPU Support (Optional)
      # - NVIDIA_VISIBLE_DEVICES=all
      # - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
```

### 2. Start the Server
```bash
docker-compose up -d
```
Visit `http://localhost:3000`. The first account you create will automatically become the **Administrator**.

---

<div align="center">
  <p>Made with ❤️ by Vibe Coding & NarcisWL</p>
</div>

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.
