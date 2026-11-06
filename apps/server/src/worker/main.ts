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
import { writeWorkerHeartbeat } from './telemetry.ts';
import { flushMetadataFolders } from './metadata.ts';
import { runSqliteMaintenance } from './sqlite-maintenance.ts';
import { startWalCheckpointer } from './wal-checkpoint.ts';
import { startProcessRunner, stopProcessRunner } from './process-runner.ts';
import { runIndexBackfill } from './index-backfill.ts';
import { cleanupDeletedMediaCache } from './cache-prune.ts';
import { runTimelineRebuild } from './timeline-rebuild.ts';
import { flushWatchReconciles } from './watch-reconcile-queue.ts';
import { WatchRuntime } from './watch-runtime.ts';
import { startWatchLoop } from './watch-loop.ts';
import { flushLibraryEvents } from './watch-events.ts';

installFatalHandlers('worker');
const runtime = await openRuntime();
const logger = createWorkerLogger(runtime.db);
// 内存还小时先启动子进程代理，之后的 ffprobe、ffmpeg 都由它启动
startProcessRunner();
const stopCheckpointer = startWalCheckpointer(runtime.db.name, { onError: () => logger.warn('WAL 检查点线程异常，稍后重启') });
logger.info('工作进程已启动');
const owner = newWorkerOwner();
const stopController = new AbortController();
let stopWatch: (() => void) | undefined;
let shutdownDeadline: NodeJS.Timeout | undefined;
const requestStop = () => {
  stopController.abort(); stopWatch?.();
  if (!shutdownDeadline) {
    shutdownDeadline = setTimeout(() => {
      try { runtime.db.prepare('DELETE FROM watch_leases WHERE owner=?').run(owner); } catch { /* 已失效的租约会按期限释放。 */ }
      process.exit(1);
    }, 12_000);
    shutdownDeadline.unref();
  }
};
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
const mounts = process.platform === 'darwin'
  ? runtime.mediaRoots.map((containerPath): Mount => ({ containerPath, hostPath: null, kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: null }))
  : await detectMounts({ mediaRoots: runtime.mediaRoots, systemRoots: [runtime.dataDir, runtime.cacheDir], hostPaths: process.env.LUVIA_HOST_PATHS });
const allowedRoots = mounts.filter((entry) => entry.kind === 'candidate').map((entry) => entry.containerPath);
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const heartbeat = () => {
  const p99 = loop.percentile(99) / 1e6;
  loop.reset();
  writeWorkerHeartbeat(runtime.db, p99);
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
const reconcileTimer = setInterval(() => { try { flushWatchReconciles(runtime.db); } catch { logger.warn('监控对账排队失败'); } }, 5000);
reconcileTimer.unref();
const eventTimer = setInterval(() => { try { flushLibraryEvents(runtime.db); } catch { logger.warn('媒体库事件发送失败'); } }, 250);
eventTimer.unref();
const folderTimer = setInterval(() => { try { flushMetadataFolders(runtime.db); } catch { logger.warn('目录统计恢复失败'); } }, 5000);
folderTimer.unref();
let maintaining = false; let maintenance: Promise<void> = Promise.resolve();
const maintenanceTimer = setInterval(() => {
  if (maintaining) return;
  maintaining = true;
  maintenance = runSqliteMaintenance(runtime.db.name).then((result) => {
    if (result.busy) logger.info('数据库检查点暂不可截断，将在下次维护时重试');
  }).catch(() => { logger.warn('数据库维护失败'); }).finally(() => { maintaining = false; });
}, 15 * 60_000);
maintenanceTimer.unref();
let cleaning = false; let hlsCleanup: Promise<void> = Promise.resolve();
const scheduleHlsCleanup = () => {
  if (cleaning) return;
  cleaning = true;
  hlsCleanup = cleanupHls(runtime.db, runtime.cacheDir).then(() => {}).catch(() => { logger.warn('HLS 缓存回收失败'); }).finally(() => { cleaning = false; });
};
const hlsTimer = setInterval(scheduleHlsCleanup, 30_000); hlsTimer.unref();
let sampling: Promise<void> = Promise.resolve();
let backfill: Promise<void> = Promise.resolve();
let cacheCleanup: Promise<void> = Promise.resolve();
let timelineRebuild: Promise<void> = Promise.resolve();
const watchLoop = startWatchLoop(new WatchRuntime(runtime.db, { owner, allowedRoots }), { onError: () => logger.warn('实时监控检查失败') });
stopWatch = () => { void watchLoop.stop(); };
if (stopController.signal.aborted) stopWatch();
try {
  void watchLoop.ready.catch(() => { logger.warn('实时监控启动失败，将重试'); });
  schedulePrune();
  flushMetadataFolders(runtime.db);
  scheduleHlsCleanup();
  await discoverNewMounts(runtime.db, mounts, [runtime.dataDir, runtime.cacheDir]);
  scheduleScans(runtime.db);
  flushWatchReconciles(runtime.db);
  flushLibraryEvents(runtime.db);
  backfill = runIndexBackfill(runtime.db, { allowedRoots, signal: stopController.signal }).catch(() => { if (!stopController.signal.aborted) logger.warn('媒体索引回填失败'); });
  cacheCleanup = cleanupDeletedMediaCache(runtime.db, runtime.cacheDir, { owner, signal: stopController.signal }).catch(() => { if (!stopController.signal.aborted) logger.warn('媒体缓存回收失败'); });
  timelineRebuild = runTimelineRebuild(runtime.db, stopController.signal).catch(() => { if (!stopController.signal.aborted) logger.warn('时间分桶恢复失败'); });
  sampling = sampleMounts(runtime.db, mounts, stopController.signal).catch(() => { logger.warn('挂载抽样失败'); });
  const ffmpeg = await withFfmpegSlot(runtime.db, owner, (signal) => probeFfmpeg('ffmpeg', signal), { signal: stopController.signal });
  runtime.db.prepare("INSERT INTO settings(key,value) VALUES('worker.ffmpeg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(ffmpeg));
  logger.info({ ctx: { type: ffmpeg.encoder } }, '视频编码器已选择');
  await runWorkerPool(runtime.db, { owner, allowedRoots, legacyDir: runtime.legacyDir, systemRoots: [runtime.dataDir, runtime.cacheDir], configuredMediaRoots: runtime.mediaRoots, cacheDir: runtime.cacheDir, signal: stopController.signal,
    log: (level, message, ctx) => logger[level]({ ctx }, message) });
} finally {
  stopController.abort();
  await watchLoop.stop();
  await Promise.all([sampling, backfill, cacheCleanup, timelineRebuild]);
  clearInterval(heartbeatTimer); clearInterval(pruneTimer); clearInterval(scanTimer); clearInterval(reconcileTimer); clearInterval(eventTimer); clearInterval(folderTimer); clearInterval(hlsTimer); clearInterval(maintenanceTimer);
  await Promise.all([hlsCleanup, maintenance, stopCheckpointer()]); stopProcessRunner(); loop.disable(); runtime.db.close();
  if (shutdownDeadline) clearTimeout(shutdownDeadline);
}
