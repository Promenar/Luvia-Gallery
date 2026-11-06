import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { publishJob } from './job-view.ts';

export type JobRow = { id: string; type: string; checkpoint: string | null; payload: string | null; leaseToken: string };
const leaseSeconds = 30;
// 租约过期只表示作业可被接管（claim 会把它放回队列并换新令牌）；在被接管之前，原持有者凭 owner 与令牌仍可续租和收尾。
// 主线程或数据库短暂卡住超过租期时，不因此把仍在正常执行的作业判为失败。
const seconds = () => Math.floor(Date.now() / 1000);

export class JobQueue {
  private db: Database.Database;
  private owner: string;
  private leases = new Map<string, string>();

  constructor(db: Database.Database, owner: string) {
    if (!owner) throw new Error('缺少 worker 实例标识');
    this.db = db;
    this.owner = owner;
  }

  claim(at = seconds()): JobRow | null {
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE jobs SET status='queued', owner=NULL, heartbeat_at=NULL, lease_expires_at=NULL,lease_token=NULL
        WHERE status='running' AND COALESCE(lease_expires_at,0)<=?`).run(at);
      const job = this.db.prepare("SELECT id,type,checkpoint,payload FROM jobs WHERE status='queued' ORDER BY CASE WHEN dedupe_key LIKE 'media:%' OR dedupe_key LIKE 'hls:%' THEN 0 WHEN type IN ('metadata','previews') THEN 2 ELSE 1 END,created_at,id LIMIT 1").get() as Omit<JobRow, 'leaseToken'> | undefined;
      if (!job) return null;
      if (this.leases.has(job.id)) throw new Error('作业队列实例不可重复领取相同作业');
      const leaseToken = randomUUID();
      const changed = this.db.prepare(`UPDATE jobs SET status='running', owner=?, heartbeat_at=?, lease_expires_at=?,
        lease_token=?,started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`).run(this.owner, at, at + leaseSeconds, leaseToken, at, job.id);
      if (changed.changes === 1) { this.leases.set(job.id, leaseToken); publishJob(this.db, job.id); }
      return changed.changes === 1 ? { ...job, leaseToken } : null;
    }).immediate();
  }

  renew(id: string, at = seconds()): boolean {
    return this.db.prepare(`UPDATE jobs SET heartbeat_at=?, lease_expires_at=? WHERE id=? AND status='running'
      AND owner=? AND lease_token=?`).run(at, at + leaseSeconds, id, this.owner, this.leases.get(id) ?? '').changes === 1;
  }

  active(id: string, _at?: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND owner=? AND lease_token=?")
      .get(id, this.owner, this.leases.get(id) ?? '');
  }

  saveCheckpoint(id: string, checkpoint: unknown, _at?: number): boolean {
    return this.db.prepare(`UPDATE jobs SET checkpoint=? WHERE id=? AND status='running' AND owner=?
      AND lease_token=?`).run(JSON.stringify(checkpoint), id, this.owner, this.leases.get(id) ?? '').changes === 1;
  }

  finish(id: string, result: Record<string, number>, at = seconds()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=?, owner=NULL,
        heartbeat_at=NULL, lease_expires_at=NULL,lease_token=NULL WHERE id=? AND status='running' AND owner=? AND lease_token=?`)
        .run(JSON.stringify(result), at, id, this.owner, this.leases.get(id) ?? '').changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }

  fail(id: string, message: string, at = seconds()): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='failed', error=?, finished_at=?, owner=NULL,
        heartbeat_at=NULL, lease_expires_at=NULL,lease_token=NULL WHERE id=? AND status='running' AND owner=? AND lease_token=?`)
        .run(message, at, id, this.owner, this.leases.get(id) ?? '').changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }

  release(id: string, _at?: number): boolean {
    return this.db.transaction(() => {
      const changed = this.db.prepare(`UPDATE jobs SET status='queued', owner=NULL, heartbeat_at=NULL, lease_expires_at=NULL,lease_token=NULL
        WHERE id=? AND status='running' AND owner=? AND lease_token=?`).run(id, this.owner, this.leases.get(id) ?? '').changes === 1;
      if (changed) publishJob(this.db, id);
      return changed;
    }).immediate();
  }
}
