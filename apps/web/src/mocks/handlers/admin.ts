/**
 * 控制台模拟接口：媒体库、挂载、设置、作业、用户、日志、系统信息与个人访问令牌。
 * 状态保存在内存中，刷新页面即恢复初始样例。作业进度按真实时间推进（每次读取作业列表时结算）。
 */
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import type { z } from 'zod';
import {
  AdminSettingsPatch, CreateJobBody, CreateLibraryBody, CreateTokenBody, CreateUserBody, UpdateLibraryBody, UpdateTokenBody, UpdateUserBody,
  WallpaperConfig, defaultPreferences,
  type AdminOverview, type AdminSettings, type ApiToken, type Job, type JobType, type Library, type LibraryWatch, type SystemInfo, type User,
} from '@luvia/contracts';
import { db, LIBRARIES, rng } from '../db';

const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });
const noContent = () => new HttpResponse(null, { status: 204 });
const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const START = Date.now() - (6 * DAY + 14 * HOUR);

async function parse<T extends z.ZodType>(schema: T, request: Request): Promise<{ ok: true; data: z.output<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try { raw = await request.json(); } catch { raw = undefined; }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const issue = r.error.issues[0];
  const where = issue?.path.length ? `（${issue.path.join('.')}）` : '';
  return { ok: false, res: err(400, 'VALIDATION', `提交的内容不符合要求${where}：${issue?.message ?? '格式错误'}`) };
}

/* ---------- 媒体库与挂载 ---------- */

interface MockMount { containerPath: string; hostPath: string | null; kind: 'library' | 'candidate' | 'system' | 'other'; libraryId: string | null; readOnly: boolean; mediaEstimate: number | null; fs: string }

const mounts: MockMount[] = [
  { containerPath: '/media/photos', hostPath: '/vol1/1000/Photos', kind: 'library', libraryId: 'photos', readOnly: true, mediaEstimate: null, fs: 'ext4' },
  { containerPath: '/media/phone', hostPath: '/vol2/1000/Backup/Phone', kind: 'library', libraryId: 'phone', readOnly: true, mediaEstimate: null, fs: 'cifs' },
  { containerPath: '/media/videos', hostPath: '/vol2/1000/Videos', kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: 31_200, fs: 'ext4' },
  { containerPath: '/media/scans', hostPath: '/vol1/1000/Documents/Scans', kind: 'candidate', libraryId: null, readOnly: false, mediaEstimate: 2_400, fs: 'ext4' },
  { containerPath: '/data', hostPath: '/vol1/docker/luvia/data', kind: 'system', libraryId: null, readOnly: false, mediaEstimate: null, fs: 'ext4' },
  { containerPath: '/cache', hostPath: '/vol1/docker/luvia/cache', kind: 'system', libraryId: null, readOnly: false, mediaEstimate: null, fs: 'ext4' },
  { containerPath: '/etc/hosts', hostPath: '/var/lib/docker/containers/3f1c…/hosts', kind: 'other', libraryId: null, readOnly: false, mediaEstimate: null, fs: 'ext4' },
  { containerPath: '/etc/hostname', hostPath: '/var/lib/docker/containers/3f1c…/hostname', kind: 'other', libraryId: null, readOnly: false, mediaEstimate: null, fs: 'ext4' },
  { containerPath: '/etc/resolv.conf', hostPath: '/var/lib/docker/containers/3f1c…/resolv.conf', kind: 'other', libraryId: null, readOnly: false, mediaEstimate: null, fs: 'ext4' },
];

const countOf = (id: string) => db.media.filter((m) => m.libraryId === id).length;
const DEFAULT_EXCLUDE = ['@eaDir', '#recycle', '.*', '.thumbnails'];

/** 按挂载的文件系统与模式推算监控状态。 */
function resolveWatch(prev: LibraryWatch, fs: string, dirs: number): LibraryWatch {
  const network = fs === 'cifs' || fs === 'nfs';
  const every = prev.pollIntervalSec % 60 === 0 ? `${prev.pollIntervalSec / 60} 分钟` : `${prev.pollIntervalSec} 秒`;
  const base = { ...prev, lastReconcileAt: prev.lastReconcileAt ?? iso() };
  switch (prev.mode) {
    case 'off': return { ...base, state: 'off', watchedDirs: null, degradedReason: null };
    case 'poll': return { ...base, state: 'polling', watchedDirs: null, degradedReason: null };
    case 'watch':
      return network
        ? { ...base, state: 'degraded', watchedDirs: null, degradedReason: `网络文件系统 ${fs} 不支持实时事件，已改为每 ${every}对账` }
        : { ...base, state: 'watching', watchedDirs: dirs, degradedReason: null };
    case 'auto':
      return network
        ? { ...base, state: 'polling', watchedDirs: null, degradedReason: `网络文件系统 ${fs} 不支持实时事件，已改为每 ${every}对账` }
        : { ...base, state: 'watching', watchedDirs: dirs, degradedReason: null };
  }
}

const libraries: Library[] = LIBRARIES.map((l, i) => {
  const m = mounts.find((x) => x.libraryId === l.id)!;
  const watch: LibraryWatch = { mode: 'auto', pollIntervalSec: 300, state: 'starting', watchedDirs: null, lastEventAt: i === 0 ? iso(2 * MIN) : null, lastReconcileAt: iso(i === 0 ? 3 * HOUR : 4 * MIN), degradedReason: null };
  return {
    id: l.id, name: l.name, root: l.root, hostRoot: l.hostRoot, hostRootSource: 'auto', exclude: [...DEFAULT_EXCLUDE],
    status: 'ok', mediaCount: countOf(l.id), lastScanAt: iso(i === 0 ? 5 * HOUR : 29 * HOUR), enabled: true,
    watch: resolveWatch(watch, m.fs, i === 0 ? 19 : 7),
  };
});

const mountOf = (lib: Library) => mounts.find((m) => m.libraryId === lib.id);

/* ---------- 变更记录 ---------- */

type Change = { ts: string; kind: 'added' | 'updated' | 'moved' | 'missing' | 'restored' | 'removed'; path: string; fromPath: string | null; isDir: boolean; mediaId: string | null; source: 'watch' | 'poll' | 'scan' };
const changes: Record<string, Change[]> = {
  photos: [
    { ts: iso(2 * MIN), kind: 'added', path: '2026/2026-07 杭州/IMG_20260714_1822.jpg', fromPath: null, isDir: false, mediaId: 'm1', source: 'watch' },
    { ts: iso(3 * MIN), kind: 'added', path: '2026/2026-07 杭州/IMG_20260714_1820.jpg', fromPath: null, isDir: false, mediaId: 'm2', source: 'watch' },
    { ts: iso(26 * MIN), kind: 'moved', path: '2025/2025-04 婚礼/精选', fromPath: '2025/2025-04 婚礼/挑选', isDir: true, mediaId: null, source: 'watch' },
    { ts: iso(2 * HOUR), kind: 'updated', path: '2024/成都/DSC09412.jpg', fromPath: null, isDir: false, mediaId: 'm40', source: 'watch' },
    { ts: iso(5 * HOUR), kind: 'missing', path: '2021/大理/IMG_3311.heic', fromPath: null, isDir: false, mediaId: 'm120', source: 'scan' },
    { ts: iso(26 * HOUR), kind: 'restored', path: '2019/京都/岚山/IMG_0918.jpg', fromPath: null, isDir: false, mediaId: 'm300', source: 'scan' },
    { ts: iso(3 * DAY), kind: 'removed', path: '2023/冰岛环岛/第一周/重复', fromPath: null, isDir: true, mediaId: null, source: 'scan' },
  ],
  phone: [
    { ts: iso(4 * MIN), kind: 'added', path: 'DCIM/Camera/IMG_20261105_0812.jpg', fromPath: null, isDir: false, mediaId: 'm900', source: 'poll' },
    { ts: iso(4 * MIN), kind: 'moved', path: 'Pictures/微信/2026-11/mmexport1730768.jpg', fromPath: 'Pictures/微信/mmexport1730768.jpg', isDir: false, mediaId: 'm901', source: 'poll' },
    { ts: iso(9 * MIN), kind: 'missing', path: 'Movies/VID_20240301.mp4', fromPath: null, isDir: false, mediaId: 'm902', source: 'poll' },
    { ts: iso(29 * HOUR), kind: 'added', path: 'DCIM/Screenshots', fromPath: null, isDir: true, mediaId: null, source: 'scan' },
  ],
};

/* ---------- 设置 ---------- */

let settings: AdminSettings = {
  siteName: 'Luvia',
  publicUrl: 'http://192.168.1.20:3000',
  libraries: { autoEnableNewMounts: false, missingGraceDays: 7 },
  folders: { exposeHostPaths: true },
  scan: { mode: 'daily', intervalMinutes: 360, dailyAt: '04:00' },
  workers: { thumbnailConcurrency: 8, ffmpegConcurrency: 4, metadataConcurrency: 8 },
  transcode: { enabled: true, hwaccel: 'auto' },
  previews: { enabled: true },
  cache: { limitGB: 60 },
};

/* ---------- 作业 ---------- */

interface MockJob extends Job { rate: number; tickAt: number; libraryId?: string }
let jobSeq = 100;
const jobs: MockJob[] = [
  { id: 'j1', type: 'metadata', label: '读取拍摄信息', status: 'running', progress: { done: 1_480, total: 2_210 }, message: '正在处理 phone/DCIM/Camera', error: null, result: null, trigger: 'system', createdAt: iso(40 * MIN), startedAt: iso(40 * MIN), finishedAt: null, etaSec: 1800, rate: 6, tickAt: Date.now() },
  { id: 'j2', type: 'thumbnails', label: '修复缺失缩略图', status: 'running', progress: { done: 120, total: 318 }, message: '正在处理 photos/2025/2025-04 婚礼', error: null, result: null, trigger: 'system', createdAt: iso(20 * MIN), startedAt: iso(12 * MIN), finishedAt: null, etaSec: 600, rate: 2, tickAt: Date.now() },
  { id: 'j3', type: 'previews', label: '生成视频预览', status: 'queued', progress: { done: 0, total: 64 }, message: null, error: null, result: null, trigger: 'system', createdAt: iso(10 * MIN), startedAt: null, finishedAt: null, etaSec: null, rate: 1, tickAt: Date.now() },
  { id: 'j4', type: 'scan', label: '定时对账 照片库', status: 'succeeded', progress: { done: 1, total: 1 }, message: null, error: null, result: { added: 312, updated: 18, moved: 6, removed: 4 }, trigger: 'schedule', createdAt: iso(5 * HOUR), startedAt: iso(5 * HOUR), finishedAt: iso(5 * HOUR - 4 * MIN), etaSec: null, rate: 0, tickAt: 0 },
  { id: 'j5', type: 'previews', label: '生成预览 clip_0412.mkv', status: 'failed', progress: { done: 0, total: 1 }, message: null, error: 'FFmpeg 无法解码这个文件（不支持的编码 prores_ks），可以重试或跳过', result: null, trigger: 'system', createdAt: iso(6 * HOUR), startedAt: iso(6 * HOUR), finishedAt: iso(6 * HOUR - MIN), etaSec: null, rate: 0, tickAt: 0 },
  { id: 'j6', type: 'import_legacy', label: '导入旧版数据', status: 'succeeded', progress: { done: 1, total: 1 }, message: null, error: null, result: { users: 3, favorites: 1_204, favoriteFolders: 12, wallpaperTokens: 1, pendingFavorites: 36, unmatchedFavorites: 3 }, trigger: 'manual', createdAt: iso(3 * DAY), startedAt: iso(3 * DAY), finishedAt: iso(3 * DAY - 2 * MIN), etaSec: null, rate: 0, tickAt: 0 },
];

const pubJob = (j: MockJob): Job => {
  const { rate: _r, tickAt: _t, libraryId: _l, ...rest } = j;
  return rest;
};

function finish(j: MockJob) {
  j.status = 'succeeded'; j.finishedAt = iso(); j.etaSec = null; j.message = null;
  if (j.progress.total == null) j.progress.total = j.progress.done;
  else j.progress.done = j.progress.total;
  if (j.type === 'scan') {
    j.result = { added: Math.floor(j.progress.done * 0.02), updated: 3, moved: 1, removed: 0 };
    for (const l of libraries) {
      if (!j.libraryId || l.id === j.libraryId) {
        l.status = 'ok'; l.lastScanAt = iso();
        const m = mountOf(l);
        l.watch = resolveWatch({ ...l.watch, lastReconcileAt: iso() }, m?.fs ?? 'ext4', 12);
        if (l.mediaCount === 0) l.mediaCount = m?.mediaEstimate ?? 0;
      }
    }
  } else if (j.type === 'cache_prune') j.result = { freedBytes: 1.2 * 1024 ** 3 };
  else if (j.type === 'import_legacy') j.result = { users: 3, favorites: 1_204, favoriteFolders: 12, wallpaperTokens: 1, pendingFavorites: 0, unmatchedFavorites: 3 };
  else j.result = { generated: j.progress.done };
}

/** 按经过的时间推进运行中的作业；同一时间只运行 3 个，其余排队。 */
function tick() {
  const now = Date.now();
  for (const j of jobs) {
    if (j.status !== 'running') { j.tickAt = now; continue; }
    const dt = (now - j.tickAt) / 1000;
    j.tickAt = now;
    j.progress.done += Math.floor(dt * j.rate * (0.7 + Math.random() * 0.6));
    if (j.progress.total != null) {
      const left = j.progress.total - j.progress.done;
      j.etaSec = left > 0 ? Math.round(left / j.rate) : 0;
      if (left <= 0) finish(j);
    } else if (now - Date.parse(j.startedAt ?? iso()) > 9000) finish(j);
  }
  const running = jobs.filter((j) => j.status === 'running').length;
  const queued = jobs.filter((j) => j.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const j of queued.slice(0, Math.max(0, 3 - running))) {
    j.status = 'running'; j.startedAt = iso(); j.tickAt = now;
    if (j.type === 'scan') for (const l of libraries) if (!j.libraryId || l.id === j.libraryId) l.status = 'scanning';
  }
}

const JOB_LABEL: Record<JobType, string> = {
  scan: '扫描', metadata: '读取拍摄信息', thumbnails: '生成缩略图', previews: '生成视频预览', health_check: '健康检查', cache_prune: '清理缓存', import_legacy: '导入旧版数据',
};

function newJob(type: JobType, libraryId?: string): MockJob {
  const lib = libraries.find((l) => l.id === libraryId);
  const label = type === 'scan' ? (lib ? `扫描 ${lib.name}` : '扫描全部媒体库') : JOB_LABEL[type];
  const total = type === 'scan' ? null : type === 'cache_prune' ? 100 : type === 'import_legacy' ? 6 : 200;
  const rate = type === 'scan' ? 420 : type === 'cache_prune' ? 25 : type === 'import_legacy' ? 1.2 : 20;
  const j: MockJob = {
    id: `j${++jobSeq}`, type, label, status: 'queued', progress: { done: 0, total }, message: type === 'scan' ? '正在读取文件列表' : null,
    error: null, result: null, trigger: 'manual', createdAt: iso(), startedAt: null, finishedAt: null, etaSec: null, rate, tickAt: Date.now(), libraryId,
  };
  jobs.unshift(j);
  tick();
  return j;
}

const sortedJobs = () => {
  const order = (j: Job) => (j.status === 'running' ? 0 : j.status === 'paused' ? 1 : j.status === 'queued' ? 2 : 3);
  return [...jobs].sort((a, b) => order(a) - order(b) || b.createdAt.localeCompare(a.createdAt));
};

/* ---------- 用户 ---------- */

const users: User[] = [
  { id: 'u2', username: '家人', role: 'user', allowedPaths: ['photos'], preferences: defaultPreferences(), createdAt: '2026-02-14T10:00:00.000Z', lastLoginAt: iso(11 * HOUR) },
];
const allUsers = () => [db.user, ...users];

/* ---------- 令牌 ---------- */

const tokens: ApiToken[] = [
  { id: 't1', name: '客厅电脑壁纸', scope: 'wallpaper', wallpaper: { source: 'favorites', folder: null, intervalSec: 30, landscapeOnly: true, includeVideos: false }, prefix: 'lv_9f2c1', createdAt: '2026-09-12T20:11:00.000Z', lastUsedAt: iso(2 * MIN), expiresAt: null },
  { id: 't2', name: 'MacBook 小组件', scope: 'read', wallpaper: null, prefix: 'lv_41be0', createdAt: '2026-10-03T09:30:00.000Z', lastUsedAt: iso(3 * HOUR), expiresAt: '2027-10-03T09:30:00.000Z' },
];

/* ---------- 日志 ---------- */

const LOG_SAMPLES: [LogLevel, 'api' | 'worker', string][] = [
  ['info', 'worker', '对账完成：照片库，新增 2 项'],
  ['info', 'worker', '缩略图已生成：photos/2025/2025-04 婚礼/IMG_01212.jpg'],
  ['debug', 'worker', '监视事件合并：photos/2026/2026-07 杭州（3 个事件）'],
  ['info', 'api', '用户登录：家人（iPad）'],
  ['info', 'api', '壁纸令牌“客厅电脑壁纸”取走 100 张随机图片'],
  ['warn', 'worker', '手机备份位于 cifs 网络挂载，已改为每 5 分钟轮询对账'],
  ['info', 'worker', '读取拍摄信息：已处理 1,000 项'],
  ['error', 'worker', '生成预览失败：phone/Movies/clip_0412.mkv（不支持的编码 prores_ks）'],
  ['warn', 'api', '接口响应较慢：GET /api/v2/media 820 ms'],
  ['debug', 'api', 'SSE 连接建立：admin'],
  ['info', 'worker', '缓存清理：释放 1.2 GB'],
];
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const logs = Array.from({ length: 80 }, (_, i) => {
  const [level, source, msg] = LOG_SAMPLES[(i * 7) % LOG_SAMPLES.length]!;
  return { ts: iso(i * 47_000 + 5_000), level, source, msg, ctx: null };
});

/* ---------- 概览 ---------- */

function series(seed: number, base: number, amp: number, noise: number) {
  const r = rng(seed + Math.floor(Date.now() / MIN));
  return Array.from({ length: 60 }, (_, i) => Math.max(0, Math.round((base + Math.sin((i + Math.floor(Date.now() / MIN)) / 5) * amp + r() * noise) * 10) / 10));
}

function overview(): AdminOverview {
  tick();
  const visible = db.media;
  const images = visible.filter((m) => m.mediaType === 'image').length;
  const videos = visible.filter((m) => m.mediaType === 'video').length;
  const meta = jobs.find((j) => j.id === 'j1')!;
  const thumbs = jobs.find((j) => j.id === 'j2')!;
  const thumbMissing = thumbs.status === 'succeeded' ? 0 : Math.max(0, (thumbs.progress.total ?? 0) - thumbs.progress.done);
  const loop = series(11, 12, 3, 6), api = series(23, 78, 12, 18);
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued' || j.status === 'paused').length;
  const queue = series(37, active * 40, 20, 30).map(Math.round);
  return {
    version: '2.0.0-mock',
    uptimeSec: Math.floor((Date.now() - START) / 1000),
    media: { total: visible.length, images, videos, audio: 0, missing: 2 },
    thumbnails: { coverage: 1 - thumbMissing / Math.max(1, visible.length), missing: thumbMissing },
    metadata: { indexed: visible.length - Math.max(0, (meta.progress.total ?? 0) - meta.progress.done), total: visible.length },
    previews: { ready: videos - 12, total: videos },
    cache: { bytes: 38.2 * 1024 ** 3, limitBytes: settings.cache.limitGB * 1024 ** 3 },
    database: { bytes: 412 * 1024 ** 2 },
    health: { eventLoopP99Ms: loop.at(-1)!, apiP95Ms: api.at(-1)!, queueDepth: queue.at(-1)!, series: { eventLoopP99Ms: loop, apiP95Ms: api, queueDepth: queue } },
    lastScanAt: libraries.map((l) => l.lastScanAt).filter(Boolean).sort().at(-1) ?? null,
    activeJobs: active,
  };
}

const system: SystemInfo = {
  version: '2.0.0-mock', commit: '2c0ef12', node: 'v24.11.0', platform: 'linux x64（Docker）', sqlite: '3.50.4',
  ffmpeg: { available: true, version: '7.1.2', hwaccels: ['vaapi', 'qsv'] },
  sharp: { version: '0.34.4', heif: true },
  dataDir: '/data', cacheDir: '/cache',
  inotify: { maxUserWatches: 65_536, used: 19 },
};

/* ---------- 处理器 ---------- */

const merge = <T extends object>(a: T, b: Partial<T>): T => {
  const o = { ...a } as Record<string, unknown>;
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge((o[k] as object) ?? {}, v as object) : v;
  }
  return o as T;
};

export const adminHandlers = [
  http.get('/api/v2/admin/overview', async () => { await delay(150); return HttpResponse.json(overview()); }),

  // 媒体库
  http.get('/api/v2/admin/libraries', async () => { tick(); await delay(120); return HttpResponse.json({ libraries }); }),
  http.post('/api/v2/admin/libraries', async ({ request }) => {
    const p = await parse(CreateLibraryBody, request);
    if (!p.ok) return p.res;
    const b = p.data;
    const m = mounts.find((x) => b.root === x.containerPath || b.root.startsWith(x.containerPath + '/'));
    if (!m || m.kind === 'system' || m.kind === 'other') return err(400, 'VALIDATION', `${b.root} 不在可用的挂载目录之内。先在 docker-compose 中挂载，再重启容器。`);
    if (libraries.some((l) => l.root === b.root)) return err(409, 'CONFLICT', `${b.root} 已经是媒体库`);
    await delay(300);
    const id = b.root.split('/').filter(Boolean).at(-1)!.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (++jobSeq);
    const lib: Library = {
      id, name: b.name, root: b.root, hostRoot: b.hostRoot ?? m.hostPath, hostRootSource: b.hostRoot ? 'manual' : m.hostPath ? 'auto' : null,
      exclude: b.exclude ?? [...DEFAULT_EXCLUDE], status: 'ok', mediaCount: 0, lastScanAt: null, enabled: b.enabled,
      watch: { mode: b.watch?.mode ?? 'auto', pollIntervalSec: b.watch?.pollIntervalSec ?? 300, state: 'starting', watchedDirs: null, lastEventAt: null, lastReconcileAt: null, degradedReason: null },
    };
    libraries.push(lib);
    if (m.containerPath === b.root) { m.kind = 'library'; m.libraryId = id; }
    changes[id] = [];
    return HttpResponse.json(lib);
  }),
  http.patch('/api/v2/admin/libraries/:id', async ({ params, request }) => {
    const lib = libraries.find((l) => l.id === params.id);
    if (!lib) return err(404, 'NOT_FOUND', '媒体库不存在，可能已被删除');
    const p = await parse(UpdateLibraryBody, request);
    if (!p.ok) return p.res;
    const b = p.data;
    const m = mountOf(lib);
    if (b.name !== undefined) lib.name = b.name;
    if (b.enabled !== undefined) lib.enabled = b.enabled;
    if (b.exclude !== undefined) lib.exclude = b.exclude;
    if (b.hostRoot !== undefined) {
      if (b.hostRoot === null) { lib.hostRoot = m?.hostPath ?? null; lib.hostRootSource = m?.hostPath ? 'auto' : null; }
      else { lib.hostRoot = b.hostRoot; lib.hostRootSource = 'manual'; }
    }
    if (b.watch) lib.watch = { ...lib.watch, ...b.watch };
    lib.watch = lib.enabled ? resolveWatch(lib.watch, m?.fs ?? 'ext4', lib.watch.watchedDirs ?? 12) : { ...lib.watch, state: 'off', watchedDirs: null, degradedReason: null };
    await delay(200);
    return HttpResponse.json(lib);
  }),
  http.delete('/api/v2/admin/libraries/:id', async ({ params }) => {
    const i = libraries.findIndex((l) => l.id === params.id);
    if (i < 0) return err(404, 'NOT_FOUND', '媒体库不存在，可能已被删除');
    const [lib] = libraries.splice(i, 1);
    const m = mounts.find((x) => x.libraryId === lib!.id);
    if (m) { m.kind = 'candidate'; m.libraryId = null; m.mediaEstimate = lib!.mediaCount || m.mediaEstimate; }
    await delay(200);
    return noContent();
  }),
  http.get('/api/v2/admin/libraries/:id/changes', async ({ params, request }) => {
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 100);
    if (!libraries.some((l) => l.id === params.id)) return err(404, 'NOT_FOUND', '媒体库不存在，可能已被删除');
    await delay(150);
    return HttpResponse.json({ changes: (changes[params.id as string] ?? []).slice(0, limit) });
  }),
  http.get('/api/v2/admin/mounts', async () => {
    await delay(120);
    return HttpResponse.json({ mounts: mounts.map(({ fs: _f, ...m }) => m) });
  }),
  http.get('/api/v2/admin/fs', ({ request }) => {
    const path = new URL(request.url).searchParams.get('path');
    if (!path) return HttpResponse.json({ path: '', parent: null, dirs: mounts.filter((m) => m.kind === 'library' || m.kind === 'candidate').map((m) => ({ name: m.containerPath.split('/').at(-1)!, path: m.containerPath })) });
    return HttpResponse.json({ path, parent: path.split('/').slice(0, -1).join('/') || null, dirs: ['2024', '2025', '2026'].map((n) => ({ name: n, path: `${path}/${n}` })) });
  }),

  // 设置
  http.get('/api/v2/admin/settings', () => HttpResponse.json(settings)),
  http.patch('/api/v2/admin/settings', async ({ request }) => {
    const p = await parse(AdminSettingsPatch, request);
    if (!p.ok) return p.res;
    settings = merge(settings, p.data as Partial<AdminSettings>);
    await delay(200);
    return HttpResponse.json(settings);
  }),

  // 作业
  http.get('/api/v2/admin/jobs', ({ request }) => {
    tick();
    const sp = new URL(request.url).searchParams;
    const status = sp.get('status');
    const limit = Number(sp.get('limit') ?? 50);
    return HttpResponse.json({ jobs: sortedJobs().filter((j) => !status || j.status === status).slice(0, limit).map(pubJob) });
  }),
  http.post('/api/v2/admin/jobs', async ({ request }) => {
    const p = await parse(CreateJobBody, request);
    if (!p.ok) return p.res;
    if (p.data.libraryId && !libraries.some((l) => l.id === p.data.libraryId)) return err(404, 'NOT_FOUND', '媒体库不存在，可能已被删除');
    const dup = jobs.find((j) => j.type === p.data.type && j.libraryId === p.data.libraryId && (j.status === 'running' || j.status === 'queued'));
    if (dup) return err(409, 'CONFLICT', `“${dup.label}”已在队列中，等它完成后再试`);
    await delay(200);
    return HttpResponse.json(pubJob(newJob(p.data.type, p.data.libraryId)));
  }),
  http.post('/api/v2/admin/jobs/:id/:action', async ({ params }) => {
    tick();
    const j = jobs.find((x) => x.id === params.id);
    if (!j) return err(404, 'NOT_FOUND', '任务不存在，可能已被清理');
    const a = params.action;
    const bad = () => err(409, 'CONFLICT', '任务状态已经变化，刷新后再试');
    if (a === 'pause') { if (j.status !== 'running') return bad(); j.status = 'paused'; j.etaSec = null; }
    else if (a === 'resume') { if (j.status !== 'paused') return bad(); j.status = 'running'; j.tickAt = Date.now(); }
    else if (a === 'cancel') {
      if (!(j.status === 'running' || j.status === 'paused' || j.status === 'queued')) return bad();
      j.status = 'cancelled'; j.finishedAt = iso(); j.etaSec = null;
      if (j.type === 'scan') for (const l of libraries) if (!j.libraryId || l.id === j.libraryId) l.status = 'ok';
    } else if (a === 'retry') {
      if (!(j.status === 'failed' || j.status === 'cancelled')) return bad();
      j.status = 'queued'; j.error = null; j.result = null; j.finishedAt = null; j.progress.done = 0; j.createdAt = iso();
      tick();
    } else return err(400, 'VALIDATION', '不支持的操作');
    await delay(150);
    return HttpResponse.json(pubJob(j));
  }),

  // 用户
  http.get('/api/v2/admin/users', () => HttpResponse.json({ users: allUsers() })),
  http.post('/api/v2/admin/users', async ({ request }) => {
    const p = await parse(CreateUserBody, request);
    if (!p.ok) return p.res;
    const b = p.data;
    if (allUsers().some((u) => u.username === b.username)) return err(409, 'CONFLICT', `用户名“${b.username}”已被使用，换一个名字`);
    const u: User = { id: `u${++jobSeq}`, username: b.username, role: b.role, allowedPaths: b.role === 'admin' ? null : b.allowedPaths, preferences: defaultPreferences(), createdAt: iso(), lastLoginAt: null };
    users.push(u);
    await delay(250);
    return HttpResponse.json(u);
  }),
  http.patch('/api/v2/admin/users/:id', async ({ params, request }) => {
    const p = await parse(UpdateUserBody, request);
    if (!p.ok) return p.res;
    const isSelf = params.id === db.user.id;
    const u = isSelf ? db.user : users.find((x) => x.id === params.id);
    if (!u) return err(404, 'NOT_FOUND', '用户不存在，可能已被删除');
    if (isSelf && p.data.role === 'user') return err(400, 'VALIDATION', '不能取消自己的管理员身份，请让另一位管理员操作');
    const next: User = { ...u, role: p.data.role ?? u.role };
    if (p.data.allowedPaths !== undefined) next.allowedPaths = p.data.allowedPaths;
    if (next.role === 'admin') next.allowedPaths = null;
    if (isSelf) db.user = next; else users[users.indexOf(u)] = next;
    await delay(250);
    return HttpResponse.json(next);
  }),
  http.delete('/api/v2/admin/users/:id', async ({ params }) => {
    if (params.id === db.user.id) return err(400, 'VALIDATION', '不能删除当前登录的管理员账号');
    const i = users.findIndex((u) => u.id === params.id);
    if (i < 0) return err(404, 'NOT_FOUND', '用户不存在，可能已被删除');
    users.splice(i, 1);
    await delay(200);
    return noContent();
  }),

  // 日志与系统
  http.get('/api/v2/admin/logs', ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const level = sp.get('level');
    const limit = Number(sp.get('limit') ?? 200);
    return HttpResponse.json({ logs: logs.filter((l) => !level || l.level === level).slice(0, limit) });
  }),
  http.get('/api/v2/admin/system', () => HttpResponse.json(system)),

  // 个人访问令牌
  http.get('/api/v2/me/tokens', () => HttpResponse.json({ tokens })),
  http.post('/api/v2/me/tokens', async ({ request }) => {
    const p = await parse(CreateTokenBody, request);
    if (!p.ok) return p.res;
    const b = p.data;
    const hex = Array.from(crypto.getRandomValues(new Uint8Array(20)), (x) => x.toString(16).padStart(2, '0')).join('');
    const token = `lv_${hex}`;
    const meta: ApiToken = {
      id: `t${++jobSeq}`, name: b.name, scope: b.scope, wallpaper: b.scope === 'wallpaper' ? WallpaperConfig.parse(b.wallpaper ?? {}) : null,
      prefix: token.slice(0, 8), createdAt: iso(), lastUsedAt: null, expiresAt: b.expiresAt ?? null,
    };
    tokens.unshift(meta);
    await delay(250);
    return HttpResponse.json({ token, meta });
  }),
  http.patch('/api/v2/me/tokens/:id', async ({ params, request }) => {
    const t = tokens.find((x) => x.id === params.id);
    if (!t) return err(404, 'NOT_FOUND', '令牌不存在，可能已被撤销');
    const p = await parse(UpdateTokenBody, request);
    if (!p.ok) return p.res;
    if (p.data.name) t.name = p.data.name;
    if (p.data.wallpaper) {
      if (t.scope !== 'wallpaper') return err(400, 'VALIDATION', '只读令牌没有壁纸设置');
      t.wallpaper = { ...(t.wallpaper ?? WallpaperConfig.parse({})), ...p.data.wallpaper };
    }
    await delay(200);
    return HttpResponse.json(t);
  }),
  http.delete('/api/v2/me/tokens/:id', async ({ params }) => {
    const i = tokens.findIndex((x) => x.id === params.id);
    if (i < 0) return err(404, 'NOT_FOUND', '令牌不存在，可能已被撤销');
    tokens.splice(i, 1);
    await delay(200);
    return noContent();
  }),
];
