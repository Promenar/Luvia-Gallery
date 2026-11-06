import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { publishJob } from '../core/job-view.ts';
import { isTransientSqliteError } from '../core/sqlite-errors.ts';
import { readCacheUsage } from './cache-usage.ts';

export async function scheduleCachePrune(db: Database.Database, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let used: number;
  try { used = await readCacheUsage(db, signal); }
  catch (error) { if (isTransientSqliteError(error)) return; throw error; }
  signal?.throwIfAborted();
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try {
    db.pragma('busy_timeout = 0');
    if (used <= readSettings(db).cache.limitGB * 1024 ** 3) return;
    db.transaction(() => {
      signal?.throwIfAborted();
      const id = randomUUID();
      const inserted = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,'cache_prune','清理缓存','queued','system',unixepoch(),'system:cache-prune')").run(id);
      if (inserted.changes) publishJob(db, id);
    }).immediate();
  } catch (error) {
    if (!isTransientSqliteError(error)) throw error;
  } finally { db.pragma(`busy_timeout = ${timeout}`); }
}
