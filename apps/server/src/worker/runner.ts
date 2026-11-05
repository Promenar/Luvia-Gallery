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

type Options = { owner: string; allowedRoots: string[]; legacyDir: string; systemRoots: string[]; cacheDir?: string; signal?: AbortSignal };
type Payload = { libraryId?: string | null; legacyImportId?: string };
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

export async function runNextJob(db: Database.Database, options: Options): Promise<boolean> {
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
        if (result.errors) throw new Error('媒体库存在读取错误');
        const reconciled = reconcileLegacyFavorites(db, { finalize: false, assertLease });
        db.transaction(() => {
          assertLease();
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
        if (!queue.finish(job.id, result.counts)) throw new Error('作业租约已失效');
      } else if (!queue.release(job.id)) throw new Error('作业租约已失效');
    } else if (job.type === 'thumbnails') {
      await generateMediaCache(db, payload, { cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots, assertLease, signal: controller.signal });
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
  } finally { clearInterval(timer); options.signal?.removeEventListener('abort', stop); }
  return true;
}

export function newWorkerOwner(): string { return randomUUID(); }
