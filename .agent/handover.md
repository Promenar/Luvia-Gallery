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


## 2026-07-23T22:07:00+08:00 · 悬浮窗锁定回归修复 + 设置文案/网格范围调整

type: fix
scope: macos-widget/lock-settings-polish
status: done
tags: [macos, position-lock, regression, settings-ui, grid-snap]
continuity: resume
continuity-key: macos-floating-widget

### Summary

修复「锁定位置」按钮回归失效（原生拖动路径绕过 isLocked 守卫 + 启动时机问题），并按用户要求调整设置面板文案与网格大小范围。用户确认真机无问题。

### Changed

- `f7ce319` 锁定修复：`setLocked` 同步 `window.isMovable = !locked`（关闭 fullSizeContentView 下 AppKit 原生拖窗路径）；applicationDidFinishLaunching 按持久化 positionLocked 直接应用（同 1f67c5d 置顶修复模式）。回归矩阵四项（启动锁定/解锁/再锁/重启保持）实测通过。
- `b3a68dd` 设置面板：开关文案改为「置于顶层 / 开机自启 / 吸附网格」；网格大小滑块 60-140px 步进2 → 20-240px 步进10。逻辑零改动，DesktopGridSnap 纯取整数学对小网格无边界问题。

### Validation

- 两次 Debug BUILD SUCCEEDED；package_release.sh 打包；均已安装 /Applications 验签通过。
- 用户确认：没问题。

### Next

无；悬浮窗当前无已知问题。

### Risks

无新增。

### DIA

已同步 handover；registry 无变更。

### HLG

本条为 macos-floating-widget 工作流追加记录。


## 2026-07-26T20:39:39+08:00 · WebUI 可恢复导航候选完成

type: feature
scope: web/navigation
status: waiting
tags: [webui, navigation, history, viewport, cache, testing]
continuity: waiting
continuity-key: web-restorable-navigation

### Summary

完成 WebUI 浏览器式导航升级候选：统一目录、收藏夹、搜索、排序和媒体查看器的 History 状态，支持后退、前进、上一级、面包屑和回到顶部；网格、时间线与瀑布流均可按项目锚点恢复离开前位置。

### Changed

- 新增导航领域模型、History 控制器、会话快照存储与 `useGalleryNavigation`。
- 引入 TanStack Query，按服务端查询字段隔离缓存；旧请求写入受导航世代、位置键、请求所有权与取消信号约束。
- 重构 `VirtualGallery` 为三种布局视口适配器，普通滚动捕获与一次性恢复命令分离。
- 新增桌面和移动宽度导航栏、面包屑及前进后退状态。
- 建立 Vitest、Testing Library 与 jsdom 前端测试体系。

### Validation

- 委派实现阶段报告：前端测试 53/53 通过，Vite 生产构建通过。
- Sol 最终只读复审结论：GO，无发布阻断 findings。
- 主控独立回归、Git 推送与 FNOS 生产验证尚待执行。

### Next

- 主控运行完整前后端测试、生产构建和差异检查。
- 提交并推送远端 `main`，构建可回滚生产镜像后部署 FNOS。
- 以新的时间戳追加生产验证结果，不回写本条记录。

### Risks

- 随机排序尚无服务端稳定种子，缓存失效后顺序可能变化。
- 任意未加载媒体 ID 深链仍不支持定向加载。
- 瀑布流仍挂载全部已加载项目，数千项场景可能存在既有 DOM 性能上限。

### DIA

已同步 README、release_notes、project_memory、registry、正式实施计划与 handover；后端 API、数据库结构和部署配置无变化。

### HLG

已追加 `web-restorable-navigation` 候选完成记录；待生产闭环后追加结果记录。


## 2026-07-25T13:18:00+08:00 · Dock 隐藏/菜单栏入口/分屏记忆/点击穿透/WidgetKit 清理

type: feature
scope: macos-widget/desktop-widget-mode
status: done
tags: [macos, dock-hide, status-bar, per-display-frame, click-through, widgetkit-removal]
continuity: resume
continuity-key: macos-floating-widget

### Summary

悬浮窗 App 完成"桌面组件形态"系列：Dock 图标隐藏（默认启用）、菜单栏常驻入口、窗口位置按显示器分档记忆、点击穿透模式（含自锁交互修复），并彻底移除遗留 WidgetKit 扩展。用户明确放弃 WidgetKit 路线（结论：静态相框形态，最快约 5 分钟换图、无动画无视频无 hover，不平替）。

### Changed

- `63ca2df` Dock 隐藏：设置「窗口」组「隐藏 Dock 图标」开关，默认启用（UserDefaults 无键视为 true）；`AppDelegate.applyDockVisibility` 统一入口切换 `.accessory/.regular`（回显时附带 NSApp.activate）；accessory 下窗口交互/输入框焦点实测正常。
- `b13767a` 菜单栏入口：新增 `Services/StatusBarController.swift`（NSStatusItem，SF Symbol photo.on.rectangle），菜单：显示/隐藏悬浮窗（动态标题）、打开设置（.luviaShowSettings 通知展开面板）、退出。常驻无开关，accessory 下正常。
- `140ce26` 分屏记忆：windowFrame 单档 → displayFrames [displayID: frame]（NSScreenNumber/CGDirectDisplayID，跨重启稳定）；保存按窗口所在屏 key；启动 + didChangeScreenParametersNotification（防抖 0.5s）按所在屏恢复；该屏无存档保持现状不乱跳；旧单档自动迁移；80×40 可见性校验保留。单屏实测通过，多屏待用户真机验证。
- `9dc771c` 点击穿透初版 + WidgetKit 清理：`window.ignoresMouseEvents` 开关（默认关）；删除 GalleryWidgetExtension target/scheme/entitlements/源码 19 文件，工程回单 target，archive 无 PlugIns，包体 1.5M→1.3M；app group 保留（App 本体 ImageCache/TokenStore 在用）；README 重写。安装教训：ditto 覆盖旧目录残留 PlugIns 导致密封损坏，此后**先删旧 .app 目录再安装**。
- `abb6017` 穿透自锁修复：状态机改为「穿透生效 ⟺ 开关开 ∧ 设置面板收起」；WindowController 双输入单向入口 applyClickThroughState 统一重算（os_log 迁移记录）；showSettings 为面板状态唯一权威来源。六步交互矩阵 unified log 实测全过。
- 版本库清理：`xcuserdata/`（UserInterfaceState、xcschememanagement）移出跟踪并加 .gitignore。

### Validation

- 各 commit Debug/Release 构建通过，安装 /Applications 验签通过（63ca2df 起采用先删后装）。
- 穿透状态机、菜单栏菜单、Dock 切换均经 AX/unified log 实测。

### Next

- 用户真机验证：穿透模式日常体验、多显示器插拔各屏恢复。
- 可选节能优化（未做）：窗口隐藏时暂停轮播计时。
- 可选（未做）：ImageLoader 诊断 print 迁移 os_log（macOS 26 下 print/NSLog 不进统一日志）。

### Risks

accessory 模式下 CGEvent 合成事件不可达 App（macOS 限制，真实鼠标不受影响），自动化测试需用 AX API 代替。

### DIA

已同步 handover 与 macos-widget/README.md；registry 无变更。

### HLG

本条为 macos-floating-widget 工作流追加记录。


## 2026-07-26T20:46:53+08:00 · WebUI 可恢复导航生产发布完成

type: deployment
scope: web/navigation,fnos-production
status: done
tags: [webui, navigation, fnos, docker, production, rollback]
continuity: none
continuity-key: web-restorable-navigation

### Summary

WebUI 可恢复导航已提交远端并部署到 FNOS 生产。生产容器运行应用 revision `7ea6fd1` 对应镜像 `sha256:e96170819c85...`，稳定旧镜像保留为 `promenarleng/luvia-gallery:rollback-8e41927`。

### Changed

- 功能分支提交：`69a95c9 feat: add restorable web navigation`。
- 远端 `main` 应用提交：`7ea6fd1 feat: add restorable web navigation`。
- 早前委派 Agent 越权产生的部分提交 `d6b96b3` 已用正常 revert `8e41927` 恢复远端与生产；最终版本通过完整树差异重新应用，未使用强推。
- 候选镜像从 `7ea6fd1` 纯 Git 归档构建，切流前保留旧镜像回滚标签，再由 compose 强制重建单个服务。

### Validation

- 主控本地：Vitest 6 个文件、53/53 测试通过；Vite 生产构建通过；`git diff --check` 通过。
- 候选 Node 20 镜像：后端 Node 原生测试 16/16 通过。
- Sol 最终只读复审：GO，无发布阻断 findings。
- 生产：容器 running，restart=0，OOMKilled=false；首页、实际 JS、CSS 与 manifest 均返回 HTTP 200；近 10 分钟无 error/fatal/unhandled/OOM 日志。
- 短窗口资源：CPU 约 1.4%，内存约 89MiB/8GiB，22 PIDs。

### Next

无强制后续。建议用户在已有登录态下实际覆盖：父目录滚动位置恢复、A/B/C 后退前进、面包屑、媒体关闭返回、移动宽度，以及网格/时间线/瀑布流三种布局。

### Risks

- FNOS SSH 明确禁止 TCP 转发，内置浏览器与 Chrome 均无法通过本机隧道进入生产；因此鉴权后的真实目录交互未自动化验证，本次只确认生产页面壳层与静态资源可达。
- 随机排序尚无服务端稳定种子；任意未加载媒体深链仍不支持；瀑布流仍存在全量 DOM 的既有性能上限。
- 构建保留非阻断警告：主包约 600KB、`caniuse-lite` 数据过期、Vite CJS API 弃用。

### DIA

已同步 README、release_notes、project_memory、registry、正式实施计划、handover 与派生 handover-index；后端 API、数据库结构和部署配置无变化。

### HLG

已追加生产完成记录并关闭 `web-restorable-navigation` 连续工作流；未发现需要写入全局规则的新候选。


## 2026-07-26T20:57:05+08:00 · WebUI 导航栏冗余收口候选

type: fix
scope: web/navigation-ui
status: waiting
tags: [webui, navigation, header, folders, favorites, media-library]
continuity: waiting
continuity-key: web-navigation-ui-polish

### Summary

按生产截图反馈收口导航组件：完整地址栏仅在文件夹视图显示；移除子目录内容标题区中重复的返回按钮与当前目录标题；媒体库和收藏夹恢复简洁标题栏。

### Changed

- `App.tsx` 将 `GalleryNavigationBar` 渲染条件收窄为 `viewMode === 'folders'`。
- 删除桌面 header 中 `viewMode === 'folders' && currentPath` 的旧返回和目录标题块。
- 保留媒体库、收藏夹和文件夹根目录的现有 `h2` 标题。

### Validation

本轮未获测试或部署授权，未运行测试、构建或生产验证。

### Next

等待用户确认是否提交、推送并部署生产。

### Risks

纯条件渲染调整，不涉及 History、位置快照、查询缓存或数据请求逻辑；尚未进行浏览器视觉验证。

### DIA

已同步 release_notes 与 handover；README、registry、API、数据库和部署文档无变化。

### HLG

已追加 `web-navigation-ui-polish` 候选记录；提交或部署后应以新时间戳追加结果。


## 2026-07-26T21:05:17+08:00 · WebUI 导航栏冗余收口生产发布完成

type: deployment
scope: web/navigation-ui,fnos-production
status: done
tags: [webui, navigation, header, fnos, docker, production]
continuity: none
continuity-key: web-navigation-ui-polish

### Summary

导航栏冗余收口已提交远端并部署 FNOS：完整地址栏仅在文件夹视图显示，子目录不再重复展示返回按钮与当前目录标题，媒体库和收藏夹保持简洁标题栏。

### Changed

- 应用提交：`4c506f8 fix: remove redundant web navigation headers`。
- 生产镜像：`sha256:8a63e9b90008...`，revision `4c506f8`。
- 切流前生产镜像已保留为 `promenarleng/luvia-gallery:rollback-7ea6fd1`。

### Validation

- 前端 Vitest 6 个文件、53/53 通过。
- Vite 生产构建通过，`git diff --check` 通过。
- 候选 Node 20 镜像内后端测试 16/16 通过。
- 生产容器 running，restart=0，OOMKilled=false，内存约 86MiB；首页与新 JS 资源均返回 HTTP 200；近期无错误日志。

### Next

无强制后续；由用户在已有登录态下确认文件夹、媒体库和收藏夹三类页面的最终视觉布局。

### Risks

保留既有构建警告：主包约 600KB、`caniuse-lite` 数据过期、Vite CJS API 弃用。本次为条件渲染调整，不影响 History、位置快照和查询缓存。

### DIA

已同步 release_notes、handover 与 handover-index；README、registry、API、数据库和部署配置无变化。

### HLG

已追加生产完成记录并关闭 `web-navigation-ui-polish` 工作流；无新的长期规则候选。


## 2026-07-26T23:07:30+08:00 · WebUI 统一浏览器式工具栏候选完成

type: feature
scope: web/navigation-ui,web/navigation-domain
status: waiting
tags: [webui, omnibox, navigation, search, sort, layout, responsive]
continuity: waiting
continuity-key: unified-gallery-toolbar

### Summary

完成统一浏览器式工具栏候选：媒体库、收藏夹和文件夹使用平行地址，地址、作用域搜索、媒体筛选、排序和布局收敛为单行固定工具栏，无上下文内容时不再保留第二行。

### Changed

- `GalleryLocation.view` 保持唯一空间判别；非文件夹位置在 URL、History、位置键和 History state 构造边界清除陈旧 `folderPath/path`。
- 桌面工具栏整合历史导航、面包屑、搜索状态、筛选、排序和布局；1024px 以下使用紧凑工具栏并保留移动侧栏入口。
- 搜索草稿与已提交状态分离：Enter 提交 push，Escape/取消不提交，已提交搜索可见且可清除。
- 排序、筛选和布局继续使用 replace，不污染后退历史。
- 长路径折叠中间节点并保留当前节点；`image` 筛选在桌面和移动菜单均有正确语义。

### Validation

- Spark 领域测试：位置模型与控制器 28/28 通过。
- Gemini 组件施工后由 Terra 完成 App 集成与阻断修复。
- 主控独立前端测试 6 个文件、76/76 通过；Vite 生产构建通过；`git diff --check` 通过。
- Sol 三轮严格复审最终结论：GO，无剩余 P0/P1/P2 发布阻断。

### Next

- 提交功能分支并以最终树差异应用到远端 `main`。
- 构建 Node 20 候选镜像，运行后端测试并部署 FNOS。
- 生产切流后追加新时间戳结果记录。

### Risks

- 移动菜单尚未实现方向键逐项导航，基础 aria、Escape 和点击操作可用。
- 构建保留既有主包超过 500kB、`caniuse-lite` 数据过期和 Vite CJS API 弃用警告。
- 未在已登录真实图库中完成自动化视觉验收，生产部署后需用户最终确认布局。

### DIA

已同步 README、release_notes、project_memory、registry、正式实施计划与 handover；后端 API、数据库和部署配置无变化。

### HLG

已追加 `unified-gallery-toolbar` 候选记录；发现并已沉淀项目级长期决策到 project_memory，无需写入全局规则。

## 2026-07-26T23:11:54+08:00 · 统一图库工具栏生产部署完成

- type: deployment
- scope: web/navigation-ui,web/navigation-domain,fnos-production
- status: done
- tags: navigation,toolbar,history,responsive,fnos,production
- continuity: none
- continuity-key: unified-gallery-toolbar

### Summary

统一浏览器式工具栏已完成实施、审阅、推送并部署到 FNOS 生产环境。媒体库、收藏夹与文件夹现在使用平行位置模型，地址导航、搜索、筛选、排序和视图控制统一收纳；桌面端在 1024px 及以上展示完整工具栏，移动端使用紧凑单容器布局。

### Changed

- 应用提交：`218d617 feat: unify gallery navigation toolbar`。
- 生产镜像：`sha256:ee3a95777ffe95698887bef390985fa6a265a9128a74b1fec82f174dd17f6615`，revision 标签为 `218d617`。
- 回滚镜像：`promenarleng/luvia-gallery:rollback-4c506f8`，镜像 ID 为 `sha256:8a63e9b90008122497f3176bfb98f4f57e46583435a02805e21b792c2abb1843`。

### Validation

- 前端测试：6 个文件、76/76 通过。
- 本地与 FNOS 候选镜像前端构建通过；`git diff --check` 通过。
- FNOS 候选镜像内后端测试：16/16 通过；FTS 报错为事务回滚用例的预期输出。
- Sol 严格审阅最终结论：GO，无遗留 P0/P1/相关 P2。
- 生产容器：running=true、restart=0、OOM=false；验收时内存约 92.2 MiB。
- 生产首页、实际 JS、实际 CSS、manifest 均返回 HTTP 200；近 10 分钟错误关键词扫描为 none。
- FNOS 禁止 SSH TCP 转发，因此无法自动化执行需登录真实图库数据的浏览器视觉回归；已用生产静态资源与容器运行态证据完成发布验收，真实内容交互仍建议人工观察。

### Next

- 无阻断后续。可在真实图库中重点观察长路径折叠、移动端更多菜单与历史位置恢复体验。

### Risks

- 移动端更多菜单尚未实现方向键逐项导航，属于非阻断可访问性增强项。
- 主 JS 包仍超过 500 kB，构建存在既有分包提示；与本次导航改造无直接回归关系。

### DIA

- 已同步 README、release_notes、project_memory、registry、实施计划与 handover。

### HLG

- 已追加本次生产部署完成记录；handover-index 随后由标准脚本重建。

## 2026-07-26T23:23:05+08:00 · 统一工具栏瞬时激活态修复候选

type: bugfix
scope: ["web/navigation-ui"]
status: waiting
tags: ["webui", "toolbar", "outside-click", "focus", "escape"]
continuity: waiting
continuity-key: unified-gallery-toolbar
record-fingerprint: e17672f17444f6b3b82e3409cf4ad501b409b42e43bc2123545740db2ad5fbb2

### Summary
修复统一导航栏搜索与菜单的瞬时激活态无法通过点击页面其它区域自动取消的问题。

### Changed
统一搜索、筛选、排序、布局和移动端更多菜单的关闭入口；外部 pointerdown 与 Escape 可关闭瞬时态，菜单互斥；外部点击会移除工具栏内鼠标焦点外观，快捷键搜索复用同一互斥入口；持久筛选、排序和布局值保持不变。

### Validation
Spark 完成组件与测试修改，主控静态复核外部点击、焦点清理、快捷键互斥和测试断言；受当前上级执行约束限制，本轮未运行测试、构建或页面 smoke。

### Next
如需发布，先取得测试授权并运行前端测试与构建，再提交推送和部署 FNOS。

### Risks
尚未执行自动测试；双响应式实例和真实浏览器焦点行为仍需运行态验证。

### DIA
已同步 release_notes；README、project_memory 与 registry 的现有说明仍准确，无需改写。

### HLG
通过用户级 HLG Skill 的 append 命令追加本候选记录并自动重建索引。

## 2026-07-26T23:26:20+08:00 · 统一工具栏瞬时激活态修复生产部署完成

type: deployment
scope: ["web/navigation-ui", "fnos-production"]
status: done
tags: ["webui", "toolbar", "outside-click", "focus", "escape", "fnos", "production"]
continuity: none
continuity-key: unified-gallery-toolbar
record-fingerprint: 11f3384b80f8c5ba6be14f251f7a519866cab2b7b147e1087aaf85b4e4046d5b

### Summary
统一工具栏瞬时激活态修复已完成测试、构建、提交推送并部署到 FNOS 生产环境。

### Changed
应用提交为 4ae9621；生产镜像为 sha256:83b0fe1f9defd27e70b2e61c748595b8dbc6d4254bbcacebafbe2164249e85be，revision 为 4ae9621；上一生产镜像保留为 promenarleng/luvia-gallery:rollback-218d617。

### Validation
前端测试 6 个文件、81/81 通过；本地和 FNOS 候选生产构建通过；git diff --check 通过；候选镜像内后端测试 16/16 通过；生产容器 running=true、restart=0、OOM=false，验收时内存约 90.1 MiB；首页、实际 JS、实际 CSS 和 manifest 均返回 HTTP 200；近 10 分钟错误关键词扫描为 none。

### Next
建议用户在真实图库页面确认搜索、筛选、排序、布局和移动端更多菜单的外部点击取消体验。

### Risks
未自动执行登录态真实图库浏览器交互；主 JS 包仍有既有的超过 500 kB 分包提示。

### DIA
已同步 release_notes 与 handover，README、project_memory 和 registry 的现有说明仍准确。

### HLG
通过用户级 HLG Skill 的 append 命令追加生产部署完成记录并自动重建索引。

## 2026-07-27T00:35:28+08:00 · 统一工具栏悬浮菜单遮挡修复候选

type: bugfix
scope: ["web/navigation-ui"]
status: waiting
tags: ["webui", "toolbar", "stacking-context", "z-index", "overlay"]
continuity: waiting
continuity-key: unified-gallery-toolbar
record-fingerprint: 55eb904b885a6e3da89c12077139887c89e341aa652df9a49eb9c4ae1e449bf8

### Summary
修复统一导航栏右侧筛选、排序、布局等悬浮菜单被下方媒体卡片遮挡并无法操作的问题。

### Changed
统一工具栏外层建立 relative z-[35] 全局层级，高于媒体卡片 z-30，低于侧栏 z-40、查看器和模态 z-50、系统层 z-60；桌面与移动导航根使用 isolate 建立局部层叠上下文，关闭遮罩为 z-10，菜单面板为 z-20。

### Validation
Spark 完成最小补丁和静态回归断言；主控根据用户截图复核遮挡现象，并扫描项目全局 z-index，否决会盖住模态框的 190/205/210 初版，收敛到 30/35/40/50/60 安全层级；受当前上级执行约束限制，本轮未运行测试、构建或真实浏览器 smoke。

### Next
取得授权后运行前端测试与生产构建；验证通过后可提交推送并部署 FNOS，再由用户在真实图库确认菜单点击。

### Risks
尚未执行运行态验证；固定层级表具有项目级复用价值，但未经用户授权未写入 project_memory 或长期规则。

### DIA
已同步 release_notes；README、registry 与现有架构说明无需修改。

### HLG
通过用户级 HLG Skill 的 append 命令追加候选记录并自动重建索引；层级表作为长期规则候选仅记录提醒，未擅自沉淀。

## 2026-07-27T00:38:54+08:00 · 统一工具栏悬浮菜单遮挡修复生产部署完成

type: deployment
scope: ["web/navigation-ui", "fnos-production"]
status: done
tags: ["webui", "toolbar", "stacking-context", "z-index", "overlay", "fnos", "production"]
continuity: none
continuity-key: unified-gallery-toolbar
record-fingerprint: c2abe7aec0eaebc084b877f414243b0ad98cb73ec372e9e754d2863e568d2bbe

### Summary
统一工具栏悬浮菜单遮挡修复已完成测试、构建、提交推送、项目层级规范沉淀并部署到 FNOS 生产环境。

### Changed
应用提交为 7b09b3e；生产镜像为 sha256:56ead4bea2a609a5dbdaec58c58cd79de90768603d95c25e3f6a7f1a06ffc9d2，revision 为 7b09b3e；上一生产镜像保留为 promenarleng/luvia-gallery:rollback-4ae9621；安全层级表已获用户授权沉淀至 .agent/project_memory.md。

### Validation
前端测试 6 个文件、82/82 通过；本地和 FNOS 候选生产构建通过；git diff --check 通过；候选镜像内后端测试 16/16 通过；生产容器 running=true、restart=0、OOM=false，验收时内存约 89.85 MiB；首页、实际 JS、实际 CSS 和 manifest 均返回 HTTP 200；近 10 分钟错误关键词扫描为 none。

### Next
建议用户在真实图库中确认筛选、排序、布局和移动端更多菜单均显示在媒体卡片上方，并确认图片查看器仍覆盖工具栏。

### Risks
未自动执行登录态真实图库浏览器视觉交互；主 JS 包仍有既有的超过 500 kB 分包提示。

### DIA
已同步 release_notes、project_memory 与 handover；README 和 registry 现有内容仍准确。

### HLG
通过用户级 HLG Skill 的 append 命令追加生产部署完成记录并自动重建索引；项目层级表已按用户明确授权沉淀。

## 2026-07-27T00:44:17+08:00 · 统一工具栏悬浮菜单毛玻璃背景修复候选

type: bugfix
scope: ["web/navigation-ui"]
status: waiting
tags: ["webui", "toolbar", "glass", "backdrop-blur", "readability"]
continuity: waiting
continuity-key: unified-gallery-toolbar
record-fingerprint: c10ff0adb2e5e7157d13275556efe2e57888b3faeb7893948d18817939f36f91

### Summary
修复统一导航栏悬浮菜单背景全透明、媒体图片透穿导致文字可读性差的问题。

### Changed
桌面筛选、排序、布局和移动端更多菜单统一从无效的 bg-surface-secondary/90 或 /95 改为主题感知的 bg-surface-secondary，并将模糊增强为 backdrop-blur-2xl；保留既有 z-20、圆角、边框、阴影和布局。

### Validation
Spark 完成四个菜单类名与回归断言修改；主控核对 Tailwind 配置及 CSS 变量，确认 surface-secondary 自身已是 rgba(...,0.85)，斜杠透明度修饰与直接 var 颜色定义不兼容；静态复核四个入口均使用有效背景与增强模糊，层级未变。受当前上级执行约束限制，本轮未运行测试、构建或真实浏览器 smoke。

### Next
取得授权后运行前端测试与生产构建；验证通过后可提交推送并部署 FNOS，再由用户确认实际毛玻璃可读性。

### Risks
尚未执行运行态视觉验证；不同浏览器对 backdrop-filter 的性能和渲染存在差异，但有效半透明底色可在模糊不可用时提供可读性兜底。

### DIA
已同步 release_notes；README、project_memory 与 registry 无需修改。

### HLG
通过用户级 HLG Skill 的 append 命令追加候选记录并自动重建索引。

## 2026-07-27T00:46:19+08:00 · 统一工具栏悬浮菜单毛玻璃背景修复生产部署完成

type: deployment
scope: ["web/navigation-ui", "fnos-production"]
status: done
tags: ["webui", "toolbar", "glass", "backdrop-blur", "readability", "fnos", "production"]
continuity: none
continuity-key: unified-gallery-toolbar
record-fingerprint: 681cb1190d9bf7861bbda4e920fdedfed445c9e97f46c9ce50d43db07534ee31

### Summary
统一工具栏悬浮菜单毛玻璃背景修复已完成测试、构建、提交推送并部署到 FNOS 生产环境。

### Changed
应用提交为 6386caa；生产镜像为 sha256:134a79a9d6614467f434249adbd84b59488b2f8fefeab10986e9fffc08c52ead，revision 为 6386caa；上一生产镜像保留为 promenarleng/luvia-gallery:rollback-7b09b3e。

### Validation
前端测试 6 个文件、82/82 通过；本地和 FNOS 候选生产构建通过；git diff --check 通过；候选镜像内后端测试 16/16 通过；生产容器 running=true、restart=0、OOM=false，验收时内存约 91.76 MiB；首页、实际 JS、实际 CSS 和 manifest 均返回 HTTP 200；近 10 分钟错误关键词扫描为 none。

### Next
建议用户在真实图库中确认四类菜单的半透明底色、毛玻璃模糊和文字可读性。

### Risks
未自动执行登录态真实图库浏览器视觉交互；主 JS 包仍有既有的超过 500 kB 分包提示。

### DIA
已同步 release_notes 与 handover；README、project_memory 和 registry 现有内容仍准确。

### HLG
通过用户级 HLG Skill 的 append 命令追加生产部署完成记录并自动重建索引。

## 2026-07-27T03:37:12+08:00 · 媒体查看器关闭后恢复最新浏览进度修复候选

type: bugfix
scope: ["web/navigation", "web/viewport"]
status: waiting
tags: ["webui", "history", "scroll-restore", "media-viewer", "regression"]
continuity: waiting
continuity-key: web-restorable-navigation
record-fingerprint: 009142f303f00ee92083fe0c726e8143022f2300a52f37774e3b5f4f98c75372

### Summary
已完成本地修复候选：解决文件夹视图在任意位置打开图片或视频后，关闭查看器总是返回同一旧位置的问题。根因包含媒体 History push 前未同步固化最新视口、延迟节流样本覆盖即时快照，以及恢复命令按位置键或时间戳去重导致不同 History 条目混淆。

### Changed
新增三种图库布局的同步视口捕获接口；媒体打开前写入严格递增的即时快照；受管 History 条目使用独立恢复命令 token 与 entry identity，空快照显式回顶；旧 token 不能消费新命令；Grid、Timeline、Masonry 的恢复事务与 items 更新解耦并清理 pending 样本；Masonry 保持有界可见锚点采样并在失败时安全退化为当前 scrollTop；收紧快照损坏值校验；补充 controller、hook、viewport 与 App 导航竞态测试；release_notes.md 已增加用户可见修复说明。

### Validation
完成 Spark 初始只读定位、Terra 实施及 Sol 多轮严格只读审查；针对条目权威恢复、同 key popstate、空快照 reset、同毫秒碰撞、恢复 timer 竞态、Masonry 陈旧锚点和测试断言逐轮修正，最终独立审查结论为 GO。本轮尚未运行 Vitest、TypeScript/构建或真实浏览器回归，因此不能声明测试通过。

### Next
获得继续授权后运行导航与视口定向测试、完整前端测试和生产构建；通过后提交推送，按 FNOS 既有发布流程部署候选并验证目录深滚动、连续打开关闭图片与视频、同路径前进后退以及三种布局恢复。

### Risks
新增 token/timer 协议与测试尚未实际执行；真实浏览器下异步分页、虚拟列表实例变化及 Masonry 重排时序仍需运行态验收。当前未提交、未推送、未部署，不影响生产环境。

### DIA
用户可见导航恢复行为发生变化，已同步 release_notes.md；无数据库、API、环境变量或部署配置变更，README 与架构文档现有描述仍成立。

### HLG
已按 web-restorable-navigation continuity 追加本候选状态；发现条目级恢复命令与媒体打开前同步捕获可作为长期架构规则候选，未经用户明确授权未写入 project_memory、AGENTS.md 或其它长期规则。

## 2026-07-27T03:49:46+08:00 · 媒体浏览进度恢复修复已发布至 FNOS 生产

type: release
scope: ["web/navigation", "web/viewport", "fnos/production"]
status: done
tags: ["webui", "history", "scroll-restore", "media-viewer", "deployment", "fnos"]
continuity: none
continuity-key: web-restorable-navigation
record-fingerprint: 8e80e28497b6ce15f6f7ad7820ff51d4a088610f3141760d55bb4ccd1b3895ec

### Summary
修复提交 ef62851 已推送至 origin/main，并部署到 FNOS 生产容器 luvia-gallery。文件夹视图现在会在打开图片或视频前同步固化最新视口，以独立 History 条目恢复命令返回真实浏览位置，避免延迟样本和同路径条目混淆导致总回到固定旧位置。

### Changed
生产使用隔离归档目录 /vol2/1000/APPDATA/Lumina/.deploy/ef62851 构建候选镜像 promenarleng/luvia-gallery:candidate-ef62851；候选镜像提升为 latest 并通过 Compose 强制重建服务。原生产镜像已保留为 promenarleng/luvia-gallery:rollback-6386caa，未触碰存在未知未提交改动的共享构建工作树。

### Validation
定向前端回归 48/48 通过，完整前端测试 95/95 通过；Node 20 builder 容器内后端测试 16/16 通过；本机及 FNOS Docker 生产构建成功；候选镜像通过 Node 20、runner/server 语法、better-sqlite3 内存数据库和前端产物检查。生产镜像为 sha256:ee445389465897110f619df91465de43deccbd304b79feede4a511ea8ec36335，容器 running、restart_count=0、OOM=false、内存约 124MiB，近两分钟无错误日志；FNOS 本机与 Tailscale 100.72.176.103:9980 首页及 assets/index-gw42RPzl.js 均返回 HTTP 200。全仓 tsc --noEmit 仍被既有 utils/animation.ts 中 JSX 使用 .ts 扩展名的解析错误阻断，Vite 生产构建和相关测试不受影响。

### Next
建议用户在已登录生产 WebUI 中分别用网格、时间线和瀑布流深度滚动后连续打开/关闭图片与视频，确认主观交互；若浏览器仍加载旧 Service Worker 资源，执行一次强制刷新。

### Risks
自动测试已覆盖同步捕获、同路径多 History 条目、空快照 reset、恢复 timer 竞态及媒体关闭回退，但本次发布过程未代替用户登录态下的大媒体库人工长时间浏览。共享构建仓库原有 1 项未知未提交变更保持原样，发布未使用也未覆盖该工作树。

### DIA
用户可见导航恢复行为已同步 release_notes.md；无数据库、API、环境变量、Compose 或存储结构变更。

### HLG
已记录测试、构建、提交、推送、隔离部署、生产验收和回滚指针。本工作流当前无已知阻塞后续；条目级恢复命令与媒体打开前同步捕获仍是长期架构规则候选，未经用户明确授权未写入 project_memory、AGENTS.md 或其它长期规则。

## 2026-07-28T19:46:05+08:00 · 布局偏好记忆与瀑布流间距修复候选

type: bugfix
scope: ["web/navigation", "web/layout", "web/gallery"]
status: waiting
tags: ["webui", "layout-preference", "masonry", "timeline", "history"]
continuity: waiting
continuity-key: web-layout-preference
record-fingerprint: c747c6c73251fc3d9912efbd1f128eea78f7979a3fba5fe5550ac97760d350ee

### Summary
已形成本地修复候选：解决网格/瀑布流设置重新打开后总回标准网格的问题；当前版本隐藏不具备百万级能力且存在假生效状态的时间轴入口；瀑布流横纵间距统一为 16px。

### Changed
新增按 window.location.origin、currentUser.username 与 all/favorites/folders 语义视图命名空间隔离的布局偏好模块；受管 History 与显式 URL 优先于本地偏好；旧 luvia_layout_mode 仅一次迁移合法 grid/masonry 并无条件消费，timeline 统一规范化为 grid。冷启动在绘制前应用偏好，用户主动切换语义视图时将目标 scope 偏好写入新 History 条目，popstate 不读取 localStorage。导航菜单和 VirtualGallery 不再暴露 Timeline，底层 Timeline 代码保留供未来服务端时间桶能力使用。PhotoCard 移除非网格 mb-6，间距仅由 Masonry gap-4 控制。补充偏好、跨账号迁移、scope 切换、timeline 规范化、导航栏与卡片间距测试。

### Validation
完成 Terra 写入实现、主控单次 diff 审计与 Sol 两轮严格只读审查；首轮发现 scope 切换、legacy 残留和旧 Timeline 测试问题，修正后最终审查结论为 GO。本轮按当前授权尚未运行 Vitest、构建、类型检查或浏览器交互验证，不能声明测试通过。

### Next
获得继续授权后运行布局偏好与导航定向测试、完整前端测试和生产构建；通过后再提交推送并按 FNOS 隔离候选流程部署。

### Risks
当前仅隐藏 Timeline 入口，未建设百万级时间轴所需的服务端年月桶、稳定时间游标和客户端窗口化；真实异步认证首帧、Service Worker 冷启动与三语义视图连续切换仍需运行态验证。

### DIA
用户可见布局记忆、时间轴可达性和瀑布流间距发生变化，已同步 release_notes.md；无数据库、API、环境变量或部署配置变更。

### HLG
已按 web-layout-preference continuity 追加候选状态。百万级时间轴能力门禁可作为长期架构规则候选，未经用户明确授权未写入 project_memory、AGENTS.md 或架构文档。

## 2026-07-28T19:50:35+08:00 · 布局偏好与瀑布流间距修复已发布至 FNOS

type: release
scope: ["web/navigation", "web/layout", "web/gallery", "fnos/production"]
status: done
tags: ["webui", "layout-preference", "masonry", "timeline", "deployment", "fnos"]
continuity: none
continuity-key: web-layout-preference
record-fingerprint: 0787db868a95295df8822726fef03de200cf67731003750aa89d2d3cba8a0777

### Summary
修复提交 f05d935 已推送至 origin/main 并部署到 FNOS 生产。网格与瀑布流偏好现在按服务器、用户和 all/favorites/folders 语义视图独立记忆，显式 URL 与 History 保持权威；当前不具备百万级能力的时间轴入口已隐藏，旧 timeline 状态统一回退标准网格；瀑布流横纵间距统一为 16px。

### Changed
新增布局偏好命名空间、旧 luvia_layout_mode 一次迁移与跨账号消费逻辑；冷启动绘制前应用偏好，主动切换语义视图时将目标 scope 布局写入新 History 条目，popstate 不读取 localStorage。导航菜单与 VirtualGallery 不再暴露 Timeline，底层 Timeline 源码保留。PhotoCard 移除额外 mb-6。生产从隔离目录 /vol2/1000/APPDATA/Lumina/.deploy/f05d935 构建 promenarleng/luvia-gallery:candidate-f05d935，并提升为 latest；上一生产镜像保留为 rollback-ef62851。

### Validation
定向前端测试 101/101 通过，完整前端测试 104/104 通过；本机和 FNOS Vite 生产构建成功，新资源为 assets/index-CkqGVeXS.js；候选镜像通过 Node 20、runner/server 语法、better-sqlite3 内存数据库和前端产物检查。生产镜像为 sha256:11c1213ad2b9933bcb548b289324aea6c0f923668ba261fec60698563b4d3fd4，容器 running、restart_count=0、OOM=false，FNOS 本机与 Tailscale 100.72.176.103:9980 首页及新资源均返回 HTTP 200，近两分钟无错误日志。

### Next
建议用户在生产 WebUI 中分别切换媒体库、收藏夹和文件夹的网格/瀑布流，刷新或重新打开后核对各自偏好；检查瀑布流卡片纵横间距；若浏览器仍加载旧 Service Worker，执行一次强制刷新。

### Risks
本次仅隐藏 Timeline 入口，未建设百万级时间轴所需的服务端年月桶、稳定时间游标和客户端窗口化。自动测试覆盖逻辑与组件协议，但发布流程未代替用户登录态下的真实跨页面冷启动主观验收。

### DIA
用户可见布局记忆、时间轴可达性和瀑布流间距已同步 release_notes.md；无数据库、API、环境变量、Compose 或存储结构变更。

### HLG
已记录实现、审查、测试、提交、隔离部署、生产验收和 rollback-ef62851 回滚指针。本工作流当前无已知阻塞后续；百万级时间轴能力门禁仍是长期架构规则候选，未经用户明确授权未写入 project_memory、AGENTS.md 或架构文档。

## 2026-07-28T22:32:49+08:00 · 搜索范围统一与残留查询故障修复待验证

type: maintenance
scope: ["Luvia-Gallery", "frontend", "backend", "search"]
status: in_progress
tags: ["search", "navigation", "pagination", "fts5", "path-security"]
continuity: waiting
continuity-key: search-contract-production-fix
record-fingerprint: c85d1645ba07d23595c83ec5603f8647b92b139d48c0b7610fedd89c94d1b400

### Summary
已完成搜索状态、递归范围、收藏查询、分页边界与路径授权修复的代码写入；当前等待用户授权执行测试、构建和生产前验证。

### Changed
前端顶级视图切换清除旧 q，文件夹仅在搜索时递归并隐藏未筛选目录卡片，搜索空态提供清除入口；后端收藏夹改为直接收藏文件的统一分页查询，query/count 共用条件，限制 limit 1..500，安全处理 FTS 普通文本与路径前缀边界；新增前后端回归测试源码；同步 release_notes.md。

### Validation
按当前会话门禁未运行测试、构建、类型检查或生产部署；生产现场此前已通过清除残留 q 恢复 907825 条媒体显示，但新代码尚未验证。

### Next
取得用户明确授权后运行定向测试、完整前端测试、后端契约测试与构建；验证通过后再决定提交、推送和 FNOS 生产部署。

### Risks
新 database.js/server.js 查询重构尚未执行语法与行为验证；普通文件夹卡片仍显示直属媒体计数，本批未做递归计数以避免百万库 N+1 风险。

### DIA
已同步 release_notes.md；registry 注册的 docs/API.md 当前不存在，未创建替代文档。

### HLG
通过用户级 HLG Skill 以 waiting continuity 追加本记录并重建索引。

## 2026-07-28T22:42:39+08:00 · 搜索范围与查询安全修复已发布 FNOS 生产

type: release
scope: ["Luvia-Gallery", "frontend", "backend", "fnos-production"]
status: done
tags: ["search", "navigation", "pagination", "fts5", "path-security", "deployment"]
continuity: none
continuity-key: search-contract-production-fix
record-fingerprint: 5d277fe8ebeec4e3aed014d3bb3fb47dd4b0d5b48dbb58052e6fed1c05ab174b

### Summary
搜索残留假故障、三视图搜索范围、收藏查询分页、FTS 普通文本与路径授权边界修复已验证、提交、推送并部署至 FNOS 生产。

### Changed
发布提交 16e5982；生产候选与实际镜像均为 sha256:91cdaccb720b75dd03ae68f479a6c01b4f1650ad5a1e51f64593552cd5baa8f9，前端资源 index-BdeQIC0l.js；旧镜像保留为 promenarleng/luvia-gallery:rollback-16e5982-pre。

### Validation
Node 20 后端测试 24/24、前端测试 107/107 通过，Vite 构建成功；候选旁路容器首页与资源 200；生产容器首页与资源 200，镜像摘要一致，restart=0、OOM=false、内存约 88 MiB，数据库初始化和 CUDA 检测成功。

### Next
观察实际全库、收藏夹和目录递归搜索行为；普通文件夹卡片仍显示直属媒体计数，如需递归计数应另做批量聚合方案，避免百万库 N+1。

### Risks
深 OFFSET 与随机分页仍是百万级长期性能议题；本轮未引入文件夹递归计数。

### DIA
已更新 release_notes.md 为已验证并发布状态；docs/API.md 注册但不存在，未创建替代文档。

### HLG
追加本次完成记录关闭 search-contract-production-fix continuity；保留等待记录作为审计历史。

## 2026-07-28T23:06:53+08:00 · 目录搜索、封面可靠性与交互态视觉修复

type: maintenance
scope: ["Luvia-Gallery", "web", "backend"]
status: done
tags: ["search", "folder-cover", "fts5", "visual-state"]
continuity: waiting
continuity-key: luvia-gallery-production-release
record-fingerprint: 40795feeb91cab5064c437ec049daa0cc9f07b027ef50798a9219193dc39a814

### Summary
已补齐文件夹视图的目录搜索结果，修复部分目录封面空白，并移除鼠标点击后残留的高对比白色状态边框。

### Changed
前端合并目录与递归媒体搜索结果，封面 URL 变化时复位错误状态；后端新增受权限、父路径和 100 条上限约束的 FTS 目录查询，目录封面改由数据库索引递归选择；交互状态统一为弱强调色并保留键盘 focus-visible。

### Validation
Node 20 后端测试 31/31、前端测试 110/110 通过，Vite 生产构建成功。

### Next
等待用户确认是否提交、推送并部署至 FNOS 生产环境。

### Risks
目录搜索依赖已完成扫描的文件 FTS 索引，因此没有任何已索引媒体后代的空目录不会出现在搜索结果中；尚未进行生产数据冒烟。

### DIA
已同步 release_notes.md；无数据库结构、部署配置或架构文档影响。

### HLG
通过标准 append 流程追加本记录并重建派生索引；未发现需要沉淀的长期规则。

## 2026-07-28T23:29:25+08:00 · 目录搜索与封面修复已发布至 FNOS

type: release
scope: ["Luvia-Gallery", "production", "FNOS"]
status: done
tags: ["deployment", "folder-search", "folder-cover", "FNOS"]
continuity: none
continuity-key: luvia-gallery-production-release
record-fingerprint: 88a370df411a8eb802a1a1704e01b0efc0c28cd0f95febd2e2037da3d44fb48b

### Summary
提交 26d4cce 已推送并部署至 FNOS 生产环境。

### Changed
从提交精确归档构建 candidate-26d4cce，旁路冒烟后将原生产镜像保存为 rollback-26d4cce-pre，并通过 Compose 强制重建生产容器。

### Validation
候选镜像内后端测试 31/31；生产首页、JS、CSS 与 manifest 均 HTTP 200；实际镜像 sha256:48fb1256c53cb3a773deb5b7f3615f669678a5eec571b5f64c7371b29f88454e，revision 26d4cce，restart 0，OOM false，切换时内存约 86.9 MiB，错误扫描为空，CUDA 验证成功。

### Next
用户可在真实媒体库验证目录名称搜索、深层媒体文件夹封面和鼠标点击态视觉；若浏览器仍显示旧资源，强制刷新 Service Worker 缓存。

### Risks
目录搜索依赖现有 FTS 文件索引；无已索引媒体后代的空目录不会返回。原生产镜像已保留，可按 rollback-26d4cce-pre 回滚。

### DIA
已更新 release_notes.md 的生产发布状态。

### HLG
本记录关闭 luvia-gallery-production-release 连续工作流；无新增长期规则候选。

## 2026-07-29T20:23:52+08:00 · WebUI 媒体缩略图悬浮缩放开关

type: feature
scope: ["web/settings", "web/gallery"]
status: done
tags: ["webui", "settings", "thumbnail", "motion", "accessibility"]
continuity: none
record-fingerprint: 9a241ebba7945da2959856f7951d58efa65b527d735d897b9ec0f2cfb6b01e3a

### Summary
WebUI 常规设置新增媒体缩略图悬浮缩放开关，默认保持开启；关闭后图片、视频和音频媒体卡片不再因光标悬浮放大，偏好在浏览器本地持久化并即时生效。

### Changed
新增独立偏好模块与 luvia_media_hover_zoom 键；App 将设置状态透传至 VirtualGallery、Grid/Masonry viewport、PhotoCard 与 AudioCard。PhotoCard 门控 Framer Motion 卡片缩放和图片 scale-105，AudioCard 门控 scale-[1.02]；memo 比较器纳入开关。FolderCard、修复按钮、媒体信息浮层和视频悬浮预览未改。设置页增加中英文可访问 switch；浏览器验收发现并修复滑块缺少 left-0 导致关闭态视觉位置错误。

### Validation
主控复核 git diff 与 git diff --check；定向 Vitest 7/7 通过，Vite 生产构建成功。隔离静态 WebUI 中验证开关默认开启、点击后 aria-checked=false、滑块从右侧 24px 移至左侧 4px、重载后仍为关闭。完整前端测试 114/116：两个既有 app-navigation-flow 用例在重复 vi.unstubAllGlobals 后 localStorage 为 undefined，失败位于 LanguageContext 与 fileUtils，与本功能断言无关。

### Next
如后续需要生产发布，按既有 FNOS 隔离候选、回滚镜像和生产读回流程执行；本次用户未要求提交、推送或部署。

### Risks
当前 TimelineViewport 未接入 VirtualGallery 运行路由，因此未透传此开关；若未来重新启用时间轴布局，需要同步接入 mediaHoverZoomEnabled。完整前端测试仍有两个既有 localStorage 桩清理故障待单独修复。

### DIA
已同步 release_notes.md、docs/STITCH-DESIGN-GUIDE.md 与其 stitch-design 源文档；无数据库、API、服务端配置、环境变量或部署变更。

### HLG
按 append-only 标准记录本次实现、验证、已知测试故障和未来 Timeline 接入风险；未发现需要沉淀为长期规则的新候选。

## 2026-07-29T23:41:24+08:00 · FNOS 偶发断联与页面内容缺失根因诊断

type: diagnostic
scope: ["fnos-production"]
status: done
tags: ["performance", "event-loop", "folder-cover", "sqlite", "proxy", "production"]
continuity: resume
continuity-key: fnos-folder-cover-stall
record-fingerprint: 33a488df976c97427ff61d227ccc23057dbfcc84210ebd20dc8d7d9a64325b51

### Summary
已确认本次两类症状的共同主因：GET /api/library/folders 处理包含大量直属子目录的目录时，为每个子目录同步执行一次递归封面 SQL，冻结 Node 主事件循环。2026-07-29 20:13:38 左右的生产请求触发 523.7 秒事件循环延迟，期间监督代理对 / 与 /sw.js 多次记录空闲超时。

### Changed
本轮仅进行只读生产诊断；未重启容器、未修改生产配置或业务代码。此前 WebUI 媒体悬浮缩放开关已提交并推送至 main，提交为 636e22b。

### Validation
生产容器运行约 24 小时、重启 0、OOM false；Mac 到 100.72.176.103:9980、FNOS 宿主 127.0.0.1:9980、容器监督端口 3001 和应用端口 3002 当前探测均为 200。生产 server.js、database.js、runner.js SHA-256 与本地完全一致。问题目录包含 235 个直属子目录；只读 SQL EXPLAIN 选择 idx_media_type 并使用临时 B-Tree 排序，单次递归封面查询实测 2.24 至 2.30 秒，235 次累计与 523.7 秒冻结相符。

### Next
将目录列表的 N 次同步递归封面查询改为有界批量或预计算封面方案，并为匹配查询补索引与查询计划测试；增加请求级耗时日志、轻量健康检查和前端 fetch 超时/可见错误状态。修复后在 235 子目录真实规模下验证目录接口延迟，并同步压测 /、/api/config、3001 与 3002。

### Risks
修复尚未实施，访问大目录仍可再次冻结全站约数分钟。仅增加代理超时不能消除根因，只会更快断开客户端；简单并行执行 better-sqlite3 同步查询也会继续阻塞事件循环。前端手写 fetch 缺少超时且吞掉目录请求错误，会把服务端阻塞表现为永久转圈或外壳空内容。

### DIA
本轮无业务代码、接口或生产配置变更；仅新增 HLG 诊断记录及派生索引。

### HLG
已使用标准 append 流程记录诊断，后续沿用 continuity-key fnos-folder-cover-stall。

## 2026-07-30T00:32:04+08:00 · FNOS 目录封面阻塞修复已发布至生产

type: release
scope: ["Luvia-Gallery", "FNOS", "production"]
status: done
tags: ["deployment", "performance", "folder-cover", "sqlite", "observability"]
continuity: none
continuity-key: fnos-folder-cover-stall
event-period: 2026-07-29/2026-07-30
record-fingerprint: 9d5e6e6ba291d7df3fa0d231e24be66ac20b20111d5679d5948955d4c6b17f88

### Summary
已修复大目录列表逐子目录递归封面查询导致 Node.js 主事件循环冻结的问题，并将慢请求最小化日志随提交 1dd3e59 发布至 FNOS 生产。此前同一请求约阻塞 523.7 秒；生产修复后真实鉴权接口为 116ms。

### Changed
数据库新增 queryFolderCovers：按规范化目录去重，显式使用 idx_folder_path，以目录自身等值和带分隔符的半开后代范围选择最新图片或视频，并把结果回填原始路径键。目录搜索、收藏夹和普通目录三条路由均在权限收窄后一次调用该批量入口。新增超过 1000ms 的 finish/close 慢请求日志，只记录 method、req.path、status、duration 和 outcome。发布镜像同时包含 WebUI 媒体缩略图悬浮缩放开关。

### Validation
Node 20 后端测试 36/36 通过，Vite 生产构建成功；前端 114/116，两个既有失败均来自测试撤销 localStorage 桩。候选镜像 sha256:982396a4bd5d483f85f8bf5facc55da2337dee3e36d93e727ec377211917958d 使用生产数据库一致性副本和相同媒体只读挂载验证：目录接口 200、235 项、122ms，并发健康请求全部 200。生产切换后同接口 116ms，并发健康最慢 110ms；FNOS 宿主、容器 3001/3002、外部地址和真实浏览器登录页均正常，revision 为 1dd3e599221fd20058d664480475aa10b5eb02e5，restart 0、OOM false，日志无慢请求或应用错误。

### Next
按日常运维观察慢请求与事件循环日志；如未来慢存储使目录 stat/readdir 成为新瓶颈，再将目录计数和修改时间迁移到索引数据或有界异步 I/O。可另行补真实 Express 权限集成测试、动态媒体路由模板化日志及 Windows 根路径和 Unicode 专项测试。

### Risks
目录路由仍会为每个子目录同步读取基础文件系统信息，但 235 目录生产实测满足小于 1 秒门禁。完整前端测试仍有两个既有 localStorage 桩清理故障。部署前镜像已保留为 promenarleng/luvia-gallery:rollback-1dd3e59-pre，可在发现回归时恢复。

### DIA
已同步 release_notes.md、.agent/project_memory.md、.agent/registry.md、实施计划与生产发布状态；无 API 响应、数据库结构、环境变量或 compose 配置变更。

### HLG
通过标准 append dry-run 与 apply 追加本记录并重建派生索引，关闭 continuity-key fnos-folder-cover-stall。目录封面索引范围查询与慢请求最小化日志已记录在项目记忆，未发现需要进一步写入全局规则的新候选。

## 2026-07-30T01:18:25+08:00 · macOS 每显示器位置 V2 已安装

type: release
scope: ["Luvia-Gallery", "macOS-widget", "local-install"]
status: done
tags: ["macOS", "display", "window-placement", "release", "installation"]
continuity: waiting
continuity-key: macos-per-display-placement-v2
event-period: 2026-07-29/2026-07-30
record-fingerprint: 22f05e274171bcb24bc9b0f2ea910b26ef78f56d924d8d87c68d292e1310d662

### Summary
已将 macOS 悬浮相册的窗口位置记忆升级为按物理显示器分档的 V2，并完成 Release 打包、签名校验、安全替换 /Applications 中的现有应用和启动读回。

### Changed
窗口位置改为目标屏 visibleFrame 内的归一化横向和顶部比例加尺寸；系统主屏按 NSScreen.screens.first 及 Resolver 最终键识别。内置屏使用 vendor/model，外接屏优先 vendor/model/serial，无 serial 时使用名称与物理尺寸；不可信或冲突身份只存进程内。删除 CG UUID 和不可靠的旧数字键迁移；屏幕重配置、延迟保存、网格吸附、隐藏与退出统一防止临时 frame 污染。新增 SwiftPM 核心测试入口、13 个回归测试和 .build 忽略规则。

### Validation
主控复跑 Swift 测试 13/13 通过，Xcode Debug BUILD SUCCEEDED，独立复审最终 Ready for packaging: Yes。Release archive 成功，arm64/x86_64 通用二进制和 Apple Development 签名校验通过；zip SHA-256 为 26cca54fb5b3f4a199a52bf17a42407f32f539ebabd7624f00e1fa9289d5d41b。新应用已从 /Applications 启动为 PID 23229，安装二进制 SHA-256 与包内一致，并写入当前 GS49UK 外接屏的 display-v2 指纹档案。

### Next
用户在同时连接内置屏和外接屏时，分别放置不同位置和尺寸，再执行外接屏与内置屏双向主屏切换及重启验收；确认后可追加关闭本 continuity 的记录。若发现异常，保留安装前 zip 与废纸篓中的旧 .app 可回滚。

### Risks
当前机器安装时只有 GS49UK 活动屏，未完成真实双屏 AppKit 通知时序验证。serial=0 的外接屏使用名称和物理尺寸作为最佳努力指纹，系统命名变化可能导致重新校准；两台完全同型号无 serial 的冲突屏只保证当前进程内分档。极低概率非法 visibleFrame 会安全拒绝恢复，但同键后续通知不主动重试。

### DIA
已同步 macos-widget/README.md、release_notes.md、.agent/project_memory.md、registry 与实施计划。

### HLG
按标准 append 流程记录实现、复审、打包、安装、回滚位置与待真实双屏验收状态；新增项目级技术决策，无需沉淀到全局规则。

## 2026-07-30T01:50:08+08:00 · macOS 在线目录可视化选择器实施与安装

type: implementation
scope: ["macos-widget", "remote-folder-browser"]
status: done
tags: ["macos", "folder-browser", "swiftui", "release"]
continuity: none
event-date: 2026-07-30
record-fingerprint: 63b2575e6d1115c7057e48025703f61c89574aa517f54fd6effa12c0b2bcac98

### Summary
已将 macOS 悬浮相册在线文件夹模式从手输路径升级为权限安全的可视化目录选择器，并重新打包、替换 /Applications 中的应用。

### Changed
新增目录请求核心、响应兼容解码、会话缓存与请求代次状态机、可观察 ViewModel 和原生 SwiftUI 选择 Sheet；设置面板改为只读路径与浏览入口。目录请求只调用 /api/library/folders，并仅通过 Authorization Bearer 发送 Token。空白 Token、虚拟根和空 folderPath 均失败关闭；旧响应、取消请求和重复导航不会污染当前状态。本地目录选择流程保持不变。

### Validation
Swift 核心测试 28/28 通过；Xcode Debug clean build 和 Release archive 成功；Release 为 arm64/x86_64 通用包且 Apple Development 签名有效。新包已安装到 /Applications/LuviaGalleryWidget.app，从该路径启动后进程正常，安装后二进制哈希与 Release 包一致。运行时已读回在线文件夹模式的只读路径和浏览入口；为避免未经单独授权再次传输已保存 Token，本轮未点击发起真实鉴权目录请求。

### Next
用户可在应用中主动点击浏览，确认生产服务器返回的授权目录层级与实际账号权限一致。

### Risks
真实生产 Token 的目录接口端到端读回未在本轮自动执行；现有 ImageLoader 和 CarouselCard 仍有本功能之外的 Swift 6 兼容警告。安装前应用已同时备份为 zip，并保留在废纸篓中的可恢复 app。

### DIA
已同步 macos-widget/README.md、release_notes.md、.agent/project_memory.md、.agent/registry.md 与实施计划。

### HLG
已通过标准 HLG append 流程追加本记录并重建派生索引；未发现需要另行沉淀至全局规则或 Skill 的候选长期规则。

## 2026-07-30T18:38:44+08:00 · Android Compose 原生重构第一阶段

type: implementation
scope: ["mobile-native-rewrite", "native-ui"]
status: in_progress
tags: ["android", "kotlin", "compose", "material3", "migration"]
continuity: resume
continuity-key: mobile-native-rewrite
record-fingerprint: fedf6d3a71e273bd51b8612a2a8a3ea628d6d8a61f38112faef6bba1950b202d

### Summary
已忽略旧 Android 骨架并从零完成 Phase 1：可构建的五模块 Kotlin/Compose 工程、安全登录网络层、Material 3 登录页和明确标注为迁移中的主壳。生产移动端仍以 mobile/ 的 Expo/React Native 实现为准，原生端尚不可替代发布。

### Changed
保持 applicationId com.promenar.luvia；锁定 AGP 9.0.1、Gradle 9.1.0、Kotlin 2.4.10、Compose BOM 2026.06.00、compile/target 36、min 26。新增 core:model、core:network、core:designsystem、feature:auth；认证使用 suspend Retrofit、唯一 Bearer Header、稳定 ApiResult 与不泄漏敏感值的地址/响应处理。新增动态色 MD3 主题、UDF LoginViewModel、edge-to-edge 登录页和安全区主壳。

### Validation
工程约束回归 7 项通过；core:network 单元测试 15 项通过；feature:auth 单元测试 6 项通过；AndroidTest Kotlin 编译、lintDebug、assembleDebug 通过。当前 adb 无连接设备，因此 Compose instrumentation 测试未实际运行，不能作为真机通过证据。

### Next
下一阶段先实现 Android Keystore 支持的会话持久化和恢复，再迁移首页、图库、文件夹、收藏与 Paging/Room 数据链路；启用删除、EXIF 和管理功能前，先加固后端路径权限和幂等收藏契约。

### Risks
登录成功后的 Session 当前只存在于进程内状态，尚未加密持久化；HTTP 地址可通过语法解析但发行 Manifest 不允许全局明文流量，应使用 HTTPS；尚无真机或模拟器 UI 运行证据；图库、媒体、设置和管理功能均未实现。

### DIA
已同步 README、release_notes.md、docs/ARCHITECTURE.md、.agent/registry.md 与第一阶段实施计划，纠正了历史上全面重构完成及无证据性能指标等失实描述。

### HLG
本记录建立 mobile-native-rewrite 连续工作流，continuity 为 resume；后续阶段按同一 continuity-key 追加，不回写历史记录。

## 2026-07-30T18:44:21+08:00 · 勘误：Android Compose Phase 1 会话与 Bearer 接线边界

type: correction
scope: ["mobile-native-rewrite", "native-ui"]
status: in_progress
tags: ["android", "authentication", "correction"]
continuity: resume
continuity-key: mobile-native-rewrite
record-fingerprint: 891ddc9f44feb1a69440fea652c35aa9d376903dae6bbb28e743d1d7952dc8c0

### Summary
勘误 2026-07-30T18:38:44+08:00 的第一阶段记录：登录成功后并未保存 Session/token，仅在 LoginViewModel 内保留 isAuthenticated 布尔态。

### Changed
README、release_notes.md 与 docs/ARCHITECTURE.md 已改为精确描述；AuthHeaderInterceptor 已实现并测试，但尚未接入后续认证客户端。

### Validation
对照 LoginViewModel 成功分支与客户端构造代码复核；Task 4 独立审查准确指出原记录高估了会话与 Bearer 接线完成度。

### Next
下一阶段先保存 Session/token，并接入使用唯一 Bearer Header 的认证客户端；随后再实现 Android Keystore 支持的加密持久化与会话恢复。

### Risks
当前主壳的已认证状态只是进程内布尔值，不代表已具备可用于后续 API 请求或应用重启恢复的会话。

### DIA
已同步 README、release_notes.md 与 docs/ARCHITECTURE.md 的认证边界描述。

### HLG
本记录以同一 continuity-key 追加勘误，不回写或删除原交接记录。
