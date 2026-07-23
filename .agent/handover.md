# 跨会话交接

## 2026-07-23 会话：macOS 悬浮相册轮播 App（方案 B 落地）

- [x] 真机迭代修复（`c0d93c2`/`5fef3d5`/`83027fb`/`c3c32d0`）：①窗口改 `.titled + fullSizeContentView` 透明标题栏获得原生缩放/拖动（`.borderless` 方案缩放热区失效）；②浮光改卡片内 `onHover` 自管理（父调 struct 方法无效）；③设置面板齿轮 toggle + 收起按钮；④标题栏图钉置顶切换；⑤**非置顶沉桌面图标层级（desktopIconWindow+1）+ `.canJoinAllSpaces/.stationary/.ignoresCycle/.fullScreenAuxiliary`，规避台前调度收编**——这是"桌面组件化"的关键手段；⑥`SMAppService.mainApp` 开机自启动开关（失败回滚并提示）。
- [x] 经验：运行 scheme 有两个（`LuviaGalleryWidget`=悬浮窗 App，`GalleryWidget`=WidgetKit 扩展预览器），已提交 shared xcscheme。

- [x] 体验迭代（`4f9e7f7`/`234916d`/`9d8fde4`/`efc8b22`）：①设置面板 ScrollView 限高防裁切，后改为展开时 ZStack **完整覆盖卡片区**（不再压缩图片）；②桌面网格吸附（`DesktopGridSnap`，拖动松手防抖 0.2s 吸附；Finder `gridSpacing` 换算不公开，改为 60–140px 滑块用户校准）；③外壳 **`.glassEffect` 液态玻璃**（target macOS 26 可用）+ 0.18 黑色 tint；④图片双缓冲 0.5s 交叉淡化（`CachedImageView`/`LocalImageView`），换批弹簧放慢到 0.85s（hover 保持 0.55s），新卡淡入滑入；⑤**本地目录来源**（security-scoped bookmark 持久化、递归可选、ImageIO 降采样 400/1600）；⑥同时显示 1–6 张可调；⑦底部改为左来源文本 + 右 140px 进度条单行；⑧设置面板分 来源/播放/窗口 三组；⑨entitlements 补 `files.user-selected.read-only` + `files.bookmarks.app-scope`。

- [x] 在 `macos-widget/LuviaGalleryWidget` 的 **App target** 上实现桌面悬浮窗轮播（WidgetKit extension 未动）：无边框透明 `FloatingWindow`（AppDelegate 手动创建，关闭隐藏、Dock 重开、可置顶 `.floating`、minSize 480x260）。
- [x] 轮播与 Kimi 看板组件 1:1：6 卡窗口 + 当前大卡 2.1 倍宽、6 秒（2–30 可调）弹簧动画循环、编号 01-06、hover 手风琴（2.5/0.6）+ 斜向浮光、hover 暂停、点击跳转、底部蓝色进度条、`accessibilityDisplayShouldReduceMotion` 降级。
- [x] 设置面板 @AppStorage 持久化（server/token/模式/文件夹/间隔/置顶），成功后同步 `TokenStore` 到 App Group `group.com.luvia.gallery` 与小组件共享；复用现有 `APIClient`/`ImageCache`（缓存 key `thumb_/orig_` 前缀）。
- [x] 新增 `Window/FloatingWindow.swift`、`ViewModels/CarouselViewModel.swift`、`Views/{CarouselCard,CachedImageView,SettingsPanel}.swift`；重写 App 入口与 `ContentView`；entitlements 补 `com.apple.security.network.client`。
- [x] `xcodebuild -scheme LuviaGalleryWidget -configuration Debug build` 通过（CODE_SIGNING_ALLOWED=NO）。
- ⚠️ 待真机验证：hover 手感、窗口边缘缩放热区、卡片拖动与窗口拖动手势区分；发布需开发者签名含 App Group 与网络权限。

## 2026-07-23 会话收尾：相册轮播 Widget 上线（HTTPS 反代 + 多轮渲染/交互修复）

> 本轮主体工作在 Kimi Work Widget（`widget_26304d50-1e40-4c2b-a6d1-63c4130a2dd3`，看板「相册画廊」）与 FNOS 基础设施，仓库代码无改动；记录供后续换机/复用参考。

### 关键结论：Kimi Widget 访问内网 http 服务的完整解法
1. Widget iframe 运行在 `kimi-widget://view-N` **安全上下文**，`secure=true` 时 Chromium **混合内容拦截**禁止一切 `http://` 子资源请求（请求不发出，服务端响应头无效）。
2. 解法 = **Tailscale serve HTTPS 反代**：FNOS 上 `sudo tailscale --socket=/vol1/@appdata/tailscale/tailscaled.sock serve --bg --https=8443 http://127.0.0.1:9980`（tailscaled 二进制在 `/vol1/@appcenter/tailscale/bin/`）。自动签发 Let's Encrypt 真证书，浏览器原生信任。⚠️ 443 被飞牛自带 nginx 占用，必须用其他端口（8443）。
3. **PNA 头依然必要**：ts.net 域名解析到 100.x 私有 IP，CORS fetch 会发私有网络预检；服务端 `Access-Control-Allow-Private-Network: true`（上轮已上线）经 serve 透传后预检通过。
4. **Mac 侧 DNS 污染**：本机代理（Clash/mihomo）把 `promenar-fnos.tail6046d5.ts.net` 劫持解析到错误公网 IP，已写 `/etc/hosts`：`100.72.176.103 promenar-fnos.tail6046d5.ts.net` 绕过（hosts 先于 DNS 生效，TUN 模式也不受影响）。
5. 最终地址：`https://promenar-fnos.tail6046d5.ts.net:8443`，已验证 API 200 + PNA 预检头齐全。

### Widget 迭代记录（index.html 单文件，无仓库改动）
- **图片渲染**：`<img>` 直连内网（no-cors）被 PNA 静默拦截；改为 `fetch`(CORS，可过预检) → blob URL 显示。小卡用 `thumbnailUrl`、主卡用原图，并发 6、blob 缓存、换批释放。
- **布局**：参考 Kimi Tech Blog 样式只渲染当前起的 **6 张窗口**（曾把 92 张全排一行导致视觉空白）；编号 01-06 当前项亮蓝。
- **设置持久化**：`kimi-widget://view-N` 源每次变化导致 localStorage 不共享；改用宿主持久层 `saveInput` / `inputState.currentInput`（已验证跨会话生效），localStorage 仅作缓存。
- **交互**：CSS 手风琴（`.stage:hover .photo-card { flex-grow: 0.6 }` + `:hover { flex-grow: 2.5 }`）+ 斜向浮光扫过；悬停暂停轮播；`prefers-reduced-motion` 下全部关闭。
- **桌面固定适配**：`html/body/widget/shell` 全链路 flex 撑满宿主区域，`.stage` 改弹性高度（曾固定 230px 导致拉高露白边）；按用户要求移除卡片竖排文件名与主卡数字角标，仅保留左上编号与顶部 `n / total`。

## 2026-07-23 会话：PNA 放行 + 剪贴板回退 + FNOS 容器重建

- [x] `server.js` 新增中间件无条件返回 `Access-Control-Allow-Private-Network: true`（在 `cors()` 之前），修复 Chrome 私有网络访问（PNA）拦截：从安全上下文页面（Kimi Work 相册轮播组件等）经 Tailscale 内网地址访问时的 `Failed to fetch`。
- [x] `components/SettingsModal.tsx` `copyToClipboard` 改为安全上下文用 clipboard API、非安全上下文（http 内网地址）回退 `execCommand('copy')`，失败显式提示，修复令牌一键复制静默失效。
- [x] 提交 `01d4fc0` 并推送 `main`。
- [x] FNOS 重建部署：构建目录 `/vol2/1000/APPDATA/Lumina/build/Luvia-Gallery`（git clone）；当前生产镜像已打回滚标签 `promenarleng/luvia-gallery:rollback-0bb4c4c`（sha256:4138bdb…）；新镜像 `promenarleng/luvia-gallery:latest` 构建成功后 `docker compose up -d` 重建完成。
- [x] 验证：OPTIONS 预检返回 `access-control-allow-private-network: true`，`/api/scan/results?random=true&token=…` HTTP 200。
- ⚠️ 注意：FNOS Docker 守护进程的默认镜像站 `docker.fnnas.com` 对 `docker.io` 拉取返回 401；本次通过 `docker.m.daocloud.io` 预拉 `node:20-bookworm` 与 `nvidia/cuda:12.4.1-base-ubuntu22.04` 并重打标签解决。后续构建若新增基础镜像需同样预拉。

## Done (已完成)
- [x] 修复 FNOS 生产容器内存膨胀问题：`runner.js` 代理层增加 socket 生命周期清理、短连接代理与空闲超时。
- [x] 为 Docker Compose 增加容器内存上限、swap 上限、Node 老生代堆限制与代理空闲超时配置。
- [x] 在 `native-ui` 目录下完成了移动端从 React Native 到 Kotlin (Jetpack Compose) 的全面重构。
- [x] 建立了现代化的 Android 架构 (MVVM + Hilt + Retrofit + DataStore)。
- [x] 实现了完整的 UI 骨架：Splash -> Login -> Main (5 Tabs)。
- [x] 核心页面开发完成：
  - **Home**: 英雄轮播图 + 最近添加列表。
  - **Gallery**: 高性能媒体网格。
  - **Folders**: 文件夹列表（逻辑框架已就绪）。
  - **Favorites**: 收藏媒体视图。
  - **Settings**: 服务器状态查看与注销功能。
  - **Media Viewer**: 全屏查看器，支持 EXIF 信息浮层。
- [x] 实现了 **DynamicUrlInterceptor**，支持动态切换后端服务器地址。
- [x] 同步更新了文档体系：
  - `docs/ARCHITECTURE.md`: 新增 Android 原生架构说明。
  - `docs/DATA_SCHEMA.md`: 新增 DataStore 与 API 模型定义。
  - `release_notes.md`: 新增 v1.2.0 版本记录。

## Next Steps (下一步计划)
- [ ] 生产部署后持续观察 `docker stats luvia-gallery`、容器 cgroup `sock` 内存和 ESTABLISHED 连接数是否稳定下降。
- [x] 提交变更并推送到远程
- [ ] 构建 Docker 镜像部署到 NAS 实机
- [ ] 完善 **Folders** 下钻功能：点击文件夹后进入该文件夹的媒体列表页。
- [ ] 集成 **Media3 (ExoPlayer)** 实现全屏视频播放支持。
- [ ] 增加图片手势缩放功能 (ZoomableImage)。
- [ ] 增加图片/视频删除确认逻辑。
- [ ] 进行端测与混淆配置 (Proguard)。

## Risks (未决风险与阻塞)
- 生产诊断显示 11G 容器内存主要来自 cgroup `sock`，根因高度指向代理 socket 滞留；部署后仍需用真实媒体浏览负载观察 24 小时。
- FNOS 主机 swap 已满，部署修复前后的短期卡顿也可能受宿主机内存回收影响。
- 目前由于环境限制无法进行实机编译测试，所有代码均为静态逻辑实现。
- 视频播放器 (Media3) 的 Lifecycle 管理尚未完成，需防止内存泄漏。
- 缩略图加载性能在超大数据集（>10000项）下的表现需实测调优。

## DIA Status (文档同步状态)
- [x] `release_notes.md` 已同步 v1.2.1 生产稳定性修复
- [x] `.agent/handover.md` 已记录生产诊断、风险与观察项
- [x] `docs/ARCHITECTURE.md` 已同步
- [x] `docs/DATA_SCHEMA.md` 已同步
- [x] `release_notes.md` 已同步
- [x] `.agent/handover.md` 已更新

## 2026-07-19T23:58:36+08:00 · FNOS 媒体浏览周期性全局停顿诊断

type: diagnostic
scope: fnos-production
status: done
tags: [performance, nodejs, event-loop, media, scan]
continuity: resume
continuity-key: fnos-media-stall

### Summary

- 两周运行观察确认上一轮 socket 内存修复有效；本次诊断时容器内存约 808 MiB，`sock` 为 0，未发生重启或 OOM。
- 生产日志确认两个定时任务会同步占用 `server.js` 的单一事件循环：缓存统计每 10 分钟遍历约 89.9 万个缓存文件，单次约 5.7-16.1 秒；周期扫描每 15 分钟遍历约 90.6 万个媒体文件，单次约 11.7-14.9 秒。
- 两个任务每 30 分钟会近乎连续执行，可形成约 20 秒的整体无响应窗口，与“页面仍在、全部内容请求暂时断掉后恢复”的现象高度一致。
- 连续视频浏览会产生多段 Range 请求，是磁盘与网络压力的潜在放大器；当前没有 socket、fd 或代理错误证据支持旧泄露问题复发。

### Changed

- 本轮未修改业务代码或生产配置，仅完成只读运行时诊断。

### Validation

- 检查 `docker stats`、cgroup 内存分类、容器重启/OOM 状态、24 小时生产日志和宿主机 I/O 快照。
- 对照源码确认 `updateGlobalCacheStats()` 使用递归 `readdirSync`/`statSync`，`processScan()` 在主事件循环中使用 `readdirSync`/`statSync`，且正常扫描路径没有真正让出 I/O 事件循环。
- Terra 只读子代理独立审阅后同样将上述两个同步全库任务列为最高概率根因；主控已用生产日志复核。

### Next

- 将缓存统计改为增量计数或 Worker Thread 后台任务，禁止主事件循环递归同步遍历缓存目录。
- 将媒体周期扫描改为异步分批扫描或 Worker Thread，并加入事件循环延迟、任务耗时和媒体首字节指标。
- 在优化后用真实连续浏览负载复测 10/15/30 分钟时间窗，再评估视频 Range 请求取消与预加载策略。

### Risks

- 当前已确认固定周期的全局阻塞根因，但尚未在用户实际操作时采集浏览器网络瀑布；不能排除视频源文件结构、旧流取消或存储尾延迟形成独立的第二问题。
- 约 90 万文件规模下，简单把同步 API 替换为逐文件异步 API 可能造成任务风暴；实施时需要有界并发、分批让出和可取消设计。

### DIA

- 无业务代码、接口、配置或用户可见行为变更；仅同步 HLG 诊断记录和索引注册。

### HLG

- 已追加标准时间戳交接记录，后续沿用 `continuity-key: fnos-media-stall`。

## 2026-07-20T00:41:43+08:00 · FNOS 媒体浏览全局停顿优化实现

type: implementation
scope: fnos-production
status: done
tags: [performance, nodejs, event-loop, sqlite, media, deployment]
continuity: waiting
continuity-key: fnos-media-stall

### Summary

- 已将缓存统计和媒体周期扫描改为 `opendir` 异步流式遍历、16 路有界文件状态读取和 256 项批次让出，消除两个全库任务对 Node 主事件循环的同步占用。
- 后台任务协调器禁止缓存统计与媒体扫描重叠；扫描启动冲突返回 409，且不会重置正在运行的扫描状态。
- 增量 mtime 查询改为最多 512 路径的批次查询；数据库清理改为 `rowid` 游标 256 项批次，不使用 OFFSET 或一次性全库 `.all()`。
- 扫描不完整时禁止清理；FTS、文件表和收藏删除置于同一事务，任一失败整体回滚并停止后续批次。

### Changed

- 新增 `lib/background-file-walker.js`、`lib/database-batch-operations.js` 和对应 Node 原生测试。
- 更新 `server.js`、`database.js`、`package.json` 与 `Dockerfile`，并增加事件循环延迟告警。
- 同步 `README.md`、`release_notes.md`、`.agent/project_memory.md` 与 HLG 索引。

### Validation

- TDD 首轮：新增后台遍历接口前测试按预期失败；实现后转为 10 项通过。
- TDD 风险修正：新增数据库清理 helper 前测试按预期失败；生产 Node 20 容器中的真实 `better-sqlite3` 测试最终 15 项全部通过。
- 已验证 FTS 故障时文件与收藏事务回滚、`rowid` 游标边删除边翻页不漏记录、扫描不完整零清理、清理中停止不再处理后续批次。
- 本地语法检查和 Vite 生产构建通过；最终生产部署验证待提交推送后执行。

### Next

- 提交并推送候选版本，更新 FNOS 容器后观察启动 2 秒触发的缓存统计期间 API 延迟。
- 覆盖一个 15 分钟周期扫描窗口，确认约 90 万文件扫描期间 API 不再整体暂停，并记录事件循环延迟告警。

### Risks

- 完整扫描期间会临时维护约 90 万路径的 `Set`；它避免第二次文件系统遍历和一次性数据库 Map，但仍需观察扫描峰值内存。
- 清理过程中收到停止请求时，已提交的安全删除批次不会回滚；后续批次立即停止并返回 incomplete。

### DIA

- 已同步 README、release notes、项目记忆、Docker 运行时打包和测试入口。

### HLG

- 已追加本记录并沿用 `continuity-key: fnos-media-stall`；部署与 15 分钟窗口验证完成后需追加结果记录。

## 2026-07-20T01:00:26+08:00 · FNOS 媒体浏览卡顿修复生产验证完成

- type: deployment-verification
- scope: production/fnos/media-scan
- status: completed
- tags: performance, event-loop, media-scan, cache-stats, production
- continuity: none
- continuity-key: fnos-media-stall

### Summary

已将媒体目录扫描与缓存统计从同步递归文件系统遍历改为异步流式、限并发、分批让出事件循环的实现，并完成 FNOS 生产部署与真实周期任务验证。原先每 10/15 分钟可能造成十几秒至数十秒全站断连的事件循环阻塞已消除。

### Changed

- 生产运行代码提交：`a87f86e9a46c20178c607c69ce97768d5e21d49a`。
- 生产镜像：`sha256:4138bdb52d50baaa3ca30fb9f398cdbc63720e5ab26f6147135ce6246d253214`。
- 回滚镜像：`promenarleng/luvia-gallery:rollback-a9fb8ea`。
- 缓存统计与媒体扫描互斥执行；扫描不完整时禁止清理数据库缺失记录；数据库清理按游标分批事务执行。

### Validation

- Node 20 生产依赖环境测试：16/16 通过。
- 前端生产构建通过；服务端及新增模块语法检查通过。
- 缓存统计处理 899,964 个文件、耗时 37.659 秒；执行期间 120 次 API 请求零失败，最大延迟 3.703ms。
- 首次 15 分钟周期扫描处理 906,148 个文件、耗时 42.359 秒；执行期间 103 次 API 请求零失败，平均延迟 3.390ms，最大延迟 6.416ms，超过 100ms 与 500ms 的请求均为 0。
- 扫描后容器状态：running，restart=0，OOM=false，内存约 318.7MiB/8GiB，CPU 约 0.17%。

### Next

无需继续施工；保留真实用户连续浏览图片和视频的常规观察，如再次出现卡顿，优先按事件循环告警时间戳与反向代理日志关联定位。

### Risks

自动化验证覆盖服务端 API 连续请求与真实大目录后台任务，未代替浏览器端长时间连续图片/视频播放体验；当前生产证据已覆盖本次已确认的服务端全局断连根因。

### DIA

已同步 README、release_notes、project_memory、registry、实施计划与 handover。

### HLG

已追加本条完成记录，并以同一 continuity-key 关闭本次生产性能工作流。


## 2026-07-23T05:44:00+08:00 · 悬浮窗 App 拖窗冲突修复与打包交付

type: fix
scope: macos-widget/floating-window
status: done
tags: [macos, floating-window, drag, input, packaging]
continuity: resume
continuity-key: macos-floating-widget

### Summary

修复悬浮窗 App 设置面板输入框拖选文字时整个窗口被拖动的冲突，并完成 Release 打包交付。

### Changed

- `FloatingWindow.swift`：关闭 `isMovableByWindowBackground`（拖选触发拖窗的根因）。
- 新增 `Views/WindowDragView.swift`：NSView 包装，仅在空白区域 `mouseDown` 时调用 `window?.performDrag`。
- `ContentView.swift`：根 ZStack 最底层铺 WindowDragView，深色遮罩矩形补 `.allowsHitTesting(false)`。
- 提交 `b28ceb0` 并推送 `main`。

### Validation

- `xcodebuild -scheme LuviaGalleryWidget -configuration Debug build` 通过（BUILD SUCCEEDED）。
- 真机四项验证（输入框拖选 / 空白拖窗 / 卡片交互 / 边缘缩放）待用户确认。

### Artifacts

- 打包产物（被 .gitignore 忽略，不入库）：`macos-widget/dist/LuviaGalleryWidget.app`、`macos-widget/dist/LuviaGalleryWidget.app.zip`（约 504 KB）。
- Apple Development 证书签名；spctl 拒绝属预期（非 Developer ID 公证签名）。
- 注意：`macos-widget/dist` 下的 .app 为本次修复**之前**的 Release 构建；若需包含本次拖窗修复，需重新 Release 打包。

### Next

用户真机验证四项交互；如通过且需要最新修复的独立 App，重新执行 Release 打包刷新 dist 产物。

### Risks

无新增；xcuserstate 等 Xcode 用户态文件未入库。

### DIA

已同步 handover；Widget（看板组件）侧无代码变更，无需更新 registry。

### HLG

本条为 macos-floating-widget 工作流追加记录，保持 continuity 可续。


## 2026-07-23T05:57:00+08:00 · 悬浮窗 App 视频播放支持

type: feature
scope: macos-widget/video-playback
status: done
tags: [macos, video, avplayer, carousel, media-type]
continuity: resume
continuity-key: macos-floating-widget

### Summary

悬浮窗 App 新增视频播放支持：后端壁纸 API 返回的视频条目此前被当作图片加载导致无限转圈，现已按媒体类型分派 AVPlayer 播放，静音自动循环，复用卡片动画框架。

### Changed

- 新增 `Views/VideoCardView.swift`：AVPlayerLayer（resizeAspectFill）+ 静音 + 片尾 seek 回零循环；远程视频走 `/api/file/{id}?token=` 流式播放。
- `ViewModels/CarouselViewModel.swift`：不再过滤视频，保留 `mediaType == image || video`。
- `Services/LocalImageSource.swift`：本地目录扫描纳入 `mp4/mov/m4v`，新增 `isVideoFile(_:)`。
- `Views/CarouselCard.swift`：按来源与媒体类型分派图片/视频视图，新增 `isPlaying` 参数。
- `ContentView.swift`：逐卡计算播放状态传入；底部文案改为「媒体 N 项」。
- 性能：`preferredForwardBufferDuration = 5s`；手风琴收缩态与设置面板覆盖时暂停，可见恢复；URL 不变不重建播放器，dismantle 时释放。
- 提交 `1f3d1dc` 并推送 `main`；dist Release 打包已刷新（App 1.4 MB / zip 528 KB，codesign 校验通过，不入库）。

### Validation

- Debug `xcodebuild` BUILD SUCCEEDED；Release ARCHIVE SUCCEEDED。
- 真机验证（视频播放 / hover 恢复 / 6 卡同屏内存）待用户确认。

### Next

用户真机验证；如有视频卡顿或内存异常，优先检查 6 卡同屏缓冲策略与 FNOS 网络吞吐。

### Risks

多张视频卡同屏的内存占用未做量化压测；5s 前向缓冲在低带宽内网下可能出现起播延迟。

### DIA

已同步 handover；服务端与看板 Widget 无变更，registry 无需更新。

### HLG

本条为 macos-floating-widget 工作流追加记录，保持 continuity 可续。


## 2026-07-23T13:30:00+08:00 · 悬浮窗 App 排列方向 / 最小尺寸 / 位置锁定 / frame 记忆

type: feature
scope: macos-widget/layout-lock-memory
status: done
tags: [macos, vertical-layout, min-size, position-lock, frame-persist]
continuity: resume
continuity-key: macos-floating-widget

### Summary

悬浮窗 App 连续四轮体验迭代：纵向排列切换、最小尺寸下调、一键锁定坐标（替换右上角置顶按钮）、退出时窗口位置与尺寸记忆。

### Changed

- `f4c4e72` 纵向排列：设置面板「播放」组新增横向/纵向 Segmented Picker（@AppStorage 持久化）；carouselRow 主轴抽象，同一套权重与 CarouselCard 外壳复用，hover 沿轴展开；切换方向慢速弹簧过渡；入场动画按轴适配。
- `301441e` 最小尺寸：窗口 minSize 480×260 → 260×180，内容下限 244×164，卡片区 minHeight 60；网格吸附只算位置不受影响。
- `6b38478` 位置锁定：右上角图钉按钮替换为锁定按钮（lock.open/lock.fill，锁定时主题蓝高亮）；@AppStorage("positionLocked") 持久化；锁定禁用拖动层 performDrag、动态移除 styleMask .resizable、吸附兜底跳过；置顶功能仅保留在设置面板。
- `d3fbb63` frame 记忆：手动 UserDefaults 方案（弃用 setFrameAutosaveName，避免与吸附冲突）；windowDidMove/Resize 0.5s 节流落盘；启动恢复前做屏幕可见性校验（任一屏幕 visibleFrame 内 ≥80×40 才恢复，否则回退居中），拔屏不丢窗。
- dist Release 打包逐轮刷新，最终 App 1.4 MB / zip 544 KB，codesign 校验通过，不入库。

### Validation

- 各轮 Debug BUILD SUCCEEDED、Release ARCHIVE SUCCEEDED。
- 真机验证由用户逐轮进行：纵向排列与最小尺寸已确认「大问题没有」；锁定与 frame 记忆验证点已给出（锁定禁拖/禁缩放/重启保持、frame 恢复与拔屏回退）。

### Next

用户确认锁定与 frame 记忆后本工作流可收官；后续新需求以 continuity-key `macos-floating-widget` 续接。

### Risks

极小窗口（260×180）下 6 卡横向排列卡片较窄，为可接受的等比裁切表现；无其它新增风险。

### DIA

已同步 handover；服务端与看板 Widget 无变更，registry 无需更新。

### HLG

本条为 macos-floating-widget 工作流追加记录，保持 continuity 可续。


## 2026-07-23T13:42:00+08:00 · 悬浮窗 App 图标接入与 /Applications 安装交付（收官）

type: delivery
scope: macos-widget/icon-install
status: done
tags: [macos, app-icon, packaging, install, delivery]
continuity: close
continuity-key: macos-floating-widget

### Summary

悬浮窗 App 接入项目 LOGO 作为应用图标并完成 /Applications 安装交付，macos-floating-widget 工作流收官。

### Changed

- 图标源：`public/icon.png`（1024×1024 项目主图标），`sips -s format png -z` 生成 macOS 全尺寸 10 槽位 PNG 接入 `Assets.xcassets/AppIcon.appiconset`（注意：sips 必须显式指定 format png，否则输出 JPEG）。
- 工程 `ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon` 已存在，归档包生成 `Contents/Resources/AppIcon.icns`。
- 提交 `80e34db`（10 张图标 PNG + Contents.json）并推送 `main`。
- dist 刷新：App 2.4 MB / zip 1.4 MB，codesign 校验通过（不入库）。
- 安装：`pkill` 退出旧进程后 `ditto` 覆盖安装至 `/Applications/LuviaGalleryWidget.app`，签名复验通过。

### Validation

- Debug BUILD SUCCEEDED；Release ARCHIVE SUCCEEDED；INSTALL_OK。
- Launchpad/Dock 显示项目 LOGO；Spotlight 旧图标缓存可 `touch /Applications/LuviaGalleryWidget.app` 刷新。

### Next

无计划内后续；新需求以 continuity-key `macos-floating-widget` 续接。

### Risks

Apple Development 签名过不了 Gatekeeper（spctl rejected），分发给他机需右键打开或后续做 Developer ID 公证。

### DIA

已同步 handover；registry 无需更新。

### HLG

本条以 continuity: close 关闭 macos-floating-widget 工作流；后续若重开沿用同一 continuity-key。


## 2026-07-23T14:35:00+08:00 · 媒体过滤 + 网页深链 + FNOS 部署 + 打包流程固化

type: feature
scope: full-stack/media-filter-deeplink-deploy
status: done
tags: [macos, media-filter, deep-link, frontend, fnos-deploy, packaging]
continuity: resume
continuity-key: macos-floating-widget

### Summary

悬浮窗 App 新增媒体类型过滤（全部/仅图片/仅视频，App 层过滤不改服务端）与悬停按钮打开网页原图（免登录深链直达文件夹视图）；前端做 2 处最小改动支持深链免登录，已部署 FNOS 生产容器；打包流程固化为脚本，dist 只保留 zip，根治启动台多图标问题。

### Changed

- `e2f3b0d` App 过滤：`@AppStorage("mediaFilter")`（all/image/video），ViewModel 保留 allItems，切换即时生效不重新请求；本地目录来源同样过滤；不足一屏显示已有数量。
- `e2f3b0d` 深链：悬停卡片右上角浮现圆形按钮（arrow.up.forward.square，仅远程来源显示）→ `NSWorkspace.open` 打开 `{服务器地址}/?token={令牌}#folder={URL编码folderPath}`。
- `e2f3b0d` 前端（App.tsx 2 处）：initApp 读取 ?token= 写入 localStorage `luvia_token` 后 replaceState 抹除（免登录直达 + 防泄露）；#folder= 深链命中强制 setViewMode('folders')。壁纸 token 与登录 JWT 同一中间件校验。
- `9f3fa7e` 打包流程：新增 `macos-widget/scripts/package_release.sh`（archive → 临时目录导出 → codesign 校验 → ditto zip → trap 清理；dist 只留 zip），README 增补打包发布说明。
- FNOS 部署：旧镜像打标签 `promenarleng/luvia-gallery:rollback-01d4fc0`；新镜像 sha256:bd695efd…（含 e2f3b0d 前端）构建成功，`docker compose up -d` 重建；HTTPS 反代 200、内网 API 401（预期鉴权）。
- /Applications 已安装最新版（INSTALL_OK）；多余 App 副本（DerivedData Debug、dist .app）已清理，mdfind 确认仅一份注册。

### Validation

- App Debug BUILD SUCCEEDED；Release ARCHIVE SUCCEEDED ×2（脚本实跑验证）；zip 内 .app codesign VERIFY_OK。
- 前端 npm run build（vite）通过。
- 生产验证：容器 Up、反代 200；深链免登录闭环待用户真机确认。

### Next

用户真机验证：过滤切换即时生效、悬停按钮免登录直达文件夹视图、启动台单图标。后续打包统一使用 `macos-widget/scripts/package_release.sh`。

### Risks

Apple Development 签名分发限制依旧；?token= 虽经 replaceState 抹除，但浏览器历史在抹除前瞬间仍可能记录，属可接受范围（token 本身就是长期壁纸令牌）。

### DIA

已同步 handover；registry 无需更新。

### HLG

本条为 macos-floating-widget 工作流追加记录，保持 continuity 可续。


## 2026-07-23T17:20:00+08:00 · Tailscale 慢速根因排查：运营商 UDP QoS（PT 触发）

type: diagnostic
scope: network/fnos-tailscale-qos
status: monitoring
tags: [network, tailscale, udp-qos, cgnat, qbittorrent, pt, pcdn]
continuity: resume
continuity-key: fnos-udp-qos

### Summary

用户反馈 Tailscale 域名访问慢。系统性排查排除 DERP 中继、域名/HTTPS/tailscale serve、服务端性能后，实锤为运营商对 UDP 长流的 QoS 限速（稳定 2Mbps 档），触发源高度怀疑是 FNOS 上 qBittorrent 挂 PT（uTP=UDP、200+ 种子会话特征）命中 PCDN 风控画像。用户电信换移动两周后复发，时间线与 qbit 恢复上线吻合。

### Findings

- Tailscale 直连正常：`direct [2409:8a20:bc3:a230:67ba:43a7:a75c:b0a]:50279`，16ms，v6 UDP 路径，非 DERP。
- 域名（HTTPS:8443）与 IP（HTTP:9980）下载同一文件均 ~200KB/s → 与域名/TLS/serve 无关。
- Luvia 服务端本机读同一文件 239MB/s → 服务端零问题。
- FNOS→Mac 裸 TCP 上传测得 ~10Mbps；Tailnet 上持续传输塌缩至 100-200KB/s → UDP 长流被限速。
- 原生 v6 TCP 入站被路由器/ISP 防火墙拦截（直连绕开方案暂不可行）。
- 用户电信时期已实测：全部 UDP/加密流量稳定压 2Mbps、大包丢包 90%+ → 确认为同款 QoS 策略。
- Mac 与 FNOS 局域网不互通（192.168.0.x vs 192.168.2.x 隔离），全部流量必经 tailnet。
- 用户已停 qbit，等待画像冷却（预计 24~72h+）。

### qbit 已调整配置（用户自行操作）

- 连接协议改为仅 TCP（关 uTP）——降 UDP 特征权重最大的一步。
- 全局最大连接数 200、单种子 50、全局上传位 20、单种子上传位 4。
- 种子队列：活跃下载 3、活跃上传 30、**最大活跃种子数 5（建议改 30，否则上传 30 形同虚设，已口头提醒）**。
- 建议项（未确认执行）：关 UPnP/NAT-PMP（CGNAT 下无效）、关 DHT/PeX/LSD、上传限速 15-20M。

### 基准测试方法（复测用）

```bash
TOKEN=<壁纸令牌>; U="<某 /api/file/... URL>";
# 先取文件 URL: curl -s "http://100.72.176.103:9980/api/scan/results?limit=1&token=$TOKEN"
for i in 1 2 3; do curl -s -o /dev/null -r 0-2097151 -w "第${i}次: %{time_total}s %{speed_download}B/s\n" "http://100.72.176.103:9980$U?token=$TOKEN"; done
```

2026-07-23 基线：~170-220 KB/s（限速状态）。解除标志：回到 1 MB/s 以上。用户笔记本两地跑，不挂定时任务，由用户手动喊测。

### Next

- 72h 冷却后用户喊测，重跑基准对比。
- 若解除：恢复 qbit（TCP-only + 上述配置），并在路由器 v6 防火墙放行 qbit 监听端口恢复 PT 可连接性（PT 走 v6 上报，2409: 公网 v6 已确认）。
- 若未解除：考虑账号级风控，需客服申诉或更长时间冷却。
- 代理协议影响结论：hy2（QUIC/UDP）在 UDP QoS 下不可用；VLESS+Reality / AnyTLS（TCP 443）不受影响；Tailscale DERP 走 TCP 443 可作保底，重度使用可自建国内 derper。

### Risks

风控可能升级为账号级总量限速（核选项，当前量级可能性低）；v6 不豁免 QoS（UDP over v6 同样被限）。

### DIA

已同步 handover；代码与 registry 无变更。

### HLG

本条新建 continuity-key `fnos-udp-qos`，待冷却后复测续接。


## 2026-07-23T21:12:00+08:00 · 修正：UDP QoS 推论推翻 + 加载转圈/失败根因实为 App 实现 + 启动层级修复

type: correction
scope: macos-widget/loading-network
status: done
tags: [correction, loading, urlsession, tailscale, window-level]
continuity: resume
continuity-key: fnos-udp-qos
corrects: 2026-07-23T17:20:00+08:00 · Tailscale 慢速根因排查：运营商 UDP QoS（PT 触发）

### Correction（追加修正，原条目不改）

上一条「运营商 UDP QoS」推论被用户实测**推翻**：Mac 回到家与 FNOS 同内网后，hy2（UDP）上传跑 9MB/s 无 QoS 迹象；HTTPS 域名与 tailscale IP 直连同为内网速度；浏览器视频秒开。悬浮窗 App 依旧大量转圈 → 慢的真实根因是 **App 加载实现缺陷**，并非链路 QoS。qbit/PT 的 UDP QoS 分析仅作为历史经验保留参考，不作为本次结论。

### 真实根因（多因叠加）

1. 旧 `CachedImageView` 用 `URLSession.shared` 默认配置，resource 超时默认 7 天：链路偶发 stall（Tailscale 间歇性整条连接零字节响应，日志实测一请求卡 671s）时请求永不失败 → 卡片永久转圈；所有失败分支静默 return。
2. 大卡直拉 `/api/file` 全量原图（单张 14MB+），多卡并发争抢连接，stall 概率倍增；加载与视图生命周期耦合，hover/换批时下载被反复取消重来。
3. 视频卡无起播状态监听，缓冲黑屏、失败无提示。

### 修复（按序）

- `fd82e84`：专用 URLSession（15s/30s 超时、每主机 4 并发）、全局限流、同 URL 合并下载不随视图取消、失败重试；大卡先 300px 缩略图秒开再原图交叉淡化升级；失败显示「⚠ 点击重试」；视频卡 readyToPlay 状态监听。
- `d0256e9`：超时放宽 30s/120s，重试 1→2 次指数退避；缩略图失败自动降级原图；双失败后自动退避重试两轮才进错误态（偶发抖动自愈）。证据：服务端并发 8×24 全 200（20-80ms），修复版进程零网络错误。服务端无改动。
- `1f67c5d`：修复启动时置顶设置未生效——FloatingWindow 初始化硬编码 `level=.floating`，校正只挂 onAppear 时机不可靠；改为 applicationDidFinishLaunching 中按持久化 floatingOnTop 值直接 applyLevel（CGWindowList 实测 false→layer -2147483602 沉桌面、true→3 浮顶，均正确）。

### Validation

- 用户确认真机：全部卡片正常显示，不再转圈、不再大面积⚠。
- 各 commit Debug/Release 构建通过，已安装至 /Applications 并验签。

### Next

无需后续；tailnet 偶发 stall 由 App 侧重试/降级兜住。若日后重现大面积失败，先查 `log stream` 中 NSURLSession 错误码与 Tailscale flow 记录。

### Risks

Tailscale 间歇性整条连接无响应的底层原因未查明（可能与笔记本睡眠/网络切换有关），目前由应用层容错覆盖。

### DIA

本条为追加修正条目；原 UDP QoS 条目保持原样未改。registry 无变更。

### HLG

continuity-key `fnos-udp-qos` 关闭（结论修正完毕）；悬浮窗工作流仍归 macos-floating-widget。
