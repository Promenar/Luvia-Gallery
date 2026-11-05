import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { detectMounts } from '../core/mounts.ts';
import { installFatalHandlers, openRuntime } from '../core/runtime.ts';
import { probeFfmpeg } from './ffmpeg.ts';
import { newWorkerOwner, runNextJob } from './runner.ts';

installFatalHandlers('worker');
const runtime = await openRuntime();
const owner = newWorkerOwner();
const stopController = new AbortController();
process.on('SIGINT', () => stopController.abort());
process.on('SIGTERM', () => stopController.abort());
const mounts = await detectMounts({ mediaRoots: runtime.mediaRoots, systemRoots: [runtime.dataDir, runtime.cacheDir], hostPaths: process.env.LUVIA_HOST_PATHS });
const allowedRoots = process.platform === 'darwin' ? runtime.mediaRoots : mounts.filter((entry) => entry.kind === 'candidate').map((entry) => entry.containerPath);
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
try {
  const ffmpeg = await probeFfmpeg();
  runtime.db.prepare("INSERT INTO settings(key,value) VALUES('worker.ffmpeg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(ffmpeg));
  process.stdout.write(`worker 编码器: ${ffmpeg.encoder}\n`);
  while (!stopController.signal.aborted) {
    const worked = await runNextJob(runtime.db, { owner, allowedRoots, legacyDir: runtime.legacyDir, systemRoots: [runtime.dataDir, runtime.cacheDir], signal: stopController.signal });
    if (!worked) {
      try { await delay(500, undefined, { signal: stopController.signal }); } catch { if (!stopController.signal.aborted) throw new Error('worker 等待失败'); }
    }
  }
} finally {
  clearInterval(heartbeatTimer); loop.disable(); runtime.db.close();
}
