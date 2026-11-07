import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { lstat } from 'node:fs/promises';
import { JobQueue } from '../core/jobs.ts';
import { publishJob } from '../core/job-view.ts';
import { scanLibrary } from './scan.ts';
import { publishScanChanges } from './watch-events.ts';
import { importLegacy, LegacyIdentityUncertainError, reconcileLegacyFavorites } from './import-legacy.ts';
import { generateMediaCache } from './media-cache.ts';
import path from 'node:path';
import { pruneCache } from './cache-prune.ts';
import { readSettings } from '../core/settings.ts';
import { processMetadataBatch } from './metadata.ts';
import { processThumbnailBackfill } from './thumbnail-backfill.ts';
import { cacheKey, cachePath, cancelUnobservedMediaTask, enqueueMediaTask } from '../core/media-cache.ts';
import type { Variant } from '../core/media-cache.ts';
import { classifyMediaFailure, clearMediaFailure, mediaIgnored, recordMediaFailure } from '../core/media-failures.ts';
import { generateHls } from './hls.ts';
import { FfmpegExitError, NoVideoPacketsError, withThumbnailSlot } from './ffmpeg-slots.ts';
import { isImageDecodeError } from './image-decoding.ts';
import { withMediaGenerationLock } from './media-lock.ts';
import { finishWatchReconcile } from './watch-reconcile-queue.ts';
import { isTransientSqliteError, renewLease } from '../core/sqlite-errors.ts';

export type WorkerOptions = { owner: string; allowedRoots: string[]; legacyDir: string; systemRoots: string[]; configuredMediaRoots?: string[]; cacheDir?: string; signal?: AbortSignal; hlsIdleMs?: number; log?: (level: 'info' | 'warn', message: string, ctx: Record<string, string>) => void };
/** dimensionsOnly 只出现在已下线的“补全照片宽高”作业的历史记录里。 */
type Payload = { libraryId?: string | null; dimensionsOnly?: boolean; recovery?: boolean; recoveryIds?: string[]; preserveUnindexed?: boolean; legacyImportId?: string; mediaId?: string; hlsSessionId?: string; sourceSize?: number; sourceModified?: number; sourceGeneration?: number; variant?: Variant };
/** SQLite 暂时繁忙（锁等待超时），稍后重试即可恢复。 */
export { isTransientSqliteError };
const now = () => Math.floor(Date.now() / 1000);
function safeScanError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return '媒体库根目录或扫描目录不可用';
  if (code === 'EACCES' || code === 'EPERM') return '媒体库目录读取权限不足';
  const message = error instanceof Error ? error.message : '';
  if (message.includes('挂载') || message.includes('根目录')) return '媒体库挂载身份或根目录不可用';
  if (message === '媒体库存在读取错误') return '媒体库扫描存在读取错误或挂载中断';
  if (message === '媒体库不可用') return '媒体库已停用或不存在';
  return '媒体库扫描失败，请检查挂载和工作进程';
}
const childId = (parent: string, library: string) => `scan_${createHash('sha256').update(parent).update('\0').update(library).digest('base64url').slice(0, 24)}`;
function enqueueScan(db: Database.Database, id: string, libraryId: string, legacyImportId?: string) {
  db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描媒体库','queued','system',?,?)")
    .run(id, JSON.stringify({ libraryId, legacyImportId }), now());
}
export function enqueueMetadata(db: Database.Database, libraryId: string) {
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
  const job = queue.claim(undefined, { maxActivePreviews: () => readSettings(db).workers.ffmpegConcurrency });
  if (!job) return false;
  const controller = new AbortController();
  const stop = () => controller.abort();
  options.signal?.addEventListener('abort', stop, { once: true });
  if (options.signal?.aborted) controller.abort();
  const assertLease = () => { if (!queue.active(job.id)) throw new Error('作业租约已失效'); };
  const timer = setInterval(() => renewLease(() => queue.renew(job.id), () => controller.abort()), 5000);
  timer.unref();
  let waiterTimer: NodeJS.Timeout | undefined;
  try {
    const payload = job.payload ? JSON.parse(job.payload) as Payload : {};
    if (payload.mediaId && payload.sourceSize !== undefined && payload.sourceModified !== undefined && payload.variant &&
        mediaIgnored(db, { id: payload.mediaId, size: payload.sourceSize, modified_at: payload.sourceModified, cache_generation: payload.sourceGeneration ?? 0 }, payload.variant)) {
      if (!queue.cancel(job.id)) throw new Error('作业租约已失效');
      return true;
    }
    if (job.type === 'thumbnails' && payload.mediaId) {
      const checkWaiters = () => {
        try { if (cancelUnobservedMediaTask(db, job.id) || !queue.active(job.id)) controller.abort(); }
        catch { controller.abort(); }
      };
      checkWaiters();
      waiterTimer = setInterval(checkWaiters, 250); waiterTimer.unref();
      controller.signal.throwIfAborted();
    }
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
        let result;
        try { result = await scanLibrary(db, library, { allowedRoots: options.allowedRoots, owner: options.owner, jobId: job.id, jobLeaseToken: job.leaseToken, signal: controller.signal, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), log: options.log }); }
        catch (error) {
          if (error instanceof Error && error.message === '媒体库正在扫描' && queue.active(job.id)) {
            await delay(500, undefined, { signal: controller.signal });
            if (!queue.release(job.id)) throw new Error('作业租约已失效');
            return true;
          }
          throw error;
        }
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
          finishWatchReconcile(db, job.id, true);
          enqueueMetadata(db, library.id);
          publishScanChanges(db, job.id, library.id, true);
          if (payload.legacyImportId) {
            const other = db.prepare("SELECT count(*) AS n FROM jobs WHERE type='scan' AND json_extract(payload,'$.legacyImportId')=? AND status<>'succeeded'")
              .get(payload.legacyImportId) as { n: number };
            const finalCounts = other.n === 0 ? reconcileLegacyFavorites(db, { finalize: true }) : reconciled;
            const parent = db.prepare('SELECT result FROM jobs WHERE id=?').get(payload.legacyImportId) as { result: string | null } | undefined;
            if (parent?.result) {
              db.prepare('UPDATE jobs SET result=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(parent.result), ...finalCounts }), payload.legacyImportId);
              publishJob(db, payload.legacyImportId);
            }
          } else {
            const parent = db.prepare("SELECT id,result FROM jobs WHERE type='import_legacy' AND status='succeeded' ORDER BY created_at DESC,id DESC LIMIT 1").get() as { id: string; result: string | null } | undefined;
            if (parent?.result) {
              const previous = JSON.parse(parent.result) as Record<string, number>;
              if (previous.imported !== reconciled.imported || previous.pending !== reconciled.pending || previous.unmatched !== reconciled.unmatched) {
                db.prepare('UPDATE jobs SET result=? WHERE id=?').run(JSON.stringify({ ...previous, ...reconciled }), parent.id);
                publishJob(db, parent.id);
              }
            }
          }
        }).immediate();
      }
    } else if (job.type === 'import_legacy') {
      const result = await importLegacy(db, { legacyDir: options.legacyDir, mediaRoots: options.allowedRoots, fallbackRoots: options.configuredMediaRoots, systemRoots: options.systemRoots, assertLease });
      db.transaction(() => {
        assertLease();
        const libraries = db.prepare('SELECT id FROM libraries WHERE enabled=1').all() as { id: string }[];
        for (const library of libraries) enqueueScan(db, childId(job.id, library.id), library.id, job.id);
        const finalCounts = libraries.length ? result : { ...result, ...reconcileLegacyFavorites(db, { finalize: true }) };
        db.prepare("INSERT INTO settings(key,value) VALUES('legacy.pending','false') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
        if (!queue.finish(job.id, finalCounts)) throw new Error('作业租约已失效');
      }).immediate();
    } else if (job.type === 'metadata') {
      const result = await processMetadataBatch(db, job, { owner: options.owner, allowedRoots: options.allowedRoots, libraryId: payload.libraryId, recoveryIds: payload.recoveryIds, assertLease, signal: controller.signal });
      if (result.complete) {
        db.transaction(() => {
          if (!queue.finish(job.id, result.counts)) throw new Error('作业租约已失效');
          if (!payload.recovery) enqueuePreviews(db, payload.libraryId);
        }).immediate();
      } else if (!queue.release(job.id)) throw new Error('作业租约已失效');
    } else if (job.type === 'previews' && payload.hlsSessionId) {
      const result = await generateHls(db, payload.hlsSessionId, job.id, { owner: options.owner, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots, assertLease, signal: controller.signal, idleMs: options.hlsIdleMs });
      if (!queue.finish(job.id, result)) throw new Error('作业租约已失效');
    } else if (job.type === 'thumbnails' && !payload.mediaId && payload.dimensionsOnly) {
      // “补全照片宽高”已下线（宽高由后台拍摄信息读取写入）；重试其历史作业时直接结束，不改为生成全库缩略图
      if (!queue.finish(job.id, { queued: 0 })) throw new Error('作业租约已失效');
    } else if (job.type === 'thumbnails' && !payload.mediaId) {
      const result = await processThumbnailBackfill(db, job, { owner: options.owner, cacheDir: options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), allowedRoots: options.allowedRoots,
        libraryId: payload.libraryId, assertLease, signal: controller.signal });
      if (result.complete) { if (!queue.finish(job.id, result.counts)) throw new Error('作业租约已失效'); }
      else if (!queue.release(job.id)) throw new Error('作业租约已失效');
    } else if (job.type === 'previews' && !payload.mediaId) {
      if (!readSettings(db).previews.enabled) {
        if (!queue.finish(job.id, { queued: 0 })) throw new Error('作业租约已失效');
      } else {
        const checkpoint = job.checkpoint ? JSON.parse(job.checkpoint) as { lastId?: string; queued?: number } : {};
        let lastId = checkpoint.lastId ?? ''; let queued = checkpoint.queued ?? 0;
        // 将每轮扫描分成较小的读取块，避免大库随机读取长时间占用事件循环。
        const read = db.prepare(`SELECT f.id,f.size,f.modified_at,f.cache_generation,f.media_type,f.has_preview,f.missing_at_ms,f.library_id,l.enabled
          FROM files f INDEXED BY sqlite_autoindex_files_1 CROSS JOIN libraries l ON l.id=f.library_id
          WHERE f.id>? ORDER BY f.id LIMIT 64`);
        let eligible = 0; let scanned = 0; let exhausted = false;
        while (scanned < 512 && eligible < 32) {
          controller.signal.throwIfAborted(); assertLease();
          const rows = read.all(lastId) as { id: string; size: number; modified_at: number; cache_generation: number; media_type: string; has_preview: number; missing_at_ms: number | null; library_id: string; enabled: number }[];
          let consumed = 0;
          for (const row of rows) {
            controller.signal.throwIfAborted();
            consumed++; scanned++; lastId = row.id;
            if (!row.enabled || row.media_type !== 'video' || row.has_preview || row.missing_at_ms !== null || (payload.libraryId && row.library_id !== payload.libraryId)) continue;
            eligible++;
            db.transaction(() => {
              assertLease();
              const variants: Variant[] = [{ kind: 'preview' }];
              for (const variant of variants) {
                if (mediaIgnored(db, row, variant)) continue;
                const key = cacheKey(row, variant);
                if (db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=?').get(key)) continue;
                const existing = db.prepare("SELECT 1 FROM jobs WHERE dedupe_key=? AND status IN ('queued','running','paused')").get(`media:${key}`);
                enqueueMediaTask(db, row, variant);
                if (!existing) queued++;
              }
              db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify({ lastId, queued }), queued, job.id);
            }).immediate();
            if (eligible >= 32) break;
          }
          if (rows.length < 64 && consumed === rows.length) { exhausted = true; break; }
          if (scanned < 512 && eligible < 32) {
            await new Promise<void>((resolve) => setImmediate(resolve));
          }
        }
        db.transaction(() => {
          assertLease();
          db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify({ lastId, queued }), queued, job.id);
        }).immediate();
        if (exhausted) {
          if (!queue.finish(job.id, { queued })) throw new Error('作业租约已失效');
        } else {
          if (!queue.release(job.id)) throw new Error('作业租约已失效');
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
    } else if (job.type === 'thumbnails' || job.type === 'previews') {
      const key = (db.prepare('SELECT dedupe_key FROM jobs WHERE id=?').get(job.id) as { dedupe_key: string | null }).dedupe_key ?? `job:${job.id}`;
      const cacheDir = options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache');
      const generated = await withMediaGenerationLock(db, options.owner, key, async (signal, assertMediaLease) => {
        if (payload.mediaId && payload.sourceSize !== undefined && payload.sourceModified !== undefined && payload.variant) {
          const source = { id: payload.mediaId, size: payload.sourceSize, modified_at: payload.sourceModified, cache_generation: payload.sourceGeneration ?? 0 };
          const cached = db.prepare(`SELECT 1 FROM cache_entries c JOIN files f ON f.id=c.media_id JOIN libraries l ON l.id=f.library_id AND l.enabled=1
            WHERE c.cache_key=? AND f.size=? AND f.modified_at=? AND f.cache_generation=? AND f.missing_at_ms IS NULL`).get(cacheKey(source, payload.variant), source.size, source.modified_at, source.cache_generation);
          if (cached) {
            const info = await lstat(cachePath(cacheDir, source, payload.variant)).catch(() => null);
            if (info?.isFile() && !info.isSymbolicLink()) return false;
          }
          if (payload.preserveUnindexed) {
            try { await lstat(cachePath(cacheDir, source, payload.variant)); return false; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          }
        }
        const generate = (inner: AbortSignal, guard = assertMediaLease) => generateMediaCache(db, payload, { owner: options.owner, cacheDir, allowedRoots: options.allowedRoots, assertLease: guard, signal: inner, preserveExisting: payload.preserveUnindexed });
        if (job.type === 'thumbnails') await withThumbnailSlot(db, options.owner, generate, { signal, assertLease: assertMediaLease });
        else await generate(signal);
        return true;
      }, { signal: controller.signal, assertLease });
      db.transaction(() => {
        if (!queue.finish(job.id, { generated: generated ? 1 : 0 })) throw new Error('作业租约已失效');
        if (payload.mediaId && payload.sourceSize !== undefined && payload.sourceModified !== undefined && payload.variant) {
          clearMediaFailure(db, { id: payload.mediaId, size: payload.sourceSize, modified_at: payload.sourceModified, cache_generation: payload.sourceGeneration ?? 0 }, payload.variant);
        }
      }).immediate();
    } else if (job.type === 'cache_prune') {
      const result = await pruneCache(db, options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache'), readSettings(db).cache.limitGB * 1024 ** 3, assertLease, controller.signal);
      controller.signal.throwIfAborted();
      if (!queue.finish(job.id, result)) throw new Error('作业租约已失效');
    } else if (job.type === 'health_check') {
      if (!queue.finish(job.id, { checked: 1 })) throw new Error('作业租约已失效');
    } else {
      throw new Error('作业类型尚未实现');
    }
  } catch (error) {
    const watchScan = job.type === 'scan' && !!db.prepare('SELECT 1 FROM watch_reconcile_requests WHERE job_id=?').get(job.id);
    const message = watchScan ? safeScanError(error) : error instanceof LegacyIdentityUncertainError ? error.message
      : job.type === 'previews' && error instanceof NoVideoPacketsError ? error.message
      : (job.type === 'thumbnails' || job.type === 'previews') && error instanceof FfmpegExitError
        ? '媒体处理失败，请检查文件、编码器及存储'
      : (job.type === 'thumbnails' || job.type === 'previews') && isImageDecodeError(error)
        ? '图片无法解码，请检查文件完整性及格式支持'
      : error instanceof Error && error.message === '作业类型尚未实现' ? error.message : '作业执行失败，请检查媒体库及工作进程';
    if (error instanceof LegacyIdentityUncertainError) options.log?.('warn', error.message, { type: job.type });
    // 停止进程或数据库暂时被锁（例如检查点）时把作业放回队列，稍后从检查点继续，而不是判为失败
    const transient = isTransientSqliteError(error);
    if (options.signal?.aborted || transient) {
      try {
        db.transaction(() => {
          if (queue.release(job.id) && job.type === 'scan') {
            const run = db.prepare('SELECT library_id FROM scan_runs WHERE job_id=?').get(job.id) as { library_id: string } | undefined;
            if (run) publishScanChanges(db, job.id, run.library_id, false);
          }
        }).immediate();
      } catch (releaseError) {
        // 仍然被锁时保留租约，过期后由其它领取者接手
        if (!isTransientSqliteError(releaseError)) throw releaseError;
      }
      if (transient) options.log?.('warn', '数据库暂时繁忙，作业稍后继续', { type: job.type });
    }
    else {
      // 界面只显示概括信息，原始错误写入工作进程日志便于排查
      // 日志上下文只保留白名单字段：code 记 SQLite 错误代码或错误名，消息不含路径分隔符时才附上
      const sqliteCode = (error as { code?: unknown } | null)?.code;
      const detail = error instanceof Error && !/[\\/]/.test(error.message) ? `: ${error.message}` : '';
      const code = `${typeof sqliteCode === 'string' ? sqliteCode : error instanceof Error ? error.name : 'unknown'}${detail}`.slice(0, 200);
      const failed = db.transaction(() => {
        if (!queue.fail(job.id, message)) return false;
        if ((job.type === 'thumbnails' || job.type === 'previews') && job.payload) {
          let payload: Payload = {};
          try { payload = JSON.parse(job.payload) as Payload; } catch { /* 无效作业负载仍应保留失败状态。 */ }
          if (payload.mediaId && payload.sourceSize !== undefined && payload.sourceModified !== undefined && payload.variant) {
            recordMediaFailure(db, { id: payload.mediaId, size: payload.sourceSize, modified_at: payload.sourceModified, cache_generation: payload.sourceGeneration ?? 0 }, payload.variant, message, classifyMediaFailure(error, error instanceof NoVideoPacketsError || isImageDecodeError(error)));
          }
        }
        if (watchScan) finishWatchReconcile(db, job.id, false);
        if (job.type === 'scan') {
          const run = db.prepare('SELECT library_id FROM scan_runs WHERE job_id=?').get(job.id) as { library_id: string } | undefined;
          if (run) publishScanChanges(db, job.id, run.library_id, false);
        }
        return true;
      }).immediate();
      // 作业已被暂停、取消或由其它 worker 接管时，本次执行的错误只是失去租约的后果，不记为作业失败
      if (!failed) options.log?.('info', '作业已不归本次执行，放弃', { type: job.type, code });
      else {
        options.log?.('warn', '作业失败', { type: job.type, code });
        if (watchScan) options.log?.('warn', message, { type: job.type });
      }
    }
  } finally {
    clearInterval(timer); if (waiterTimer) clearInterval(waiterTimer); options.signal?.removeEventListener('abort', stop);
    queue.settle(job.id);
    const final = db.prepare('SELECT status FROM jobs WHERE id=?').get(job.id) as { status: string } | undefined;
    if (final?.status === 'succeeded' || final?.status === 'failed') options.log?.(final.status === 'failed' ? 'warn' : 'info', '作业结束', { type: job.type, status: final.status });
  }
  return true;
}

export function newWorkerOwner(): string { return randomUUID(); }
