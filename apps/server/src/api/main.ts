import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createApp } from './app.ts';
import { installFatalHandlers, openRuntime } from '../core/runtime.ts';

installFatalHandlers('api');
const runtime = await openRuntime();
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
let loopP99 = 0;
const monitor = setInterval(() => { loopP99 = loop.percentile(99) / 1e6; loop.reset(); }, 5000);
monitor.unref();
const app = await createApp({ db: runtime.db, legacyPending: () => {
  const row = runtime.db.prepare("SELECT value FROM settings WHERE key='legacy.pending'").get() as { value: string } | undefined;
  return row?.value === 'true';
} });
app.get('/healthz', async (_req, reply) => reply.code(loopP99 <= 50 ? 200 : 503).send({ ok: loopP99 <= 50 }));
app.get('/readyz', async (_req, reply) => {
  const row = runtime.db.prepare("SELECT value FROM settings WHERE key='worker.heartbeat'").get() as { value: string } | undefined;
  let heartbeat: { at?: number; healthy?: boolean } = {};
  try { if (row) heartbeat = JSON.parse(row.value); } catch { /* 无效心跳不能视为就绪。 */ }
  const ready = loopP99 <= 50 && heartbeat.healthy === true && typeof heartbeat.at === 'number' && Date.now() / 1000 - heartbeat.at < 20;
  return reply.code(ready ? 200 : 503).send({ ok: ready });
});
const port = Number(process.env.PORT ?? '3001');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口无效');
await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
process.stdout.write('api 已启动\n');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(monitor); loop.disable();
  await app.close(); runtime.db.close();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
