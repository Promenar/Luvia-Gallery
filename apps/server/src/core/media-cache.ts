import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { publishJob } from './job-view.ts';

export type MediaSource = { id: string; size: number; modified_at: number };
export type Variant = { kind: 'thumb'; size: 's' | 'm' | 'l' } | { kind: 'display' } | { kind: 'dimensions' } | { kind: 'preview' } | { kind: 'tile'; level: number; col: number; row: number };
export type MediaTask = { mediaId: string; sourceSize: number; sourceModified: number; variant: Variant };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function cacheKey(source: MediaSource, variant: Variant): string {
  return digest(JSON.stringify([source.id, source.size, source.modified_at, variant]));
}
export function cachePath(cacheDir: string, source: MediaSource, variant: Variant): string {
  const key = cacheKey(source, variant);
  return path.join(cacheDir, 'media', key.slice(0, 2), `${key}.${variant.kind === 'preview' ? 'mp4' : 'webp'}`);
}
export function enqueueMediaTask(db: Database.Database, source: MediaSource, variant: Variant, options: { waiter?: string } = {}): string {
  const key = `media:${cacheKey(source, variant)}`;
  return db.transaction(() => {
    const id = randomUUID();
    const payload: MediaTask = { mediaId: source.id, sourceSize: source.size, sourceModified: source.modified_at, variant };
    const result = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key,media_background) VALUES (?,?,?,'queued','system',?,unixepoch(),?,?)")
      .run(id, variant.kind === 'preview' ? 'previews' : 'thumbnails', variant.kind === 'preview' ? '生成视频预览' : '生成媒体缓存', JSON.stringify(payload), key, options.waiter ? 0 : 1);
    const job = result.changes ? id : (db.prepare("SELECT id FROM jobs WHERE dedupe_key=? AND status IN ('queued','running','paused')").get(key) as { id: string }).id;
    if (result.changes) publishJob(db, job);
    if (options.waiter) db.prepare('INSERT INTO media_waiters(id,job_id,lease_expires_at) VALUES (?,?,unixepoch()+30)').run(options.waiter, job);
    else db.prepare('UPDATE jobs SET media_background=1 WHERE id=?').run(job);
    return job;
  }).immediate();
}

export function cancelUnobservedMediaTask(db: Database.Database, job: string): boolean {
  return db.transaction(() => {
    db.prepare('DELETE FROM media_waiters WHERE job_id=? AND lease_expires_at<=unixepoch()').run(job);
    const changed = db.prepare(`UPDATE jobs SET status='cancelled',finished_at=unixepoch(),owner=NULL,heartbeat_at=NULL,lease_expires_at=NULL,lease_token=NULL
      WHERE id=? AND media_background=0 AND status IN ('queued','running','paused') AND NOT EXISTS
      (SELECT 1 FROM media_waiters WHERE job_id=? AND lease_expires_at>unixepoch())`).run(job, job).changes;
    if (changed) publishJob(db, job);
    return !!changed;
  }).immediate();
}

export function releaseMediaWaiter(db: Database.Database, job: string, waiter: string, cancel: boolean): void {
  db.transaction(() => {
    db.prepare('DELETE FROM media_waiters WHERE id=? AND job_id=?').run(waiter, job);
    if (cancel) cancelUnobservedMediaTask(db, job);
    else db.prepare('UPDATE jobs SET media_background=1 WHERE id=?').run(job);
  }).immediate();
}
