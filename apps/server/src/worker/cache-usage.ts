import type Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { runProcess } from './process-runner.ts';

export async function readCacheUsage(db: Database.Database, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  if (db.name === ':memory:') return (db.prepare('SELECT COALESCE(sum(bytes),0) AS n FROM cache_entries').get() as { n: number }).n;
  const result = await runProcess(process.execPath, [fileURLToPath(new URL('./cache-usage-child.ts', import.meta.url)), db.name],
    { timeoutMs: 60_000, maxBuffer: 4096, capture: true, signal });
  signal?.throwIfAborted();
  let response: { bytes?: unknown; error?: unknown } = {};
  try { response = JSON.parse(result.stdout); } catch { /* 子进程异常不暴露原始输出。 */ }
  if (result.code === 0 && typeof response.bytes === 'number' && Number.isSafeInteger(response.bytes) && response.bytes >= 0) return response.bytes;
  const error = new Error('缓存总量统计失败') as Error & { code?: string };
  if (typeof response.error === 'string' && /^SQLITE_[A-Z0-9_]+$/.test(response.error)) error.code = response.error;
  throw error;
}
