import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { publishJob } from './job-view.ts';

export type JobRow = { id: string; type: string; checkpoint: string | null; payload: string | null; leaseToken: string };
const leaseSeconds = 30;
// 租约过期只表示作业可被接管（claim 会把它放回队列并换新令牌）；在被接管之前，原持有者凭 owner 与令牌仍可续租和收尾。
// 主线程或数据库短暂卡住超过租期时，不因此把仍在正常执行的作业判为失败。
const seconds = () => Math.floor(Date.now() / 1000);
/** 本进程内仍在执行的作业（按 owner）。进程活着时由同一进程的其它槽位接管只会重复执行、并让原执行失败，所以只允许其它进程接管。 */
const running = new Map<string, Set<string>>();
let preferHls = true;

export class JobQueue {
  private db: Database.Database;
  private owner: string;
  private leases = new Map<string, string>();

  constructor(db: Database.Database, owner: string) {
    if (!owner) throw new Error('缺少 worker 实例标识');
    this.db = db;
    this.owner = owner;
  }

  claim(at = seconds(), options: { maxActivePreviews?: number | (() => number) } = {}): JobRow | null {
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE jobs SET status='queued', owner=NULL, heartbeat_at=NULL, lease_expires_at=NULL,lease_token=NULL
        WHERE status='running' AND COALESCE(lease_expires_at,0)<=? AND NOT (COALESCE(owner,'')=? AND id IN (SELECT value FROM json_each(?)))`)
        .run(at, this.owner, JSON.stringify([...(running.get(this.owner) ?? [])]));
      const limit = typeof options.maxActivePreviews === 'function' ? options.maxActivePreviews() : options.maxActivePreviews;
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error('预览并发上限无效');
      const active = limit === undefined ? 0 : (this.db.prepare("SELECT count(*) AS n FROM jobs WHERE status='running' AND type='previews' AND (dedupe_key LIKE 'media:%' OR dedupe_key LIKE 'hls:%')").get() as { n: number }).n;
      const allowMedia = limit === undefined || active < limit;
      const pendingMedia = !allowMedia && !!this.db.prepare("SELECT 1 FROM jobs WHERE status='queued' AND type='previews' AND (dedupe_key LIKE 'media:%' OR dedupe_key LIKE 'hls:%') LIMIT 1").get();
      // 预览并发已满且还有逐文件任务排队时，让分发作业等待，避免一次排入整个视频库。
      // 两类前台请求同时排队时交替领取，等待者续租不会重置类别间的公平性。
      const waiting = this.db.prepare(`SELECT j.id,j.type,j.checkpoint,j.payload FROM media_waiters w INDEXED BY media_waiters_expiry CROSS JOIN jobs j ON j.id=w.job_id
        WHERE w.lease_expires_at>? AND j.status='queued'
        AND (?=1 OR j.type<>'previews' OR (COALESCE(j.dedupe_key,'') NOT LIKE 'media:%' AND COALESCE(j.dedupe_key,'') NOT LIKE 'hls:%'))
        ORDER BY w.rowid,j.id LIMIT 1`).get(at, allowMedia ? 1 : 0) as Omit<JobRow, 'leaseToken'> | undefined;
      const hls = allowMedia ? this.db.prepare(`SELECT id,type,checkpoint,payload,created_at FROM jobs INDEXED BY jobs_active_dedupe
        WHERE dedupe_key>='hls:' AND dedupe_key<'hls;' AND status IN ('queued','running','paused') AND status='queued'
        ORDER BY created_at,id LIMIT 1`).get() as (Omit<JobRow, 'leaseToken'> & { created_at: number }) | undefined : undefined;
      const interactive = waiting && hls ? (preferHls ? hls : waiting) : waiting ?? hls;
      const job = interactive ?? this.db.prepare(`SELECT id,type,checkpoint,payload FROM jobs WHERE status='queued'
        AND (?=1 OR type<>'previews' OR (COALESCE(dedupe_key,'') NOT LIKE 'media:%' AND COALESCE(dedupe_key,'') NOT LIKE 'hls:%'))
        AND (?=1 OR type<>'previews' OR COALESCE(dedupe_key,'') LIKE 'media:%' OR COALESCE(dedupe_key,'') LIKE 'hls:%')
        ORDER BY CASE
          WHEN dedupe_key LIKE 'hls:%' THEN 0
          WHEN dedupe_key LIKE 'media:%' THEN 1 WHEN type IN ('metadata','previews') THEN 3 ELSE 2 END,created_at,id LIMIT 1`)
        .get(allowMedia ? 1 : 0, pendingMedia ? 0 : 1) as Omit<JobRow, 'leaseToken'> | undefined;
      if (!job) return null;
      if (this.leases.has(job.id)) throw new Error('作业队列实例不可重复领取相同作业');
      const leaseToken = randomUUID();
      const changed = this.db.prepare(`UPDATE jobs SET status='running', owner=?, heartbeat_at=?, lease_expires_at=?,
        lease_token=?,started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'`).run(this.owner, at, at + leaseSeconds, leaseToken, at, job.id);
      if (changed.changes === 1) {
        if (waiting && hls) preferHls = !preferHls;
        this.db.prepare('DELETE FROM media_waiters WHERE id=?').run(`priority:${job.id}`);
        this.leases.set(job.id, leaseToken); publishJob(this.db, job.id);
        let ids = running.get(this.owner); if (!ids) running.set(this.owner, ids = new Set()); ids.add(job.id);
      }
      return changed.changes === 1 ? { ...job, leaseToken } : null;
    }).immediate();
  }

  /** 本次执行结束（无论结果）后调用，之后该作业的过期租约才可被本进程重新领取。 */
  settle(id: string): void {
    const ids = running.get(this.owner); ids?.delete(id); if (ids && !ids.size) running.delete(this.owner);
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
