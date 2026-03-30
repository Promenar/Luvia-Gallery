# Luvia Gallery Widget

macOS 桌面小组件，展示 Luvia Gallery 图库中的照片。

## 功能特性

- **三种尺寸**: Small（单图）、Medium（2x2 网格）、Large（3x3 网格）
- **多种模式**: 随机照片、收藏夹、指定文件夹
- **自动刷新**: 可配置刷新间隔（15分钟/30分钟/1小时）
- **离线缓存**: 自动缓存缩略图，离线时显示缓存图片
- **配置界面**: 主应用提供可视化配置界面

## 系统要求

- macOS 14.0+
- Xcode 15.0+
- Apple Developer 账号（用于 App Groups）

## 快速开始

### 1. 打开项目

```bash
cd /Users/promenar/Codex/Luvia-Gallery/macos-widget/LuviaGalleryWidget
open LuviaGalleryWidget.xcodeproj
```

### 2. 配置 App Groups

1. 在 Xcode 中选择 **LuviaGalleryWidget** Target
2. **Signing & Capabilities → + Capability → App Groups**
3. 添加: `group.com.luvia.gallery`
4. 同样为 **GalleryWidgetExtension** Target 添加相同的 App Group

### 3. 编译运行

1. 选择 **LuviaGalleryWidget** scheme
2. 点击 Run (⌘R) 启动主应用
3. 在应用中输入服务器地址和 Token
4. 点击保存配置

### 4. 添加 Widget

1. 右键点击桌面 → **Edit Widgets**
2. 搜索 **Luvia Gallery**
3. 选择尺寸并添加到桌面

## 文件结构

```
LuviaGalleryWidget/
├── LuviaGalleryWidget.xcodeproj/    # Xcode 项目
├── LuviaGalleryWidget/              # 主应用
│   ├── ContentView.swift            # 配置界面
│   ├── Models/                      # 数据模型（共享）
│   └── Services/                    # 服务层（共享）
└── GalleryWidget/                   # Widget Extension
    ├── GalleryWidget.swift          # Widget 入口
    ├── AppIntent.swift              # AppIntents 配置
    ├── Models/                      # 数据模型
    ├── Services/                    # 服务层
    ├── Providers/                   # TimelineProvider
    └── Views/                       # UI 视图
```

## 获取 Token

1. 启动 Luvia Server
2. 在 Web 设置面板找到 **Wallpaper Token** 区域
3. 点击 **Generate Token** 生成 JWT Token
4. 复制 Token 到 Widget 配置界面

## API 依赖

Widget 使用以下后端 API：

| API | 用途 |
|-----|------|
| `GET /api/scan/results` | 获取图片列表 |
| `GET /api/thumb/:id` | 获取缩略图 |
| `GET /api/auth/wallpaper-token` | JWT Token 管理 |

## 许可证

Apache-2.0
