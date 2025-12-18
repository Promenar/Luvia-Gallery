<div align="center">
  <img src="mobile/assets/icon.png" width="120" height="120" style="border-radius: 24px" alt="Lumina Gallery Logo">
  <h1>Lumina Gallery</h1>
  <p><strong>一个极速、极简且强大的全栈个人媒体库方案</strong></p>
  <p><i>A blazing fast, minimal, and powerful full-stack personal media gallery solution.</i></p>
</div>

---

# 🇨🇳 中文说明 (Chinese)

Lumina Gallery 是一个专为个人设计的私有云媒体管理系统。它集成了高性能的后端扫描引擎、响应式的 Web 前端以及基于 Expo 的移动端应用，旨在提供无缝的跨端媒体浏览体验。

## 🌟 核心特性

- ⚡ **高性能架构**: 后端基于 Node.js，采用异步流式扫描技术，秒级索引万级媒体文件。
- 📱 **全栈生态**: 包含服务端、Vite 驱动的 Web 端以及 React Native (Expo) 移动移动端。
- 🏗️ **统一数据流**: 前后端采用统一的数据模型，确保各端状态完全同步。
- 🖼️ **极致视觉**: 采用高性能虚拟滚动 (Virtual Gallery) 和动态栅格算法，大图预览零卡顿。
- 🔒 **安全先行**: 全接口通过 JWT 认证，支持媒体流身份校验，保护您的隐私。
- ⚙️ **灵活部署**: 支持 Docker 一键部署及数据/缓存持久化挂载。

## 🛠️ 技术栈

- **后端 (Backend)**: Node.js, Express, SQLite, JWT, FFmpeg
- **Web 前端**: React 19, Vite, Tailwind CSS, Framer Motion
- **移动端 (Mobile)**: React Native, Expo, Lucide Icons, Reanimated

## 🚀 快速开始

### 1. 环境准备
确保您的系统已安装 `Node.js` (>= 18) 和 `npm`。

### 2. 安装与运行
```bash
# 安装依赖
npm install

# 启动后端及 Web 服务
npm start
```

### 3. 移动端
进入 `mobile` 目录并启动 Expo:
```bash
cd mobile
npm install
npx expo start
```

---

# 🇺🇸 English Description

Lumina Gallery is a private cloud media management system designed for enthusiasts. It integrates a high-performance scanning engine, a responsive web interface, and an Expo-powered mobile app to provide a seamless cross-platform experience.

## 🌟 Key Features

- ⚡ **High-Performance Architecture**: Powered by Node.js with asynchronous streaming scanning for indexing thousands of files in seconds.
- 📱 **Full-Stack Ecosystem**: Includes Server, Vite-driven Web client, and React Native (Expo) mobile app.
- 🏗️ **Unified Data Stream**: Consistent data patterns across all layers for reliable state management.
- 🖼️ **Premium Visual Experience**: Utilizing high-performance Virtual Gallery and dynamic grid algorithms for smooth browsing.
- 🔒 **Security First**: JWT-protected API and authenticated media streams to ensure your privacy.
- ⚙️ **Flexible Deployment**: Ready for Docker deployment with support for persistent volumes (data/cache).

## 🛠️ Tech Stack

- **Backend**: Node.js, Express, SQLite, JWT, FFmpeg
- **Web Frontend**: React 19, Vite, Tailwind CSS, Framer Motion
- **Mobile**: React Native, Expo, Lucide Icons, Reanimated

---

## 📄 License | 协议

本项目基于 **Apache-2.0** 协议授权。详细信息请参阅 [LICENSE](LICENSE) 文件。

Licensed under the **Apache-2.0** License. See the [LICENSE](LICENSE) file for more details.
