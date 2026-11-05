import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { JobQueue } from '../core/jobs.ts';
import { publishJob } from '../core/job-view.ts';
import { scanLibrary } from './scan.ts';
import { importLegacy, reconcileLegacyFavorites } from './import-legacy.ts';
import { generateMediaCache } from './media-cache.ts';
import path from 'node:path';
import { pruneCache } from './cache-prune.ts';
import { readSettings } from '../core/settings.ts';
import { processMetadataBatch } from './metadata.ts';
import { cacheKey, enqueueMediaTask } from '../core/media-cache.ts';
import type { Variant } from '../core/media-cache.ts';
import { generateHls } from './hls.ts';
import { withThumbnailSlot } from './ffmpeg-slots.ts';

export type WorkerOptions = { owner: string; allowedRoots: string[]; legacyDir: string; systemRoots: string[]; cacheDir?: string; signal?: AbortSignal; hlsIdleMs?: number; log?: (level: 'info' | 'warn', message: string, ctx: Record<string, string>) => void };
type Payload = { libraryId?: string | null; legacyImportId?: string; mediaId?: string; hlsSessionId?: string };
const now = () => Math.floor(Date.now() / 1000);
const childId = (parent: string, library: string) => `scan_${createHash('sha256').update(parent).update('\0').update(library).digest('base64url').slice(0, 24)}`;
function enqueueScan(db: Database.Database, id: string, libraryId: string, legacyImportId?: string) {
  db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描媒体库','queued','system',?,?)")
    .run(id, JSON.stringify({ libraryId, legacyImportId }), now());
}
function enqueueMetadata(db: Database.Database, libraryId: string) {
  const id = randomUUID();
  const result = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'metadata','提取元数据','queued','system',?,?,?)")
    .run(id, JSON.stringify({ libraryId }), now(), `metadata:${libraryId}`);
  if (result.changes) publishJob(db, id);
}
function enqueuePreviews(db: Database.Database, libraryId?: string | null) {
  if (!readSettings(db).previews.enabled) return;
  const id = randomUUID();
  const result = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'previews','生成视频预览','queued','system',?,?,?)")
    .run(id, JSON.stringify({ libraryId: libraryId ?? null }), now(), `previews:${libraryId ?? 'all'}`);
  if (result.changes) publishJob(db, id);
}

export async function runNextJob(db: Database.Database, options: WorkerOptions): Promise<boolean> {
  const queue = new JobQueue(db, options.owner);
  const job = queue.claim();
  if (!job) return false;
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) controller.abort();
  const assertLease = () => { if (!queue.active(job.id)) throw new Error('作业租约已失效'); };
  const timer = setInterval(() => {
    try { if (!queue.renew(job.id)) controller.abort(); }
    catch { controller.abort(); }
  }, 5000);
  timer.unref();
  try {
    const payload = job.payload ? JSON.parse(job.payload) as Payload : {};
    if (job.type === 'scan') {
      if (!payload.libraryId) {
        const libraries = db.prepare('SELECT id FROM libraries WHERE enabled=1').all() as { id: string }[];
        db.transaction(() => {
          assertLease();
          for (const library of libraries) enqueueScan(db, childId(job.id, library.id), library.id);
          if (!queue.finish(job.id, { queued: libraries.length })) throw new Error('作业租约已失效');
        }).immediate();
      } else {
        const library = db.prepare('SELECT id,root FROM libraries WHERE id=? AND enabled=1').get(payload.libraryId) as { id: string; root: string } | undefined;
        if (!library) throw new Error('媒体库不可用');
        const result = await scanLibrary(db, library, { allowedRoots: options.allowedRoots, owner: options.owner, jobId: job.id, signal: controller.signal });
        if (result.errors) {
          db.transaction(() => {
            assertLease();
            db.prepare("UPDATE libraries SET status='unavailable' WHERE id=? AND NOT EXISTS(SELECT 1 FROM scan_locks WHERE library_id=? AND lease_expires_at>?)")
              .run(library.id, library.id, now());
          }).immediate();
          throw new Error('媒体库存在读取错误');
        }
        const reconciled = reconcileLegacyFavorites(db, { finalize: false, assertLease });
        db.transaction(() => {
          assertLease();
          db.prepare("UPDATE libraries SET status='ok',last_scan_at=? WHERE id=?").run(now(), library.id);
          if (!queue.finish(job.id, result)) throw new Error('作业租约已失效');
          enqueueMetadata(db, library.id);
          db.prepare("INSERT INTO job_events(event_type,payload) VALUES ('library',?)")
            .run(JSON.stringify({ folders: [library.id], added: result.added, removed: result.removed, updated: 0 }));
          if (payload.legacyImportId) {
            const other = db.prepare("SELECT count(*) AS n FROM jobs WHERE type='scan' AND json_extract(payload,'$.legacyImportId')=? AND status<>'succeeded'")
              .get(payload.legacyImportId) as { n: number };
            const finalCounts = other.n === 0 ? reconcileLegacyFavorites(db, { finalize: true }) : reconciled;
            const parent = db.prepare('SELECT result FROM jobs WHERE id=?').get(payload.legacyImportId) as { result: string | null } | undefined;
            if (parent?.result) {
              db.prepare('UPDATE jobs SET result=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(parent.result), ...finalCounts }), payload.legacyImportId);
              publishJob(db, payload.legacyImportId);
            }
          }
        }).immediate();
      }
    } else if (job.type === 'import_legacy') {
      const result = await importLegacy(db, { legacyDir: options.legacyDir, mediaRoots: options.allowedRoots, systemRoots: options.systemRoots, assertLease });
      db.transaction(() => {
        assertLease();
        const libraries = db.prepare('SELECT id FROM libraries WHERE enabled=1').all() as { id: string }[];
        for (const library of libraries) enqueueScan(db, childId(job.id, library.id), library.id, job.id);
        const finalCounts = libraries.length ? result : { ...result, ...reconcileLegacyFavorites(db, { finalize: true }) };
        db.prepare("INSERT INTO settings(key,value) VALUES('legacy.pending','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
        if (!queue.finish(job.id, finalCounts)) throw new Error('作业租约已失效');
      }).immediate();
    } else if (job.type === 'metadata') {
      const result = await processMetadataBatch(db, job, { owner: options.owner, allowedRoots: options.allowedRoots, libraryId: payload.libraryId, assertLease, signal: controller.signal });
      if (result.complete) {
        db.transaction(() => {
          if (!queue.finish(job.id, result.counts)) throw new Error('作业租约已失效');
          enqueuePreviews(db, payload.libraryId);
        }).immediate();
      } else if (!queue.release(job.id)) throw new Error('作业租约已失效');
    } else if (job.type === 'previews' && payload.hlsSessionId) {
      const result = await generateHls(db, payload.hlsSessionId, job.id, { owner: options.owner, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots, assertLease, signal: controller.signal, idleMs: options.hlsIdleMs });
      if (!queue.finish(job.id, result)) throw new Error('作业租约已失效');
    } else if ((job.type === 'previews' || job.type === 'thumbnails') && !payload.mediaId) {
      if (job.type === 'previews' && !readSettings(db).previews.enabled) {
        if (!queue.finish(job.id, { queued: 0 })) throw new Error('作业租约已失效');
      } else {
        const checkpoint = job.checkpoint ? JSON.parse(job.checkpoint) as { lastId?: string; queued?: number } : {};
        let lastId = checkpoint.lastId ?? ''; let queued = checkpoint.queued ?? 0;
        const rows = db.prepare(`SELECT f.id,f.size,f.modified_at FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
          WHERE ${job.type === 'previews' ? "f.media_type='video' AND f.has_preview=0" : "f.media_type IN ('image','video')"} AND f.id>?
          ${payload.libraryId ? 'AND f.library_id=?' : ''} ORDER BY f.id LIMIT 32`).all(...(payload.libraryId ? [lastId, payload.libraryId] : [lastId])) as { id: string; size: number; modified_at: number }[];
        for (const row of rows) {
          controller.signal.throwIfAborted();
          db.transaction(() => {
            assertLease();
            const variants: Variant[] = job.type === 'previews' ? [{ kind: 'preview' }] : [
              { kind: 'thumb', size: 's' }, { kind: 'thumb', size: 'm' }, { kind: 'thumb', size: 'l' },
            ];
            for (const variant of variants) {
              const key = cacheKey(row, variant);
              if (db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=?').get(key) || db.prepare("SELECT 1 FROM jobs WHERE dedupe_key=? AND status IN ('queued','running','paused')").get(`media:${key}`)) continue;
              enqueueMediaTask(db, row, variant); queued++;
            }
            lastId = row.id;
            db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify({ lastId, queued }), queued, job.id);
          }).immediate();
        }
        if (rows.length < 32) {
          if (!queue.finish(job.id, { queued })) throw new Error('作业租约已失效');
        } else if (!queue.release(job.id)) throw new Error('作业租约已失效');
      }
    } else if (job.type === 'thumbnails') {
      await withThumbnailSlot(db, options.owner, (signal) => generateMediaCache(db, payload, { owner: options.owner, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots, assertLease, signal }), { signal: controller.signal, assertLease });
      if (!queue.finish(job.id, { generated: 1 })) throw new Error('作业租约已失效');
    } else if (job.type === 'previews') {
      await generateMediaCache(db, payload, { owner: options.owner, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots, assertLease, signal: controller.signal });
      if (!queue.finish(job.id, { generated: 1 })) throw new Error('作业租约已失效');
    } else if (job.type === 'cache_prune') {
      const result = await pruneCache(db, options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), readSettings(db).cache.limitGB * 1024 ** 3, assertLease);
      if (!queue.finish(job.id, result)) throw new Error('作业租约已失效');
    } else if (job.type === 'health_check') {
      if (!queue.finish(job.id, { checked: 1 })) throw new Error('作业租约已失效');
    } else {
      throw new Error('作业类型尚未实现');
    }
  } catch (error) {
    const message = error instanceof Error && error.message === '作业类型尚未实现' ? error.message : '作业执行失败，请检查媒体库及工作进程';
    if (options.signal?.aborted) queue.release(job.id);
    else queue.fail(job.id, message);
  } finally {
    clearInterval(timer); options.signal?.removeEventListener('abort', stop);
    const final = db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as { status: string } | undefined;
    if (final?.status === 'succeeded' || final?.status === 'failed') options.log?.(final.status === 'failed' ? 'warn' : 'info', '作业结束', { type: job.type, status: final.status });
  }
  return true;
}

export function newWorkerOwner(): string { return randomUUID(); }
