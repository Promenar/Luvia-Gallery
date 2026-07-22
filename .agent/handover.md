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
