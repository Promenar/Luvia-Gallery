# Lumina Gallery

[English](#english) | [中文](#chinese)

---

## <span id="english">English</span>

### Overview

**Lumina Gallery** is a modern, self-hosted photo and video gallery application designed for organizing and managing personal media libraries. It combines a responsive web interface with powerful backend capabilities, supporting both **Client Mode** (browser-based) and **Server Mode** (NAS/backend integration).

Whether you're managing family photos, archival collections, or large media libraries on a NAS, Lumina Gallery provides an elegant, feature-rich solution.

### Key Features

✨ **Smart Organization**
- Browse photos and videos in multiple layouts: Grid, Waterfall Masonry, and Folder Tree view
- Automatic folder hierarchy and media detection
- Advanced filtering by media type (photos, videos)
- Sort by date, name, or file size

📸 **Rich Media Support**
- Full support for images (JPEG, PNG, WebP, etc.)
- Video playback with built-in player
- Audio file support
- EXIF data extraction and display
- Automatic thumbnail generation with caching

🎨 **Beautiful UI**
- Dark/Light theme toggle
- Responsive design (mobile, tablet, desktop)
- Smooth animations with Framer Motion
- Optimized performance with React Window virtualization
- Full keyboard navigation support

🔐 **Multi-User Support**
- User authentication with password protection
- Per-user media libraries and configurations
- Admin panel for user management

📊 **Advanced Scanning**
- Real-time folder scanning with progress tracking
- Pausable/resumable library scans
- Configurable scan paths (single or multiple roots)
- Efficient caching system for thumbnails

🎯 **Dual Operation Modes**
- **Client Mode**: All data stored locally in browser (LocalStorage)
- **Server Mode**: Connected to backend API for persistent file access on NAS/servers

### Technology Stack

**Frontend**
- React 19 with TypeScript
- Tailwind CSS for styling
- Framer Motion for animations
- Lucide React for icons
- React Window for virtualization (performance optimization)
- React Virtualized Auto-Sizer for responsive layouts

**Backend**
- Node.js with Express.js
- Sharp for image processing and thumbnail generation
- EXIF.js for metadata extraction
- CORS support for cross-origin requests
- Multi-user configuration management

**Deployment**
- Docker & Docker Compose
- Multi-stage builds for optimized images
- Environment-based configuration
- Volume-mapped media paths

**Build Tools**
- Create React App for development and production builds
- Vite for fast development (optional)
- TypeScript for type safety

### Quick Start

#### Option 1: Docker Deployment (Recommended)

```bash
# Clone the repository
git clone https://github.com/NarcisWL/Lumina-Gallery.git
cd Lumina-Gallery

# Deploy with Docker Compose
docker-compose pull
docker-compose up -d
```

Visit `http://localhost:3000` in your browser.

#### Option 2: Local Development

```bash
# Install dependencies
npm install

# Start development server
npm start
```

The app will open at `http://localhost:3000`.

#### Option 3: Production Build

```bash
# Install dependencies
npm install

# Build for production
npm run build

# Start server
npm run serve
```

### Configuration Guide

#### Adding Media Paths (Server Mode)

1. Open Settings in the app
2. Select **Server Mode** connection
3. Add library scan paths (e.g., `/media`, `/photos`, `/videos`)
4. Click **"Scan NAS Library"** to start scanning

#### Volume Mapping (Docker)

Edit `docker-compose.yml` to map your media folders:

```yaml
services:
   lumina-gallery:
      volumes:
         # Map single media root
         - ./media_test:/media
      
         # OR map multiple roots
         - /volume1/photos:/photos
         - /volume1/videos:/videos
      
         # Persistence for configuration
         - ./data:/app/data
      
         # Cache for thumbnails
         - ./cache:/app/cache
```

#### Environment Variables

```env
# Port the application listens on
PORT=3000

# Node environment
NODE_ENV=production

# Default media root (fallback)
MEDIA_ROOT=/media
```

### User Management

**First Run Setup**
1. Create an admin account with username and password
2. Log in with admin credentials
3. Access Settings to manage additional users

**Adding Users (Admin Only)**
1. Navigate to Settings → Users
2. Click "Manage Users"
3. Enter new username and password
4. User can log in immediately

### Deployment Instructions

#### Docker (Recommended)

```bash
# Build image locally
docker build -t promenarleng/luminapronar:latest .

# Push to Docker Hub (optional)
docker push promenarleng/luminapronar:latest

# Run with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f lumina-gallery
```

#### NAS Deployment (Synology, QNAP, etc.)

1. Use Docker app to pull `promenarleng/luminapronar:latest`
2. Create a new container with volume mappings to your media folders
3. Set port to 3000 (or your preferred port)
4. Enable auto-restart
5. Access via `http://<nas-ip>:3000`

#### Kubernetes (Advanced)

See `kubernetes/` directory for sample manifests (if provided).

### Troubleshooting

**Issue: Blank Screen After Login**
- Check browser DevTools (F12) Console for errors
- Ensure build assets exist: `build/static/js/main.*.js`
- Verify `/index.html` does not contain module import directives

**Issue: No Photos Appear**
- Verify media path configuration in Settings
- Check folder permissions on NAS/server
- Run "Scan NAS Library" to re-index media

**Issue: Slow Performance with Large Libraries**
- Ensure `cache/` directory exists and is writable
- Increase Docker memory limit
- Use SSD for cache storage if possible

### Performance Tips

- Enable thumbnail caching (`./cache` volume)
- Use SSD storage for cache and database
- Limit concurrent scans on large libraries
- Use waterfall masonry view for image-heavy galleries

### Browser Support

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### License

MIT License - See LICENSE file for details

### Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

### Support

For issues, questions, or suggestions:
- Open an issue on GitHub
- Check existing documentation

---

## <span id="chinese">中文</span>

### 项目简介

**Lumina Gallery** 是一款现代化的自托管相册应用，专为组织和管理个人媒体库而设计。它提供了响应式的网页界面和强大的后端功能，支持 **客户端模式**（基于浏览器）和 **服务器模式**（NAS/后端集成）两种运行方式。

无论您是在管理家庭相册、档案收藏，还是在 NAS 上维护大型媒体库，Lumina Gallery 都能提供优雅而功能丰富的解决方案。

### 核心功能

✨ **智能组织**
- 多种浏览模式：网格、瀑布流砌体、文件夹树视图
- 自动识别文件夹层级和媒体类型
- 按媒体类型高级筛选（照片、视频）
- 按日期、名称或文件大小排序

📸 **丰富的媒体支持**
- 完整图像格式支持（JPEG、PNG、WebP 等）
- 内置视频播放器
- 音频文件支持
- EXIF 数据提取与显示
- 自动缩略图生成和缓存

🎨 **美观的界面**
- 深色/浅色主题切换
- 响应式设计（手机、平板、桌面）
- 使用 Framer Motion 的流畅动画
- 基于 React Window 的虚拟化优化
- 完整的键盘导航支持

🔐 **多用户支持**
- 密码认证的用户登录系统
- 每个用户独立的媒体库和配置
- 管理员面板用于用户管理

📊 **高级扫描功能**
- 实时文件夹扫描和进度跟踪
- 可暂停/恢复的库扫描
- 可配置的扫描路径（单个或多个根目录）
- 高效的缩略图缓存系统

🎯 **双运行模式**
- **客户端模式**：所有数据存储在浏览器本地（LocalStorage）
- **服务器模式**：连接到后端 API，持久化访问 NAS/服务器上的文件

### 技术栈

**前端**
- React 19 + TypeScript
- Tailwind CSS 样式框架
- Framer Motion 动画库
- Lucide React 图标库
- React Window 虚拟化（性能优化）
- React Virtualized Auto-Sizer 响应式布局

**后端**
- Node.js + Express.js
- Sharp 图像处理和缩略图生成
- EXIF.js 元数据提取
- CORS 跨域支持
- 多用户配置管理

**部署**
- Docker & Docker Compose
- 多阶段构建优化镜像
- 环境变量配置
- 卷挂载媒体路径

**构建工具**
- Create React App (CRA) 开发和生产构建
- Vite 快速开发模式（可选）
- TypeScript 类型安全

### 快速开始

#### 方案 1：Docker 部署（推荐）

```bash
# 克隆仓库
git clone https://github.com/NarcisWL/Lumina-Gallery.git
cd Lumina-Gallery

# 使用 Docker Compose 部署
docker-compose pull
docker-compose up -d
```

访问浏览器：`http://localhost:3000`

#### 方案 2：本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm start
```

应用将在 `http://localhost:3000` 打开。

#### 方案 3：生产构建

```bash
# 安装依赖
npm install

# 生产构建
npm run build

# 启动服务器
npm run serve
```

### 配置指南

#### 添加媒体路径（服务器模式）

1. 打开应用设置
2. 选择 **服务器模式** 连接
3. 添加库扫描路径（例如 `/media`、`/photos`、`/videos`）
4. 点击 **"扫描 NAS 库"** 开始扫描

#### 卷挂载（Docker）

编辑 `docker-compose.yml` 映射媒体文件夹：

```yaml
services:
   lumina-gallery:
      volumes:
         # 单一媒体根目录映射
         - ./media_test:/media
      
         # 或映射多个根目录
         - /volume1/photos:/photos
         - /volume1/videos:/videos
      
         # 配置文件持久化
         - ./data:/app/data
      
         # 缩略图缓存
         - ./cache:/app/cache
```

#### 环境变量

```env
# 应用监听端口
PORT=3000

# Node 环境
NODE_ENV=production

# 默认媒体根目录（备用）
MEDIA_ROOT=/media
```

### 用户管理

**首次运行设置**
1. 创建管理员账户（输入用户名和密码）
2. 使用管理员凭证登录
3. 进入设置管理其他用户

**添加用户（仅管理员）**
1. 导航至设置 → 用户
2. 点击 "管理用户"
3. 输入新的用户名和密码
4. 用户可立即登录

### 部署指南

#### Docker 部署（推荐）

```bash
# 本地构建镜像
docker build -t promenarleng/luminapronar:latest .

# 推送到 Docker Hub（可选）
docker push promenarleng/luminapronar:latest

# 使用 Docker Compose 运行
docker-compose up -d

# 查看日志
docker-compose logs -f lumina-gallery
```

#### NAS 部署（群晖、QNAP 等）

1. 在 Docker 应用中拉取 `promenarleng/luminapronar:latest`
2. 创建新容器并挂载媒体文件夹卷
3. 设置端口为 3000（或你的首选端口）
4. 启用自动重启
5. 访问 `http://<nas-ip>:3000`

#### Kubernetes（高级）

参见 `kubernetes/` 目录的示例清单（如果提供）。

### 故障排除

**问题：登录后显示空白屏幕**
- 检查浏览器开发工具（F12）控制台是否有错误
- 确保编译资源存在：`build/static/js/main.*.js`
- 验证 `/index.html` 不包含模块导入指令

**问题：照片无法显示**
- 验证设置中的媒体路径配置
- 检查 NAS/服务器的文件夹权限
- 运行 "扫描 NAS 库" 重新索引媒体

**问题：大型库处理缓慢**
- 确保 `cache/` 目录存在且可写
- 增加 Docker 内存限制
- 如果可能，为缓存使用 SSD

### 性能优化建议

- 启用缩略图缓存（`./cache` 卷）
- 使用 SSD 存储缓存和数据库
- 大型库上限制并发扫描
- 图像库使用瀑布流视图

### 浏览器支持

- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### 许可证

MIT License - 详见 LICENSE 文件

### 贡献

欢迎贡献！请：
1. Fork 本仓库
2. 创建特性分支
3. 提交拉取请求

### 支持

如有问题、疑问或建议：
- 在 GitHub 上提交 Issue
- 查阅现有文档

---

**Lumina Gallery** — 让您的回忆闪耀光彩 ✨
