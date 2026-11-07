import { z } from 'zod';
import { IsoDateTime } from './common.ts';
import { Role, User } from './auth.ts';

/** 以下接口均要求 admin 角色，否则 403。 */

/** GET /api/v2/admin/overview */
export const AdminOverview = z.object({
  version: z.string(),
  uptimeSec: z.number(),
  /** missing：文件已从磁盘消失、仍在删除宽限期内的媒体数（不计入 total）。 */
  media: z.object({ total: z.number().int(), images: z.number().int(), videos: z.number().int(), audio: z.number().int(), missing: z.number().int() }),
  /** coverage 为 0–1。 */
  thumbnails: z.object({ coverage: z.number(), missing: z.number().int() }),
  metadata: z.object({ indexed: z.number().int(), total: z.number().int() }),
  previews: z.object({ ready: z.number().int(), total: z.number().int() }),
  cache: z.object({ bytes: z.number(), limitBytes: z.number() }),
  database: z.object({ bytes: z.number() }),
  health: z.object({
    eventLoopP99Ms: z.number(),
    apiP95Ms: z.number(),
    queueDepth: z.number().int(),
    /** 最近 60 分钟、每分钟一个点。 */
    series: z.object({ eventLoopP99Ms: z.array(z.number()), apiP95Ms: z.array(z.number()), queueDepth: z.array(z.number()) }),
  }),
  lastScanAt: IsoDateTime.nullable(),
  activeJobs: z.number().int(),
});
export type AdminOverview = z.infer<typeof AdminOverview>;

export const LibraryStatus = z.enum(['ok', 'slow', 'unavailable', 'scanning']);

/**
 * 实时监控模式。auto：本地文件系统用 inotify 实时监视，NFS/CIFS/FUSE 等网络挂载或监视额度不足时改为轮询；
 * watch：强制实时监视（额度不足时仍降级并给出原因）；poll：按 pollIntervalSec 定期对账；off：只靠手动与定时扫描。
 * 事件只作为“目录有变化”的提示，worker 按目录对账后落库；实时监控只在 worker 进程运行。
 */
export const WatchMode = z.enum(['auto', 'watch', 'poll', 'off']);
export const LibraryWatch = z.object({
  mode: WatchMode,
  /** 轮询对账间隔，60–86400 秒，默认 300。 */
  pollIntervalSec: z.number().int().min(60).max(86400),
  /** 当前实际状态。starting 为正在建立监视；degraded 为请求 watch 但只能轮询或部分目录无法监视。 */
  state: z.enum(['starting', 'watching', 'polling', 'degraded', 'off']),
  /** 已建立监视的目录数；未监视时为 null。 */
  watchedDirs: z.number().int().nullable(),
  lastEventAt: IsoDateTime.nullable(),
  lastReconcileAt: IsoDateTime.nullable(),
  /** 降级原因（中文，面向管理员），例如“网络文件系统 cifs 不支持实时事件，已改为每 5 分钟对账”。 */
  degradedReason: z.string().nullable(),
});
export type LibraryWatch = z.infer<typeof LibraryWatch>;
const LibraryWatchPatch = z.object({ mode: WatchMode, pollIntervalSec: LibraryWatch.shape.pollIntervalSec }).partial();
export const Library = z.object({
  id: z.string(),
  name: z.string(),
  /** 容器内绝对路径（仅管理员可见）。 */
  root: z.string(),
  /**
   * 挂载点在宿主机上的路径。auto 为 worker 启动时从 /proc/self/mountinfo 的 bind mount 来源识别；
   * manual 为管理员填写（识别结果不准或经过多层挂载时）；无法识别为 null。
   */
  hostRoot: z.string().nullable(),
  hostRootSource: z.enum(['auto', 'manual']).nullable(),
  /** 排除规则（目录名或相对路径的 glob），默认 ['@eaDir', '#recycle', '.*', '.thumbnails']。 */
  exclude: z.array(z.string()),
  status: LibraryStatus,
  mediaCount: z.number().int(),
  lastScanAt: IsoDateTime.nullable(),
  enabled: z.boolean(),
  watch: LibraryWatch,
});
export type Library = z.infer<typeof Library>;
/** GET /api/v2/admin/libraries；POST 新增；PATCH /:id；DELETE /:id（只删除索引，不触碰文件） */
export const LibraryList = z.object({ libraries: z.array(Library) });
export const CreateLibraryBody = z.object({
  name: z.string().trim().min(1).max(80),
  /** 必须位于某个已挂载目录之内（见 GET /api/v2/admin/mounts），否则 400。 */
  root: z.string().min(1),
  enabled: z.boolean().default(true),
  hostRoot: z.string().min(1).nullable().optional(),
  exclude: z.array(z.string().min(1).max(200)).max(100).optional(),
  /** 省略时 mode=auto、pollIntervalSec=300。 */
  watch: LibraryWatchPatch.optional(),
});
export const UpdateLibraryBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  /** 传 null 恢复自动识别。 */
  hostRoot: z.string().min(1).nullable().optional(),
  exclude: z.array(z.string().min(1).max(200)).max(100).optional(),
  watch: LibraryWatchPatch.optional(),
});

/**
 * GET /api/v2/admin/libraries/:id/changes?limit=：worker 落库的最近变更（最新在前，默认 100 条，保留最近 30 天）。
 * moved 表示识别为同一文件的移动或改名（保留媒体 ID、收藏与相册关系）；missing 表示文件消失、进入删除宽限期；
 * restored 表示宽限期内重新出现；removed 表示宽限期结束后清理。目录级变化以 isDir=true 记录一条，不逐个展开子项。
 */
export const LibraryChange = z.object({
  ts: IsoDateTime,
  kind: z.enum(['added', 'updated', 'moved', 'missing', 'restored', 'removed']),
  /** 媒体库内相对路径；moved 时为新路径。 */
  path: z.string(),
  /** moved 时的旧路径，其它为 null。 */
  fromPath: z.string().nullable(),
  isDir: z.boolean(),
  mediaId: z.string().nullable(),
  source: z.enum(['watch', 'poll', 'scan']),
});
export const LibraryChangeList = z.object({ changes: z.array(LibraryChange) });

/**
 * GET /api/v2/admin/mounts：容器内可见的挂载目录（解析 /proc/self/mountinfo）。
 * 新挂载目录不会自动建立索引（除非 settings.libraries.autoEnableNewMounts=true），由管理员在控制台确认启用。
 * kind：library 已是媒体库；candidate 可启用；system 为 DATA_DIR、CACHE_DIR 等系统目录，不可启用；
 * other 为 /proc、/etc/hosts 等与媒体无关的挂载，前端默认折叠。
 */
export const Mount = z.object({
  containerPath: z.string(),
  hostPath: z.string().nullable(),
  kind: z.enum(['library', 'candidate', 'system', 'other']),
  libraryId: z.string().nullable(),
  readOnly: z.boolean(),
  /** 浅层抽样估计的媒体文件数（只读取前两层目录，最多 2 秒），无法估计为 null。 */
  mediaEstimate: z.number().int().nullable(),
});
export const MountList = z.object({ mounts: z.array(Mount) });

/** GET /api/v2/admin/fs?path=：目录选择器，仅列子目录；path 省略时列出允许挂载的根（MEDIA_ROOT 各项）。 */
export const FsListing = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  dirs: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type FsListing = z.infer<typeof FsListing>;

export const AdminSettings = z.object({
  siteName: z.string(),
  /** 对外访问地址，例如 http://192.168.1.20:3000；生成分享链接、客户端配置与二维码时使用。null 时前端用当前页面地址。 */
  publicUrl: z.string().url().nullable(),
  libraries: z.object({
    autoEnableNewMounts: z.boolean(),
    /** 文件消失后保留记录（收藏、相册、缩略图）的天数，0–365，默认 7；0 表示下一次对账即清理。 */
    missingGraceDays: z.number().int().min(0).max(365),
  }),
  /** 是否向普通用户显示宿主机真实路径（管理员总能看到）。 */
  folders: z.object({ exposeHostPaths: z.boolean() }),
  /**
   * 全量对账（兜底实时监控遗漏）。daily 为每天 dailyAt（服务器本地时间 HH:MM，默认 04:00）；
   * interval 为每 intervalMinutes 分钟；manual 只在手动、worker 启动与监视异常时执行。默认 daily。
   */
  scan: z.object({
    mode: z.enum(['manual', 'interval', 'daily']),
    intervalMinutes: z.number().int().min(15).max(10080),
    dailyAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  workers: z.object({
    /** 缩略图并发，1–64；全库批量生成时始终为浏览中的按需生成保留 2 个。 */
    thumbnailConcurrency: z.number().int().min(1).max(64),
    /** FFmpeg 全局并发（缩略图抽帧、预览、转码共享），1–32。 */
    ffmpegConcurrency: z.number().int().min(1).max(32),
    /** 每个后台元数据作业同时读取的文件数，1–64。 */
    metadataConcurrency: z.number().int().min(1).max(64),
  }),
  transcode: z.object({ enabled: z.boolean(), hwaccel: z.enum(['auto', 'none', 'nvenc', 'vaapi', 'qsv']) }),
  previews: z.object({ enabled: z.boolean() }),
  cache: z.object({ limitGB: z.number().min(1).max(10000) }),
});
export type AdminSettings = z.infer<typeof AdminSettings>;
/** GET /api/v2/admin/settings；PATCH 同结构的部分字段（深度合并），返回完整设置。 */
export const AdminSettingsPatch = z.object({
  siteName: z.string().trim().min(1).max(80),
  publicUrl: z.string().url().nullable(),
  libraries: AdminSettings.shape.libraries.partial(),
  folders: AdminSettings.shape.folders.partial(),
  scan: AdminSettings.shape.scan.partial(),
  workers: AdminSettings.shape.workers.partial(),
  transcode: AdminSettings.shape.transcode.partial(),
  previews: AdminSettings.shape.previews.partial(),
  cache: AdminSettings.shape.cache.partial(),
}).partial();

export const JobType = z.enum(['scan', 'metadata', 'thumbnails', 'previews', 'health_check', 'cache_prune', 'import_legacy']);
export type JobType = z.infer<typeof JobType>;
export const JobStatus = z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatus>;
export const Job = z.object({
  id: z.string(),
  type: JobType,
  /** 中文显示名，例如“扫描 照片库”。 */
  label: z.string(),
  status: JobStatus,
  progress: z.object({ done: z.number().int(), total: z.number().int().nullable() }),
  /** 当前步骤简述，例如“正在处理 2024 旅行/京都”。 */
  message: z.string().nullable(),
  error: z.string().nullable(),
  /** 结果摘要，例如 { added: 312, removed: 4 }。 */
  result: z.record(z.string(), z.number()).nullable(),
  trigger: z.enum(['manual', 'schedule', 'system']),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  /** 预计剩余秒数；无法估计为 null。 */
  etaSec: z.number().nullable(),
});
export type Job = z.infer<typeof Job>;
/** GET /api/v2/admin/jobs?status=&limit=（最近优先；运行中与排队的总在前） */
export const JobList = z.object({ jobs: z.array(Job) });
export const MediaFailureSource = z.object({ size: z.number().int().nonnegative(), modifiedAt: z.number().int(), generation: z.number().int().nonnegative() });
export const MediaFailure = z.object({
  id: z.string(), mediaId: z.string(), libraryId: z.string(), name: z.string(), folder: z.string(),
  operation: z.string(), source: MediaFailureSource, failures: z.number().int(), ignored: z.boolean(),
  category: z.enum(['missing', 'permission', 'decode', 'storage', 'unknown']), errorCode: z.string().optional(),
  reason: z.string(), lastFailedAt: z.string(),
});
export type MediaFailure = z.infer<typeof MediaFailure>;
export const MediaFailureList = z.object({ items: z.array(MediaFailure), nextCursor: z.string().nullable(), total: z.number().int().nonnegative(), counts: z.object({ ignored: z.number().int().nonnegative(), unignored: z.number().int().nonnegative() }) });
export type MediaFailureList = z.infer<typeof MediaFailureList>;

/**
 * 删除原文件。confirm 必须显式为 true；operationId 由客户端生成，重试必须复用同一个值。
 * source 是管理员在界面上看到的乐观并发令牌，服务器仍会重新校验路径、文件身份与写权限。
 */
export const DeleteMediaBody = z.object({
  confirm: z.literal(true),
  source: MediaFailureSource,
  operationId: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();
export type DeleteMediaBody = z.infer<typeof DeleteMediaBody>;
export const DeleteMediaResult = z.object({
  operationId: z.string(),
  /** deleted：文件与索引都已处理；pending：文件已删除但索引清理待重试。 */
  status: z.enum(['deleted', 'pending']),
});
export type DeleteMediaResult = z.infer<typeof DeleteMediaResult>;
/** POST /api/v2/admin/jobs */
export const CreateJobBody = z.object({ type: JobType, libraryId: z.string().optional() }).strict();
/** POST /api/v2/admin/jobs/:id/:action，action ∈ pause|resume|cancel|retry → Job */
export const JobAction = z.enum(['pause', 'resume', 'cancel', 'retry']);

/** GET/POST/PATCH/DELETE /api/v2/admin/users[/:id] */
export const UserList = z.object({ users: z.array(User) });
export const CreateUserBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(256),
  role: Role.default('user'),
  allowedPaths: z.array(z.string()).nullable().default(null),
});
export const UpdateUserBody = z.object({
  role: Role.optional(),
  allowedPaths: z.array(z.string()).nullable().optional(),
  /** 管理员重置密码；会使该用户全部会话失效。 */
  password: z.string().min(8).max(256).optional(),
});

/** GET /api/v2/admin/logs?level=&limit=：内存环形缓冲中的最近日志（默认 200 条），不含敏感字段。 */
export const LogEntry = z.object({
  ts: IsoDateTime,
  level: z.enum(['debug', 'info', 'warn', 'error']),
  source: z.enum(['api', 'worker']),
  msg: z.string(),
  ctx: z.record(z.string(), z.unknown()).nullable(),
});
export const LogList = z.object({ logs: z.array(LogEntry) });

/** GET /api/v2/admin/system */
export const SystemInfo = z.object({
  version: z.string(),
  commit: z.string().nullable(),
  node: z.string(),
  platform: z.string(),
  sqlite: z.string(),
  ffmpeg: z.object({ available: z.boolean(), version: z.string().nullable(), hwaccels: z.array(z.string()) }),
  sharp: z.object({ version: z.string(), heif: z.boolean() }),
  dataDir: z.string(),
  cacheDir: z.string(),
  /** Linux inotify 额度（/proc/sys/fs/inotify/max_user_watches，按真实用户 ID 共享）与本服务已用监视数；非 Linux 为 null。 */
  inotify: z.object({ maxUserWatches: z.number().int(), used: z.number().int() }).nullable(),
});
export type SystemInfo = z.infer<typeof SystemInfo>;
