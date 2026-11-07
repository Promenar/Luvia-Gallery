import { createApp } from './app.ts';
import { installFatalHandlers, loadLegacyJwtSecret, openRuntime } from '../core/runtime.ts';
import { workerReady } from '../core/health-window.ts';

installFatalHandlers('api');
const runtime = await openRuntime();
const legacyJwtSecret = await loadLegacyJwtSecret(runtime.legacyDir, runtime.dataDir);
const app = await createApp({ db: runtime.db, legacyJwtSecret, legacyPending: () => {
  const row = runtime.db.prepare("SELECT value FROM settings WHERE key='legacy.pending'").get() as { value: string } | undefined;
  return row?.value === 'true';
} });
app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async (_req, reply) => {
  const row = runtime.db.prepare("SELECT value FROM settings WHERE key='worker.heartbeat'").get() as { value: string } | undefined;
  let heartbeat: { at?: number; healthy?: boolean } = {};
  try { if (row) heartbeat = JSON.parse(row.value); } catch { /* 无效心跳不能视为就绪。 */ }
  const ready = workerReady(heartbeat, Date.now() / 1000);
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
  await app.close(); runtime.db.close();
}
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
