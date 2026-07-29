# Luvia Gallery Widget

macOS 悬浮窗相册轮播 App：以圆角浮窗形式在桌面轮播展示 Luvia Gallery 图库中的照片与视频封面。

> 说明：项目早期的 WidgetKit 桌面小组件路线（GalleryWidgetExtension）已废弃并移除，
> 当前仅保留悬浮窗 App 本体。

## 功能特性

- **悬浮窗轮播**: 圆角浮窗自动轮播，数量/间隔/方向可调
- **多种来源**: 在线（Luvia Gallery 服务器）或本地目录
- **在线目录浏览**: 文件夹模式自动读取当前 Token 可访问的目录层级，逐层浏览并可视化选择
- **媒体过滤**: 全部 / 仅图片 / 仅视频
- **窗口行为**: 置于顶层、锁定位置、吸附网格、点击穿透（桌面摆件模式）
- **按显示器记忆**: 主屏在内置屏与外接屏之间切换时，按物理显示器分别恢复位置与尺寸
- **低占用形态**: 默认隐藏 Dock 图标，菜单栏常驻图标作为找回入口
- **离线缓存**: 缩略图与原图磁盘缓存

## 系统要求

- macOS 26.4+（使用 Liquid Glass 等新 API）
- Xcode 26.4+
- Apple Developer 账号（签名与 App Groups）

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

### 3. 编译运行

1. 选择 **LuviaGalleryWidget** scheme
2. 点击 Run (⌘R) 启动
3. 在设置面板输入服务器地址和 Token
4. 点击「立即加载」

## 在线目录选择

- 在线来源切换到“文件夹”模式后，先填写服务器地址与 Wallpaper Token，再点击“浏览…”。
- 选择面板会从当前账号的授权根目录开始，每次只请求下一层目录；返回已浏览层级时复用本次面板会话的缓存。
- 虚拟授权根目录不能直接选择；进入实际目录后，可用“选择当前文件夹”保存路径，再点击“立即加载”开始递归轮播。
- 目录请求使用 `Authorization: Bearer`，Token 不写入目录 URL 或目录请求日志。本地来源仍使用系统目录选择面板。

## 打包发布

Release 打包已固化为脚本（仓库任意位置均可执行）：

```bash
bash macos-widget/scripts/package_release.sh
```

- 流程：Release archive → 导出 .app 到临时目录 → codesign 校验 → ditto 打包 zip。
- 产物为 `dist/LuviaGalleryWidget.app.zip`；**dist 不保留 .app 本体**（避免启动台索引出多个图标），安装时解压 zip 拖入 `/Applications`。
- 详见 `dist/README.md`。

## 多显示器位置记忆

- 窗口位置以目标屏 `visibleFrame` 内的归一化坐标保存，因此切换主屏、改变排列、分辨率或 Dock/菜单栏工作区后仍能安全恢复。
- 内置屏使用硬件厂商与型号识别；外接屏优先使用硬件序列号，无数字序列号时使用显示器名称和物理尺寸作为最佳努力指纹。
- 两台完全同型号、无序列号且指纹冲突的显示器只在当前进程内分档，避免把无法可靠区分的档案永久串写。
- 旧版以临时数字显示器 ID 保存的数据不会自动迁移；升级后每台屏首次使用时需要放置一次。

## 文件结构

```
LuviaGalleryWidget/
├── LuviaGalleryWidget.xcodeproj/    # Xcode 项目
└── LuviaGalleryWidget/              # 悬浮窗 App
    ├── LuviaGalleryWidgetApp.swift  # 入口与 AppDelegate（窗口/菜单栏/启动应用持久化设置）
    ├── ContentView.swift            # 主视图（轮播 + 设置面板）
    ├── Window/                      # FloatingWindow 与 WindowController
    ├── Models/                      # 数据模型
    ├── Services/                    # 服务层（加载/缓存/吸附/登录项/菜单栏）
    └── Views/                       # 卡片与设置面板
```

## 获取 Token

1. 启动 Luvia Server
2. 在 Web 设置面板找到 **Wallpaper Token** 区域
3. 点击 **Generate Token** 生成 JWT Token
4. 复制 Token 到 App 设置面板

## API 依赖

App 使用以下后端 API：

| API | 用途 |
|-----|------|
| `GET /api/scan/results` | 获取媒体列表 |
| `GET /api/library/folders` | 按当前用户权限逐层浏览在线目录 |
| `GET /api/thumb/:id` | 获取缩略图 |
| `GET /api/file/:id` | 获取原图/视频 |
| `GET /api/auth/wallpaper-token` | JWT Token 管理 |

## 许可证

Apache-2.0
