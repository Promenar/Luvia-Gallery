import type Database from 'better-sqlite3';
import { publishJob } from './job-view.ts';

export type JobRow = { id: string; type: string; checkpoint: string | null; payload: string | null };
const leaseSeconds = 30;
const seconds = () => Math.floor(Date.now() / 1000);

export class JobQueue {
  private db: Database.Database;
  private owner: string;

  constructor(db: Database.Database, owner: string) {
    if (!owner) throw new Error('缺少 worker 实例标识');
    this.db = db;
    this.owner = owner;
  }

  claim(at = seconds()): JobRow | null {
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE jobs SET status='queued', owner=NULL, heartbeat_at=NULL, lease_expires_at=NULL
        WHERE status='running' AND COALESCE(lease_expires_at,0)<=?`).run(at);
      const job = this.db.prepare("SELECT id,type,checkpoint,payload FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").get() as JobRow | undefined;
      if (!job) return null;
      const changed = this.db.prepare(`UPDATE jobs SET status='running', owner=?, heartbeat_at=?, lease_expires_at=?,
        started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`).run(this.owner, at, at + leaseSeconds, at, job.id);
      if (changed.changes === 1) publishJob(this.db, job.id);
      return changed.changes === 1 ? job : null;
    }).immediate();
  }

  renew(id: string, at = seconds()): boolean {
    return this.db.prepare(`UPDATE jobs SET heartbeat_at=?, lease_expires_at=? WHERE id=? AND status='running'
      AND owner=? AND lease_expires_at>?`).run(at, at + leaseSeconds, id, this.owner, at).changes === 1;
  }

  active(id: string, at = seconds()): boolean {
    return !!this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND owner=? AND lease_expires_at>?")
      .get(id, this.owner, at);
  }

  saveCheckpoint(id: string, checkpoint: unknown, at = seconds()): boolean {
    return this.db.prepare(`UPDATE jobs SET checkpoint=? WHERE id=? AND status='running' AND owner=?
      AND lease_expires_at>?`).run(JSON.stringify(checkpoint), id, this.owner, at).changes === 1;
  }

  finish(id: string, result: Record<string, number>, at = seconds()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=?, owner=NULL,
        heartbeat_at=NULL, lease_expires_at=NULL WHERE id=? AND status='running' AND owner=? AND lease_expires_at>?`)
        .run(JSON.stringify(result), at, id, this.owner, at).changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }

  fail(id: string, message: string, at = seconds()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='failed', error=?, finished_at=?, owner=NULL,
        heartbeat_at=NULL, lease_expires_at=NULL WHERE id=? AND status='running' AND owner=? AND lease_expires_at>?`)
        .run(message, at, id, this.owner, at).changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }

  release(id: string, at = seconds()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='queued', owner=NULL, heartbeat_at=NULL, lease_expires_at=NULL
        WHERE id=? AND status='running' AND owner=? AND lease_expires_at>?`).run(id, this.owner, at).changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }
}
