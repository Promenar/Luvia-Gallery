# 架构全景 (Architecture Overview)

## 移动端 (native-ui)

本项目移动端已由 React Native 迁移至 Android 原生 Kotlin 实现，采用 Jetpack Compose 构建 UI。

### 核心技术栈
- **UI 框架**: Jetpack Compose (100% 声明式 UI)
- **架构模式**: MVVM (Model-View-ViewModel) + UDF (Unidirectional Data Flow)
- **依赖注入**: Hilt (Dagger Hilt)
- **异步编程**: Kotlin Coroutines + Flow
- **网络层**: Retrofit 2 + OkHttp 3 + Kotlinx Serialization
- **导航**: Jetpack Navigation (Type-Safe routes)
- **图片加载**: Coil (Compose-first)
- **持久化**: DataStore (Preferences)
- **媒体播放**: Media3 (ExoPlayer)

### 模块结构
- `com.luvia.gallery.nativeui`
    - `ui`: UI 相关组件和界面
        - `theme`: 设计系统 (Color, Type, Theme)
        - `navigation`: 路由定义
        - `components`: 通用 UI 组件 (LuviaButton, LuviaTextField 等)
        - `screens`: 业务页面 (Login, Home, Gallery, Viewer 等)
    - `data`: 数据层
        - `model`: 数据模型 (Serializable)
        - `api`: Retrofit 接口定义与拦截器
        - `repository`: 业务仓库层
    - `di`: Hilt 模块定义
    - `util`: 工具类 (DataStoreManager 等)

### 关键设计点
- **动态服务器切换**: 通过 `DynamicUrlInterceptor` 实现，支持用户在登录时输入自定义后端地址。
- **类型安全导航**: 使用 Kotlin Serialization 定义路由类，避免字符串硬编码。
- **Stitch 设计对齐**: 严格遵循 Stitch 产出的设计令牌进行 UI 开发。

## 后端与 Web 端（v2）

### 代码结构
- `packages/contracts`：zod 定义的接口契约与事件类型，是前后端唯一事实源。
- `apps/server`：Node.js 24 + Fastify 5 + SQLite（WAL，`better-sqlite3`）。同一镜像提供两个进程入口：
  - `src/api/main.ts`：HTTP 接口、静态网页、SSE 事件流（`/api/v2/events`）与 v1 兼容接口。
  - `src/worker/main.ts`：持久化作业队列（扫描、元数据、缩略图、视频预览、HLS 转码、缓存淘汰、旧库导入、索引回填）、定时调度与实时监控运行时。
- `apps/web`：React 19 + Vite + Tailwind CSS v4 + Base UI，TanStack Router/Query/Virtual；`src/mocks` 为基于 msw 的离线开发数据。

### 进程协作
api 与 worker 共享同一个 SQLite 数据库，不直接通信。作业、租约、调度状态和变化事件都持久化在数据库中：worker 写入 `jobs`、`job_events`，api 轮询 `job_events` 推送 SSE，并按用户的目录权限过滤媒体库事件。可以运行多个 worker 实例，作业与监控均通过带过期时间的租约互斥。

### 媒体库实时监控
- 每个启用且未关闭监控的媒体库由一个 worker 持有监控租约（带代次，心跳续租，过期可被其它 worker 接管），运行一个 `WatchCoordinator`（`src/watch/**`）。失去租约后，旧持有者的写入被代次栅栏拒绝。
- 模式：`auto` 在本地文件系统用 inotify 递归监视，在网络文件系统或监视额度不足时改为轮询；`watch` 强制监视；`poll` 按间隔对账；`off` 关闭。
- 文件写入完成并稳定（目录静默 2 秒、文件稳定 3 秒）后立即入库并推送事件；随后在配对窗口内出现匹配的消失项时合并为移动，保留原媒体 ID。目录级变化做目录对账，溢出、监视异常、根目录恢复与轮询才请求全量对账。
- 索引写入使用独占 SQLite 连接，索引变更与 `library_changes` 变更记录在同一事务内提交；事件经持久队列节流，同库至多每 2 秒一条。
- 挂载保护：媒体库根目录的挂载身份由文件系统类型、来源和文件系统内路径组成。首次建立或身份变化时，对已有文件随机抽样（最多 200 个、至少 90% 匹配大小与修改时间）确认是同一份数据，否则状态降级，不扫描、不标记缺失。监控与全量扫描共用这一确认。
- 缺失文件进入删除宽限期（`missingGraceDays`，默认 7 天），在所有浏览与统计中隐藏，宽限期内重新出现即恢复；到期后清理关联与缓存。
- 兜底：每天按 `dailyAt`（默认 04:00，服务器本地时间）全量扫描，多 worker 只排队一次。

### 媒体处理
- 拍摄信息（尺寸、拍摄时间、相机、位置、视频编码）：每个媒体库一个后台作业，按设置 `workers.metadataConcurrency` 路并发读取（图片用 sharp + exifr，视频用 ffprobe），通过 `metadata_claims` 租约认领。认领顺序：先取 `metadata_priority` 中最近请求的文件（界面正在显示且缺宽高，网格格子经 `POST /api/v2/media/dimensions` 登记，10 分钟后过期），再沿 `files_library_metadata_recent` / `files_metadata_recent` 索引按修改时间从新到旧。前端每 2 秒询问一次在显示且缺宽高的格子，读到的宽高存入 `lib/dimension-cache.ts`，排布据此重新计算。打开媒体详情时若该文件尚未读取，api 当场读取后再返回；查看器对未读取的视频先取详情再决定直接播放或转码。
- 时间线可按文件修改时间（默认，扫描时即有）或拍摄时间排列，用户偏好 `timelineBasis`。修改时间分桶走部分覆盖索引 `files_present_modified`；拍摄时间分桶走触发器维护的 `timeline_counts`。网格的原始比例排布依赖拍摄信息里的宽高，读取前按正方形占位。
- 缩略图：浏览时按需生成；管理页“全库缩略图”排一个 `thumbnails` 作业（同一范围只排一个），按 id 分轮为全部照片与视频补齐网格用的 s、m 两个尺寸，缓存记录存在但文件丢失的删除记录后重新生成，并为浏览中的按需生成保留 2 个并发。生成缩略图时顺带记录原始宽高；缩略图齐全但缺宽高的文件单独读取。`dimensionsOnly` 模式（管理页“补全照片宽高”）只处理缺宽高的文件：尚未读取拍摄信息的先在 `metadata_claims` 认领再读取全部拍摄信息（磁盘开销相同），与后台拍摄信息作业不重复；已读取的图片只读文件头。缩略图与视频处理分别受 `thumbnailConcurrency`（1–64）与 `ffmpegConcurrency`（1–32）的跨进程槽位限制。
- 镜像设置 `UV_THREADPOOL_SIZE=64`，避免 sharp 与文件读写被 libuv 默认 4 线程限制。

### 部署
根目录 `docker-compose.yml` 定义 `api` 与 `worker` 服务，数据目录 `/data`、缓存目录 `/cache`、媒体目录只读挂载于 `/media`。`deploy/compose.fnos-dev.yml` 是 FNOS 开发调试覆盖文件（独立端口与数据目录，路径经环境变量提供）。
