import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { publishJob } from './job-view.ts';
import type { MediaSource } from './media-cache.ts';

export type HlsSession = { id: string; media_id: string; principal_hash: string; source_size: number; source_modified: number;
  job_id: string | null; generation: string | null; state: string; last_access_at: number };
const USER_HLS_LIMIT = 8;
const SHARE_HLS_LIMIT = 2;
const PER_SHARE_HLS_LIMIT = 1;
const LEGACY_SHARE_PRINCIPAL = createHash('sha256').update('share:media').digest('hex');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const hlsId = (source: MediaSource, principal: string) => hash(JSON.stringify([source.id, source.size, source.modified_at, principal]));
export const hlsCacheKey = (session: string, generation: string, name: string) => hash(JSON.stringify([session, generation, name]));
export function hlsDirectory(cacheDir: string, session: string, generation: string): string {
  if (!/^[a-f0-9]{64}$/.test(session) || !/^[a-f0-9]{32}$/.test(generation)) throw new Error('HLS 缓存标识无效');
  return path.join(path.resolve(cacheDir), 'hls', session, generation);
}
export function ensureHls(db: Database.Database, source: MediaSource, principal: string): HlsSession | undefined {
  const id = hlsId(source, principal); const time = Date.now();
  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM hls_sessions WHERE id=?').get(id) as HlsSession | undefined;
    if (previous) {
      const job = previous.job_id ? db.prepare('SELECT status FROM jobs WHERE id=?').get(previous.job_id) as { status: string } | undefined : undefined;
      if (previous.state === 'ready' || job && ['queued', 'running', 'paused'].includes(job.status)) {
        const reset = previous.state !== 'ready' && previous.state !== 'running' && previous.state !== 'queued';
        db.prepare('UPDATE hls_sessions SET last_access_at=?,generation=?,state=? WHERE id=?')
          .run(time, reset ? null : previous.generation, reset ? 'queued' : previous.state, id);
        return { ...previous, last_access_at: time, generation: reset ? null : previous.generation, state: reset ? 'queued' : previous.state };
      }
    }
    const share = principal.startsWith('share:');
    const counts = db.prepare(`SELECT
      count(*) FILTER (WHERE s.principal_hash LIKE 'share:%' OR s.principal_hash=?) AS shares,
      count(*) FILTER (WHERE s.principal_hash=? ) AS current_share,
      count(*) FILTER (WHERE s.principal_hash IS NULL OR (s.principal_hash NOT LIKE 'share:%' AND s.principal_hash<>?)) AS users
      FROM jobs j LEFT JOIN hls_sessions s ON s.job_id=j.id
      WHERE j.dedupe_key LIKE 'hls:%' AND j.status IN ('queued','running','paused')`)
      .get(LEGACY_SHARE_PRINCIPAL, principal, LEGACY_SHARE_PRINCIPAL) as { shares: number; current_share: number; users: number };
    if (share ? counts.shares >= SHARE_HLS_LIMIT || counts.current_share >= PER_SHARE_HLS_LIMIT : counts.users >= USER_HLS_LIMIT) return undefined;
    const jobId = randomUUID();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'previews','视频转码','queued','system',?,unixepoch(),?)")
      .run(jobId, JSON.stringify({ hlsSessionId: id }), `hls:${id}`);
    db.prepare(`INSERT INTO hls_sessions(id,media_id,principal_hash,source_size,source_modified,job_id,generation,state,last_access_at)
      VALUES (?,?,?,?,?,?,NULL,'queued',?) ON CONFLICT(id) DO UPDATE SET job_id=excluded.job_id,generation=NULL,state='queued',last_access_at=excluded.last_access_at`)
      .run(id, source.id, principal, source.size, source.modified_at, jobId, time);
    publishJob(db, jobId);
    return db.prepare('SELECT * FROM hls_sessions WHERE id=?').get(id) as HlsSession;
  }).immediate();
}
