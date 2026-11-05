import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';

export async function withMediaGenerationLock<T>(db: Database.Database, owner: string, key: string, operation: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  const token = randomUUID();
  while (true) {
    options.signal?.throwIfAborted(); options.assertLease?.();
    const acquired = db.prepare(`INSERT INTO media_generation_locks(cache_key,owner,lease_token,lease_expires_at) VALUES (?,?,?,unixepoch()+30)
      ON CONFLICT(cache_key) DO UPDATE SET owner=excluded.owner,lease_token=excluded.lease_token,lease_expires_at=excluded.lease_expires_at
      WHERE media_generation_locks.lease_expires_at<=unixepoch()`).run(key, owner, token).changes;
    if (acquired) break;
    await delay(50, undefined, { signal: options.signal });
  }
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, local.signal]) : local.signal;
  const heartbeat = setInterval(() => {
    try {
      if (!db.prepare('UPDATE media_generation_locks SET lease_expires_at=unixepoch()+30 WHERE cache_key=? AND owner=? AND lease_token=? AND lease_expires_at>unixepoch()').run(key, owner, token).changes) local.abort();
    } catch { local.abort(); }
  }, 5000);
  heartbeat.unref();
  try {
    signal.throwIfAborted(); options.assertLease?.();
    const result = await operation(signal);
    signal.throwIfAborted(); options.assertLease?.();
    return result;
  } finally {
    clearInterval(heartbeat);
    db.prepare('DELETE FROM media_generation_locks WHERE cache_key=? AND owner=? AND lease_token=?').run(key, owner, token);
  }
}
