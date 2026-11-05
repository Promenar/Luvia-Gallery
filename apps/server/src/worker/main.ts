import { monitorEventLoopDelay } from 'node:perf_hooks';
import { detectMounts } from '../core/mounts.ts';
import { installFatalHandlers, openRuntime } from '../core/runtime.ts';
import { probeFfmpeg } from './ffmpeg.ts';
import { newWorkerOwner } from './runner.ts';
import { discoverNewMounts } from './discover.ts';
import type { Mount } from '../core/mounts.ts';
import { sampleMounts } from './mount-estimate.ts';
import { randomUUID } from 'node:crypto';
import { readSettings } from '../core/settings.ts';
import { publishJob } from '../core/job-view.ts';
import { withFfmpegSlot } from './ffmpeg-slots.ts';
import { scheduleScans } from './schedule.ts';
import { createWorkerLogger } from '../core/observability.ts';
import { cleanupHls } from './hls.ts';
import { runWorkerPool } from './pool.ts';

installFatalHandlers('worker');
const runtime = await openRuntime();
const logger = createWorkerLogger(runtime.db);
logger.info('工作进程已启动');
const owner = newWorkerOwner();
const stopController = new AbortController();
process.on('SIGINT', () => stopController.abort());
process.on('SIGTERM', () => stopController.abort());
const mounts = process.platform === 'darwin'
  ? runtime.mediaRoots.map((containerPath): Mount => ({ containerPath, hostPath: null, kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: null }))
  : await detectMounts({ mediaRoots: runtime.mediaRoots, systemRoots: [runtime.dataDir, runtime.cacheDir], hostPaths: process.env.LUVIA_HOST_PATHS });
const allowedRoots = mounts.filter((entry) => entry.kind === 'candidate').map((entry) => entry.containerPath);
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const heartbeat = () => {
  const p99 = loop.percentile(99) / 1e6;
  loop.reset();
  runtime.db.prepare("INSERT INTO settings(key,value) VALUES('worker.heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ at: Date.now() / 1000, healthy: p99 <= 50, eventLoopP99Ms: p99 }));
};
heartbeat();
const heartbeatTimer = setInterval(heartbeat, 5000);
heartbeatTimer.unref();
const schedulePrune = () => {
  const used = (runtime.db.prepare('SELECT COALESCE(sum(bytes),0) AS n FROM cache_entries').get() as { n: number }).n;
  if (used <= readSettings(runtime.db).cache.limitGB * 1024 ** 3) return;
  runtime.db.transaction(() => {
    const id = randomUUID();
    const result = runtime.db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,'cache_prune','清理缓存','queued','system',unixepoch(),'system:cache-prune')").run(id);
    if (result.changes) publishJob(runtime.db, id);
  }).immediate();
};
const pruneTimer = setInterval(schedulePrune, 60_000);
pruneTimer.unref();
const scanTimer = setInterval(() => { try { scheduleScans(runtime.db); } catch { logger.warn('扫描调度失败'); } }, 30_000);
scanTimer.unref();
let cleaning = false; let hlsCleanup: Promise<void> = Promise.resolve();
const scheduleHlsCleanup = () => {
  if (cleaning) return;
  cleaning = true;
  hlsCleanup = cleanupHls(runtime.db, runtime.cacheDir).then(() => {}).catch(() => { logger.warn('HLS 缓存回收失败'); }).finally(() => { cleaning = false; });
};
const hlsTimer = setInterval(scheduleHlsCleanup, 30_000); hlsTimer.unref();
let sampling: Promise<void> = Promise.resolve();
try {
  schedulePrune();
  scheduleHlsCleanup();
  await discoverNewMounts(runtime.db, mounts, [runtime.dataDir, runtime.cacheDir]);
  scheduleScans(runtime.db);
  sampling = sampleMounts(runtime.db, mounts, stopController.signal).catch(() => { logger.warn('挂载抽样失败'); });
  const ffmpeg = await withFfmpegSlot(runtime.db, owner, (signal) => probeFfmpeg('ffmpeg', signal), { signal: stopController.signal });
  runtime.db.prepare("INSERT INTO settings(key,value) VALUES('worker.ffmpeg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(ffmpeg));
  logger.info({ ctx: { type: ffmpeg.encoder } }, '视频编码器已选择');
  await runWorkerPool(runtime.db, { owner, allowedRoots, legacyDir: runtime.legacyDir, systemRoots: [runtime.dataDir, runtime.cacheDir], cacheDir: runtime.cacheDir, signal: stopController.signal,
    log: (level, message, ctx) => logger[level]({ ctx }, message) });
} finally {
  stopController.abort();
  await sampling;
  clearInterval(heartbeatTimer); clearInterval(pruneTimer); clearInterval(scanTimer); clearInterval(hlsTimer);
  await hlsCleanup; loop.disable(); runtime.db.close();
}
