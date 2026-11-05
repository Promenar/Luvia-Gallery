import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { publishJob } from '../core/job-view.ts';

/** 保存发生在扫描期间的请求，直到扫描锁与已有作业均释放。 */
export function requestWatchReconcile(db: Database.Database, libraryId: string, reason: string): void {
  db.prepare(`INSERT INTO watch_reconcile_requests(library_id,reason,requested_at) VALUES (?,?,unixepoch())
    ON CONFLICT(library_id) DO UPDATE SET reason=excluded.reason,requested_at=excluded.requested_at,generation=generation+1`).run(libraryId, reason);
}

const retryDelay = (attempts: number) => [60, 300, 900, 3600][Math.min(Math.max(attempts - 1, 0), 3)]!;

/** 作业终态和请求状态由调用方放在同一事务中更新。 */
export function finishWatchReconcile(db: Database.Database, jobId: string, succeeded: boolean, at = Math.floor(Date.now() / 1000)): void {
  const row = db.prepare('SELECT library_id,generation,job_generation,attempts FROM watch_reconcile_requests WHERE job_id=?').get(jobId) as
    { library_id: string; generation: number; job_generation: number; attempts: number } | undefined;
  if (!row) return;
  if (succeeded && row.generation === row.job_generation) {
    db.prepare('DELETE FROM watch_reconcile_requests WHERE library_id=? AND job_id=?').run(row.library_id, jobId);
  } else if (succeeded) {
    db.prepare('UPDATE watch_reconcile_requests SET job_id=NULL,job_generation=NULL,attempts=0,next_attempt_at=0 WHERE library_id=? AND job_id=?').run(row.library_id, jobId);
  } else {
    const attempts = row.attempts + 1;
    db.prepare('UPDATE watch_reconcile_requests SET job_id=NULL,job_generation=NULL,attempts=?,next_attempt_at=? WHERE library_id=? AND job_id=?')
      .run(attempts, at + retryDelay(attempts), row.library_id, jobId);
  }
}

export function flushWatchReconciles(db: Database.Database, at = Math.floor(Date.now() / 1000)): number {
  return db.transaction(() => {
    const completed = db.prepare(`SELECT r.job_id,j.status FROM watch_reconcile_requests r LEFT JOIN jobs j ON j.id=r.job_id
      WHERE r.job_id IS NOT NULL AND (j.id IS NULL OR j.status IN ('succeeded','failed','cancelled'))`).all() as { job_id: string; status: string | null }[];
    for (const row of completed) finishWatchReconcile(db, row.job_id, row.status === 'succeeded', at);
    const pending = db.prepare(`SELECT r.library_id,r.generation FROM watch_reconcile_requests r JOIN libraries l ON l.id=r.library_id
      WHERE r.job_id IS NULL AND r.next_attempt_at<=? AND l.enabled=1 AND NOT EXISTS (SELECT 1 FROM scan_locks s WHERE s.library_id=r.library_id AND s.lease_expires_at>?)
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type='scan' AND j.status IN ('queued','running','paused')
        AND (json_extract(j.payload,'$.libraryId')=r.library_id OR json_extract(j.payload,'$.libraryId') IS NULL))`).all(at, at) as { library_id: string; generation: number }[];
    let queued = 0;
    for (const { library_id: libraryId, generation } of pending) {
      const id = randomUUID();
      const inserted = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'scan','监控全量对账','queued','system',?,?,?)")
        .run(id, JSON.stringify({ libraryId }), at, `scan:${libraryId}`);
      if (!inserted.changes) continue;
      db.prepare('UPDATE watch_reconcile_requests SET job_id=?,job_generation=? WHERE library_id=? AND job_id IS NULL').run(id, generation, libraryId);
      publishJob(db, id); queued++;
    }
    return queued;
  }).immediate();
}
