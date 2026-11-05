import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { detectMounts } from '../core/mounts.ts';
import { installFatalHandlers, openRuntime } from '../core/runtime.ts';
import { probeFfmpeg } from './ffmpeg.ts';
import { newWorkerOwner, runNextJob } from './runner.ts';
import { discoverNewMounts } from './discover.ts';
import type { Mount } from '../core/mounts.ts';
import { sampleMounts } from './mount-estimate.ts';
import { randomUUID } from 'node:crypto';
import { readSettings } from '../core/settings.ts';
import { publishJob } from '../core/job-view.ts';

installFatalHandlers('worker');
const runtime = await openRuntime();
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
let sampling: Promise<void> = Promise.resolve();
try {
  schedulePrune();
  await discoverNewMounts(runtime.db, mounts, [runtime.dataDir, runtime.cacheDir]);
  sampling = sampleMounts(runtime.db, mounts, stopController.signal).catch(() => { process.stderr.write('挂载抽样失败\n'); });
  const ffmpeg = await probeFfmpeg();
  runtime.db.prepare("INSERT INTO settings(key,value) VALUES('worker.ffmpeg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(ffmpeg));
  process.stdout.write(`worker 编码器: ${ffmpeg.encoder}\n`);
  while (!stopController.signal.aborted) {
    const worked = await runNextJob(runtime.db, { owner, allowedRoots, legacyDir: runtime.legacyDir, systemRoots: [runtime.dataDir, runtime.cacheDir], cacheDir: runtime.cacheDir, signal: stopController.signal });
    if (!worked) {
      try { await delay(500, undefined, { signal: stopController.signal }); } catch { if (!stopController.signal.aborted) throw new Error('worker 等待失败'); }
    }
  }
} finally {
  stopController.abort();
  await sampling;
  clearInterval(heartbeatTimer); clearInterval(pruneTimer); loop.disable(); runtime.db.close();
}
