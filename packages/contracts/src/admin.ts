import { z } from 'zod';
import { IsoDateTime } from './common.ts';
import { Role, User } from './auth.ts';

/** 以下接口均要求 admin 角色，否则 403。 */

/** GET /api/v2/admin/overview */
export const AdminOverview = z.object({
  version: z.string(),
  uptimeSec: z.number(),
  media: z.object({ total: z.number().int(), images: z.number().int(), videos: z.number().int(), audio: z.number().int() }),
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
export const Library = z.object({
  id: z.string(),
  name: z.string(),
  /** 容器内绝对路径（仅管理员可见）。 */
  root: z.string(),
  status: LibraryStatus,
  mediaCount: z.number().int(),
  lastScanAt: IsoDateTime.nullable(),
  enabled: z.boolean(),
});
export type Library = z.infer<typeof Library>;
/** GET /api/v2/admin/libraries；POST 新增；PATCH /:id；DELETE /:id（只删除索引，不触碰文件） */
export const LibraryList = z.object({ libraries: z.array(Library) });
export const CreateLibraryBody = z.object({ name: z.string().trim().min(1).max(80), root: z.string().min(1), enabled: z.boolean().default(true) });
export const UpdateLibraryBody = z.object({ name: z.string().trim().min(1).max(80).optional(), enabled: z.boolean().optional() });

/** GET /api/v2/admin/fs?path=：目录选择器，仅列子目录；path 省略时列出允许挂载的根（MEDIA_ROOT 各项）。 */
export const FsListing = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  dirs: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type FsListing = z.infer<typeof FsListing>;

export const AdminSettings = z.object({
  siteName: z.string(),
  scan: z.object({ mode: z.enum(['manual', 'interval']), intervalMinutes: z.number().int().min(15).max(10080) }),
  workers: z.object({
    /** 缩略图并发，1–16。 */
    thumbnailConcurrency: z.number().int().min(1).max(16),
    /** FFmpeg 全局并发（缩略图抽帧、预览、转码共享），1–8。 */
    ffmpegConcurrency: z.number().int().min(1).max(8),
  }),
  transcode: z.object({ enabled: z.boolean(), hwaccel: z.enum(['auto', 'none', 'nvenc', 'vaapi', 'qsv']) }),
  previews: z.object({ enabled: z.boolean() }),
  cache: z.object({ limitGB: z.number().min(1).max(10000) }),
});
export type AdminSettings = z.infer<typeof AdminSettings>;
/** GET /api/v2/admin/settings；PATCH 同结构的部分字段（深度合并），返回完整设置。 */
export const AdminSettingsPatch = z.object({
  siteName: z.string().trim().min(1).max(80),
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
/** POST /api/v2/admin/jobs */
export const CreateJobBody = z.object({ type: JobType, libraryId: z.string().optional() });
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
});
export type SystemInfo = z.infer<typeof SystemInfo>;
