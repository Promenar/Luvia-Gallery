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
- 挂载保护：媒体库根目录的挂载身份由文件系统类型、来源和文件系统内路径组成。首次建立或身份变化时，对已有文件随机抽样（最多 200 个、至少 90% 匹配大小与修改时间）确认是同一份数据，否则状态降级，不扫描、不标记缺失。监控与全量扫描共用这一确认。监控每 5 秒检查一次根目录，检查进程由常驻的子进程代理启动（不从 worker 直接 fork），时限 20 秒，超时按不可用处理；监控租约按 owner 与 token 续期，停顿导致过期但未被其它 worker 接管时继续持有，数据库暂时繁忙时跳过本轮，均不重启监控（重启会请求一次全量对账）。全量对账作业在 `jobs.message` 中写入已检查的目录数（每秒最多一次）。
- 全量对账写入：逐目录 `opendir` 并对媒体文件 `stat`，与库中记录比对；大小、修改时间、dev/ino、路径派生字段都没变的文件和目录只把 `scan_marker` 更新为本轮标记（已是本轮标记时不写），不整行重写，避免每轮改写十几个索引和全文索引；有变化的才走完整更新。列出目录后文件或目录消失（ENOENT/ENOTDIR）按不存在处理，不计读取错误；挂载整体消失由结束时的根目录检查判为错误。读取错误按阶段与错误代码汇总写入 worker 日志（不含路径）。
- 作业与扫描锁租约：过期只表示可被接管（`claim` 放回队列并换新令牌，扫描锁被新扫描者覆盖）；未被接管前，原持有者凭 owner 与令牌仍可续租、写断点和收尾，停顿超过租期不会把仍在执行的作业判为失败。同一 worker 进程内仍在执行的作业不会被本进程其它槽位接管（只允许其它进程接管），执行结束后才可被本进程重新领取。确认挂载时遇到作业中止、租约失效或数据库繁忙会原样抛出，只有挂载本身无法确认时才把媒体库标为降级。拍摄信息与全库缩略图的多路并发通道由 `worker/lanes.ts` 统一运行：任一路出错即中止其它路，并抛出最先发生的错误，数据库繁忙仍按暂时性错误放回队列。worker 槽位池每 2 秒读一次并发设置，队列为空时空闲槽位共享 0.5 秒的退避。
- 缺失文件进入删除宽限期（`missingGraceDays`，默认 7 天），在所有浏览与统计中隐藏，宽限期内重新出现即恢复；到期后清理关联与缓存。
- 兜底：每天按 `dailyAt`（默认 04:00，服务器本地时间）全量扫描，多 worker 只排队一次。

### 媒体处理
- 拍摄信息（尺寸、拍摄时间、相机、位置、视频编码）：每个媒体库一个后台作业，按设置 `workers.metadataConcurrency` 路并发读取（图片用 sharp + exifr，视频用 ffprobe），通过 `metadata_claims` 租约认领。认领顺序：先取 `metadata_priority` 中最近请求的文件（界面正在显示且缺宽高，网格格子经 `POST /api/v2/media/dimensions` 登记，10 分钟后过期），再沿 `files_library_metadata_recent` / `files_metadata_recent` 索引按修改时间从新到旧。前端每 2 秒询问一次在显示且缺宽高的格子，读到的宽高存入 `lib/dimension-cache.ts`，排布据此重新计算。打开媒体详情时若该文件尚未读取，api 当场读取后再返回；查看器对未读取的视频先取详情再决定直接播放或转码。
- 时间线可按文件修改时间（默认，扫描时即有）或拍摄时间排列，用户偏好 `timelineBasis`。修改时间分桶走部分覆盖索引 `files_present_modified`；拍摄时间分桶走触发器维护的 `timeline_counts`。网格的原始比例排布依赖拍摄信息里的宽高，读取前按正方形占位。文件夹、相册、收藏的媒体网格共用排序偏好 `mediaSort`（默认修改时间从新到旧，可选拍摄时间、文件名、文件大小）；含子文件夹且子树占全库一半以上时，列表查询沿对应排序索引遍历（`MediaReader.walksSortIndex`），翻页游标带可走索引的闭区间边界；收藏集合（收藏文件加收藏文件夹的媒体数估算）不到全库一半时，收藏范围先取出收藏集合的 rowid 再排序。
- 缩略图：浏览时按需生成；管理页“全库缩略图”排一个 `thumbnails` 作业（同一范围只排一个），按 id 分轮为全部照片与视频补齐网格用的 s、m 两个尺寸，缓存记录存在但文件丢失的删除记录后重新生成，并为浏览中的按需生成保留 2 个并发。生成缩略图时顺带记录原始宽高；缩略图齐全但缺宽高的文件单独读取。缓存目录中有可用的 1.x 缩略图（宽约 300 像素、短边不小于 192、不早于原文件且原文件大小与修改时间未变）时，s 直接从它缩放（不读原文件内容，原始宽高另行读取，图片只读文件头），m 跳过：浏览请求 m 时由 1.x 缩略图顶替并排队按需生成；作业结果的 `legacy` 计数为从 1.x 缩放的文件数。`dimensionsOnly` 模式（管理页“补全照片宽高”）只处理缺宽高的文件：尚未读取拍摄信息的先在 `metadata_claims` 认领再读取全部拍摄信息（磁盘开销相同），与后台拍摄信息作业不重复；已读取的图片只读文件头。缩略图与视频处理分别受 `thumbnailConcurrency`（1–64）与 `ffmpegConcurrency`（1–32）的跨进程槽位限制。
- 外部程序：ffprobe、ffmpeg 由常驻的小内存子进程代理（`worker/process-runner.ts`）启动，worker 启动时先拉起代理。Linux 启动子进程要复制父进程页表，在内存占用数 GB 的 worker 主线程里直接启动每次要数百毫秒到数秒；api 当场读取元数据时按需启动自己的代理。
- WAL 检查点：写连接关闭自动检查点（`wal_autocheckpoint=0`），由 worker 的后台线程每秒执行 PASSIVE 检查点，写回与 fsync 不落在 api、worker 主线程上；写回追平且 WAL 超过 64 MiB 时线程做一次不等待的 TRUNCATE（有读者即放弃，下一轮重试）。WAL 超过 256 MiB 时拍摄信息、缩略图与扫描作业在每个文件或批次前异步等待（`waitForWalCapacity`，最长 10 秒），回落到 64 MiB 以下恢复，避免持续写入让写回始终追不平而 WAL 无限增长。只运行 api 而不运行 worker 时 WAL 不会被写回。
- 数据库维护（worker 每 15 分钟，独立线程）：先做不占写锁的 PASSIVE 检查点，全部写回后才 TRUNCATE 截断 WAL；连接设置 `journal_size_limit` 为 64MB。作业遇到 SQLite 锁等待超时（`SQLITE_BUSY`/`SQLITE_LOCKED`）时放回队列从检查点继续，不判为失败。
- 镜像设置 `UV_THREADPOOL_SIZE=64`，避免 sharp 与文件读写被 libuv 默认 4 线程限制。

### 部署
根目录 `docker-compose.yml` 定义 `api` 与 `worker` 服务，数据目录 `/data`、缓存目录 `/cache`、媒体目录只读挂载于 `/media`。`deploy/compose.fnos-dev.yml` 是 FNOS 开发调试覆盖文件（独立端口与数据目录，路径经环境变量提供）。
