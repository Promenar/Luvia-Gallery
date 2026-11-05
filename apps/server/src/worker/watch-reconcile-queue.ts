import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { publishJob } from '../core/job-view.ts';

/** 保存发生在扫描期间的请求，直到扫描锁与已有作业均释放。 */
export function requestWatchReconcile(db: Database.Database, libraryId: string, reason: string): void {
  db.prepare(`INSERT INTO watch_reconcile_requests(library_id,reason,requested_at) VALUES (?,?,unixepoch())
    ON CONFLICT(library_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at`).run(libraryId, reason);
}

export function flushWatchReconciles(db: Database.Database, at = Math.floor(Date.now() / 1000)): number {
  return db.transaction(() => {
    const pending = db.prepare(`SELECT r.library_id FROM watch_reconcile_requests r JOIN libraries l ON l.id=r.library_id
      WHERE l.enabled=1 AND NOT EXISTS (SELECT 1 FROM scan_locks s WHERE s.library_id=r.library_id AND s.lease_expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type='scan' AND j.status IN ('queued','running','paused')
        AND (json_extract(j.payload,'$.libraryId')=r.library_id OR json_extract(j.payload,'$.libraryId') IS NULL))`).all(at) as { library_id: string }[];
    let queued = 0;
    for (const { library_id: libraryId } of pending) {
      const id = randomUUID();
      const inserted = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'scan','监控全量对账','queued','system',?,?,?)")
        .run(id, JSON.stringify({ libraryId }), at, `scan:${libraryId}`);
      if (!inserted.changes) continue;
      db.prepare('DELETE FROM watch_reconcile_requests WHERE library_id=?').run(libraryId);
      publishJob(db, id); queued++;
    }
    return queued;
  }).immediate();
}
