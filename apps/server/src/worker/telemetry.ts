import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { isTransientSqliteError } from '../core/sqlite-errors.ts';

type Memory = Pick<NodeJS.MemoryUsage, 'rss' | 'heapTotal' | 'heapUsed' | 'external' | 'arrayBuffers'>;

/** 仅记录数值指标，便于区分 V8 堆与进程内其它内存的增长。 */
export function writeWorkerHeartbeat(db: Database.Database, eventLoopP99Ms: number, at = Date.now() / 1000, memory: Memory = process.memoryUsage(), counters = sharp.counters()): void {
  const { rss, heapTotal, heapUsed, external, arrayBuffers } = memory;
  const timeout = db.pragma('busy_timeout', { simple: true }) as number;
  try {
    db.pragma('busy_timeout = 0');
    db.prepare("INSERT INTO settings(key,value) VALUES('worker.heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ at, healthy: eventLoopP99Ms <= 50, eventLoopP99Ms, memory: { rss, heapTotal, heapUsed, external, arrayBuffers }, sharp: { queue: counters.queue, process: counters.process } }));
  } catch (error) {
    if (!isTransientSqliteError(error)) throw error;
  } finally {
    db.pragma(`busy_timeout = ${timeout}`);
  }
}
