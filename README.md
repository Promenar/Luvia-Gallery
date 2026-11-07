<div align="center">
  <img src="mobile/assets/icon.png" width="120" height="120" style="border-radius: 24px" alt="Luvia Gallery Logo">
  <h1>Luvia Gallery</h1>
  <p><strong>优雅浏览已归档媒体的无侵入方案</strong></p>
  <p><i>Non-destructive media browsing for existing archives.</i></p>
</div>

---

# 🇨🇳 中文说明 (Chinese)

Luvia Gallery 专为"已有归档媒体"设计：它不搬动、不重命名、也不上传您的文件。只需通过 Docker 映射现有目录，即可在浏览器中优雅地浏览 NAS 或本地硬盘中的海量图片、视频与音频。

## 🌟 核心特性

- 🛡️ **零侵入存储**: 媒体目录以只读方式挂载，不移动、不重命名、不修改原始文件。
- 👀 **实时媒体库监控**: 在 NAS 或本机新增、修改、移动、删除文件后数秒内出现在界面中；移动或改名保留原媒体 ID 及收藏、相册关系。网络文件系统或监视额度不足时自动改为定时轮询，另有每日全量对账兜底。
- 🧯 **防误删保护**: 文件消失后先进入删除宽限期（默认 7 天），宽限期内重新出现即恢复；媒体库所在磁盘未挂载或被替换时停止标记缺失，不会因为 NAS 晚启动而清空媒体库。
- 🚀 **大库性能**: 面向百万级文件与数万目录，扫描分批续跑，缩略图、视频预览与 HLS 转码在独立 worker 中排队执行。
- 🔐 **多用户与权限**: 会话与 API 令牌鉴权，按虚拟目录限制用户可见范围，登录限速。
- ⭐ **收藏、相册与分享**: 手动相册与智能相册；分享支持密码、过期时间和原文件下载权限。
- 🎵 **图片、视频与音频**: 视频按需 HLS 转码，支持 NVIDIA NVENC 硬件编码。
- 🖌️ **本地图像修复**: 管理员可使用本地模型处理单张图片，SLBR 支持自动检测、逐张审核和全自动批量处理；结果保存为新副本。外部图片可通过选择、拖放或粘贴添加。
- 🖼️ **壁纸服务**: 为 Wallpaper Engine 提供随机壁纸接口，兼容 v1 客户端。
- 📦 **v1 平滑迁移**: 可导入 v1 的账户、收藏与壁纸令牌。

## 🏗️ Docker 部署

仓库根目录的 `docker-compose.yml` 定义了 `api`（网页与接口）和 `worker`（扫描、监控、缩略图与转码）两个服务，二者使用同一镜像并共享数据卷：

```bash
LUVIA_MEDIA_PATH=/您的/真实/媒体目录 docker compose up -d --build
```

| 容器路径 / 变量 | 用途 |
| --- | --- |
| `/media`（只读） | 媒体目录；多个媒体库用 `MEDIA_ROOT` 以分号分隔，如 `/media/a;/media/b` |
| `/data` | 数据库与配置，必须持久化 |
| `/cache` | 缩略图、预览与转码缓存，可重建但建议持久化 |
| `LUVIA_HOST_PATHS` | 可选，把容器路径映射回宿主机路径，用于在管理界面显示真实位置 |
| `TRUST_PROXY` | 部署在反向代理后时填可信代理跳数（一层代理为 `1`） |
| `COOKIE_SECURE` | 仅通过纯 HTTP 内网访问时设为 `false` |
| `JWT_SECRET` | 可选，v1 旧版接口的 JWT 密钥 |

需要 GPU 转码时，在 worker 服务上启用 compose 文件中注释掉的 NVIDIA 设备预留，并设置 `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility`（缺少 `video` 时 NVENC 不可用，会自动回退 CPU 编码）。实时监控在 Linux 上使用 inotify，媒体目录数量很大时请确认宿主机 `fs.inotify.max_user_watches` 足够（管理界面会显示用量）。

## 🛠️ 技术架构

- **后端**: Node.js 24 / Fastify 5 / SQLite（WAL，`better-sqlite3`，FTS5 全文搜索）/ sharp / FFmpeg；API 与 worker 双进程
- **前端**: React 19 / Vite / TypeScript / Tailwind CSS v4 / shadcn/ui（Base UI）/ TanStack Router 与 Query
- **接口契约**: `packages/contracts`（zod），前后端共用
- **浏览器要求**: Chrome 111+、Safari / iOS 16.4+、Firefox 128+（Tailwind CSS v4 下限）

## ⚠️ 使用须知

- 媒体目录默认以只读方式挂载；导入修复副本或使用受控删除功能时，目标媒体库需另行配置可写挂载与权限。外部图片修复会先上传到本地临时缓存。
- 请务必持久化挂载 `/data`；`/cache` 丢失只会导致缓存重新生成。
- 首次访问会引导创建管理员账户。
- 修改账户密码或管理员重置密码会撤销该账户的登录会话，但不会撤销已创建的 API 令牌和壁纸令牌；如需停用令牌，请在令牌管理中单独撤销。

---

# 🇺🇸 English Description

Luvia Gallery is a non-destructive media browser for pre-archived libraries. It doesn't move or modify your files; it simply scans and serves them via Docker volume mapping for a fast, elegant experience in the browser.

## 🌟 Highlights

- 🛡️ **Non-Destructive**: Media folders are mounted read-only; nothing is moved, renamed or modified.
- 👀 **Real-Time Library Monitoring**: Files added, changed, moved or deleted on your NAS show up within seconds. Moves and renames keep the original media ID with its favorites and albums. Falls back to periodic polling on network filesystems or when watch quota runs short, with a daily full reconcile as a safety net.
- 🧯 **Deletion Safeguards**: Vanished files enter a grace period (7 days by default) and are restored if they reappear. When the library's disk is unmounted or replaced, nothing is marked missing, so a late-starting NAS never empties your library.
- 🚀 **Large Libraries**: Built for millions of files and tens of thousands of folders; scans resume in batches, and thumbnails, previews and HLS transcoding run in a separate worker.
- 🔐 **Users and Permissions**: Session and API-token auth, per-user virtual folder access, login rate limiting.
- ⭐ **Favorites, Albums and Sharing**: Manual and smart albums; shares with password, expiry and original-download control.
- 🎵 **Photos, Video and Audio**: On-demand HLS transcoding with NVIDIA NVENC support.
- 🖼️ **Wallpaper API**: Random wallpaper endpoint for Wallpaper Engine, compatible with v1 clients.
- 📦 **v1 Migration**: Imports v1 accounts, favorites and wallpaper tokens.

## 🏗️ Docker Compose

The repository's `docker-compose.yml` defines two services sharing one image and the data volumes: `api` (web UI and API) and `worker` (scanning, monitoring, thumbnails and transcoding).

```bash
LUVIA_MEDIA_PATH=/your/media/path docker compose up -d --build
```

| Container path / variable | Purpose |
| --- | --- |
| `/media` (read-only) | Media folders; use `MEDIA_ROOT` with semicolons for several libraries, e.g. `/media/a;/media/b` |
| `/data` | Database and settings; must be persisted |
| `/cache` | Thumbnail, preview and transcode cache; rebuildable but best persisted |
| `LUVIA_HOST_PATHS` | Optional mapping from container paths back to host paths, shown in the admin UI |
| `TRUST_PROXY` | Number of trusted reverse-proxy hops (`1` for a single proxy) |
| `COOKIE_SECURE` | Set to `false` only for plain-HTTP LAN access |
| `JWT_SECRET` | Optional JWT secret for the legacy v1 API |

For GPU transcoding, enable the commented NVIDIA device reservation on the worker service and set `NVIDIA_DRIVER_CAPABILITIES=compute,video,utility` (without `video`, NVENC is unavailable and encoding falls back to CPU). Real-time monitoring uses inotify on Linux; for very large folder trees make sure the host's `fs.inotify.max_user_watches` is high enough (usage is shown in the admin UI).

## 🛠️ Tech Stack

- **Backend**: Node.js 24 / Fastify 5 / SQLite (WAL, `better-sqlite3`, FTS5 search) / sharp / FFmpeg; separate API and worker processes
- **Frontend**: React 19 / Vite / TypeScript / Tailwind CSS v4 / shadcn/ui (Base UI) / TanStack Router and Query
- **Shared contracts**: `packages/contracts` (zod), used by both frontend and backend
- **Browser support**: Chrome 111+, Safari / iOS 16.4+, Firefox 128+ (Tailwind CSS v4 baseline)

## ⚠️ Notes

- Luvia is a media browser with **no upload feature**; mount media folders read-only.
- Always persist `/data`; losing `/cache` only means caches are regenerated.
- The first visit walks you through creating an admin account.
- Changing a password, or an admin resetting it, signs that account out everywhere but does not revoke existing API or wallpaper tokens; revoke tokens separately in token management.

---

## 📄 License | 协议

本项目基于 **Apache-2.0** 协议授权。

Licensed under the **Apache-2.0** License.
