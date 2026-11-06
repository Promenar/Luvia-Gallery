import { lstat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { cacheKey, cachePath, type Variant } from '../core/media-cache.ts';
import type { JobRow } from '../core/jobs.ts';
import { readSettings } from '../core/settings.ts';
import { withThumbnailSlot } from './ffmpeg-slots.ts';
import { generateMediaCache } from './media-cache.ts';
import { withMediaGenerationLock } from './media-lock.ts';
import { extractMetadataNow } from './metadata.ts';
import { waitForWalCapacity } from './wal-checkpoint.ts';

/** 网格使用的两个尺寸；查看器大图（l）仍在打开时按需生成，避免全库生成占用过多缓存。 */
export const BACKFILL_VARIANTS: Variant[] = [{ kind: 'thumb', size: 's' }, { kind: 'thumb', size: 'm' }];
/** 全库生成时为浏览中的按需生成保留的缩略图并发数。 */
const INTERACTIVE_RESERVE = 2;

type Checkpoint = { lastId: string; total: number; done: number; generated: number; repaired: number; dimensions: number; failed: number };
type Row = { id: string; size: number; modified_at: number; cache_generation: number; media_type: string; width: number | null; height: number | null; metadata_status: string };
type Task = { kind: 'thumb'; row: Row; variant: Variant; key: string } | { kind: 'dimensions'; row: Row };

function backfillWhere(byLibrary: boolean, dimensionsOnly: boolean): string {
  return `f.media_type IN ('image','video') AND f.missing_at_ms IS NULL${byLibrary ? ' AND f.library_id=?' : ''}${dimensionsOnly ? ' AND (f.width IS NULL OR f.height IS NULL)' : ''}`;
}

/**
 * 下一轮要处理的文件，按 id 顺序。固定走 id 唯一索引：统计信息失真时规划器会改走媒体库索引再对全表临时排序，
 * 约 94 万文件时每轮要 5 秒以上并卡住 worker 主线程。
 */
export function backfillRowsSql(byLibrary: boolean, dimensionsOnly: boolean): string {
  return `SELECT f.id,f.size,f.modified_at,f.cache_generation,f.media_type,f.width,f.height,f.metadata_status
    FROM files f INDEXED BY sqlite_autoindex_files_1 CROSS JOIN libraries l ON l.id=f.library_id AND l.enabled=1
    WHERE ${backfillWhere(byLibrary, dimensionsOnly)} AND f.id>? ORDER BY f.id LIMIT ?`;
}

/**
 * 全库生成、补全与修复缩略图：按 id 顺序分轮遍历图片与视频，缺少的尺寸直接生成（生成时顺带记录原始宽高）；
 * 缓存记录存在但文件已丢失的先删除记录再生成；缩略图齐全但没有宽高的单独读取宽高。
 * dimensionsOnly 时只为没有宽高的文件读取宽高，不生成缩略图。每轮处理一批后返回，由调用方释放作业以便其它作业被领取。
 */
export async function processThumbnailBackfill(db: Database.Database, job: JobRow, options: {
  owner: string; cacheDir: string; allowedRoots: string[]; libraryId?: string | null; dimensionsOnly?: boolean; assertLease: () => void; signal: AbortSignal;
}): Promise<{ complete: boolean; counts: Omit<Checkpoint, 'lastId'> }> {
  const libraryArgs = options.libraryId ? [options.libraryId] : [];
  const where = backfillWhere(!!options.libraryId, !!options.dimensionsOnly);
  const saved = job.checkpoint ? JSON.parse(job.checkpoint) as Partial<Checkpoint> : {};
  const state: Checkpoint = { lastId: saved.lastId ?? '', total: saved.total ?? -1, done: saved.done ?? 0, generated: saved.generated ?? 0, repaired: saved.repaired ?? 0, dimensions: saved.dimensions ?? 0, failed: saved.failed ?? 0 };
  if (state.total < 0) {
    state.total = (db.prepare(`SELECT count(*) AS n FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE ${where}`).get(...libraryArgs) as { n: number }).n;
    db.prepare('UPDATE jobs SET progress_total=?,checkpoint=? WHERE id=?').run(state.total, JSON.stringify(state), job.id);
  }
  const workers = readSettings(db).workers;
  // 只读宽高时主要等待磁盘，按拍摄信息读取的并发数；生成缩略图受 CPU 限制，按缩略图并发数
  const concurrency = options.dimensionsOnly ? workers.metadataConcurrency : Math.max(1, workers.thumbnailConcurrency - INTERACTIVE_RESERVE);
  const chunk = Math.max(256, concurrency * 8);
  const rows = db.prepare(backfillRowsSql(!!options.libraryId, !!options.dimensionsOnly))
    .all(...libraryArgs, state.lastId, chunk) as Row[];
  const entry = db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=?');
  const tasks: Task[] = [];
  for (const row of rows) {
    const before = tasks.length;
    for (const variant of options.dimensionsOnly ? [] : BACKFILL_VARIANTS) {
      const key = cacheKey(row, variant);
      if (entry.get(key)) {
        const info = await lstat(cachePath(options.cacheDir, row, variant)).catch(() => null);
        if (info?.isFile() && !info.isSymbolicLink() && info.size > 0) continue;
        db.prepare('DELETE FROM cache_entries WHERE cache_key=?').run(key);
        state.repaired++;
      }
      tasks.push({ kind: 'thumb', row, variant, key });
    }
    if (tasks.length === before && (!row.width || !row.height)) tasks.push({ kind: 'dimensions', row });
  }
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  let next = 0;
  const lane = async () => {
    while (next < tasks.length) {
      // 先同步取任务再让路：等待期间其它通道可能取走剩余任务，醒来后再取会拿到空任务
      const task = tasks[next++]!;
      await waitForWalCapacity(signal);
      signal.throwIfAborted(); options.assertLease();
      const source = { mediaId: task.row.id, sourceSize: task.row.size, sourceModified: task.row.modified_at, sourceGeneration: task.row.cache_generation };
      try {
        if (task.kind === 'dimensions') {
          if (task.row.metadata_status === 'pending') {
            // 读取宽高的磁盘开销与读取全部拍摄信息相同，直接读取全部；先认领，避免与后台拍摄信息作业重复读取同一文件
            const claimed = db.prepare('INSERT OR IGNORE INTO metadata_claims(file_id,job_id,owner,lease_expires_at) VALUES (?,?,?,?)')
              .run(task.row.id, job.id, options.owner, Math.floor(Date.now() / 1000) + 60).changes;
            if (!claimed) continue;
            try { if (await extractMetadataNow(db, task.row.id, signal)) state.dimensions++; }
            finally { db.prepare('DELETE FROM metadata_claims WHERE file_id=? AND job_id=?').run(task.row.id, job.id); }
          } else if (task.row.media_type === 'image') {
            await generateMediaCache(db, { ...source, variant: { kind: 'dimensions' } }, { owner: options.owner, cacheDir: options.cacheDir, allowedRoots: options.allowedRoots, assertLease: options.assertLease, signal });
            state.dimensions++;
          }
          continue;
        }
        await withMediaGenerationLock(db, options.owner, `media:${task.key}`, async (lockSignal) => {
          if (entry.get(task.key)) return;
          const payload = { ...source, variant: task.variant };
          await withThumbnailSlot(db, options.owner, (inner) => generateMediaCache(db, payload, { owner: options.owner, cacheDir: options.cacheDir, allowedRoots: options.allowedRoots, assertLease: options.assertLease, signal: inner }),
            { signal: lockSignal, assertLease: options.assertLease });
          state.generated++;
        }, { signal, assertLease: options.assertLease });
      } catch (error) {
        // 取消、租约失效向上抛出；单个文件损坏或变化只计入失败
        if (signal.aborted) throw error;
        options.assertLease();
        state.failed++;
      }
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(concurrency, Math.max(1, tasks.length)) }, async () => {
    try { await lane(); } catch (error) { stop.abort(); throw error; }
  }));
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
  if (rows.length) state.lastId = rows[rows.length - 1]!.id;
  state.done += rows.length;
  options.assertLease();
  db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify(state), Math.min(state.done, state.total), job.id);
  const { lastId: _lastId, ...counts } = state;
  return { complete: rows.length < chunk, counts };
}
