import { lstat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { findLegacyThumbnail } from '../core/legacy-thumbnail.ts';
import { cacheKey, cachePath, type Variant } from '../core/media-cache.ts';
import type { JobRow } from '../core/jobs.ts';
import { readSettings } from '../core/settings.ts';
import { NoVideoPacketsError, withThumbnailSlot } from './ffmpeg-slots.ts';
import { generateMediaCache } from './media-cache.ts';
import { withMediaGenerationLock } from './media-lock.ts';
import { extractMetadataNow } from './metadata.ts';
import { waitForWalCapacity } from './wal-checkpoint.ts';
import { runLanes } from './lanes.ts';
import { classifyMediaFailure, clearMediaFailure, mediaIgnored, recordMediaFailure, recordUnindexedCacheFailure } from '../core/media-failures.ts';
import { isImageDecodeError } from './image-decoding.ts';
import { isTransientSqliteError } from '../core/sqlite-errors.ts';

/** 网格使用的两个尺寸；查看器大图（l）仍在打开时按需生成，避免全库生成占用过多缓存。 */
export const BACKFILL_VARIANTS: Variant[] = [{ kind: 'thumb', size: 's' }, { kind: 'thumb', size: 'm' }];
/** 全库生成时为浏览中的按需生成保留的缩略图并发数。 */
const INTERACTIVE_RESERVE = 2;

type Checkpoint = { lastId: string; total: number; done: number; generated: number; repaired: number; dimensions: number; failed: number; legacy: number };
type Row = { id: string; size: number; modified_at: number; cache_generation: number; media_type: string; width: number | null; height: number | null; metadata_status: string; root: string; relative_path: string };
type Task = { kind: 'thumb'; row: Row; variant: Variant; key: string; replaceEmpty?: { dev: bigint; ino: bigint; mtimeNs: bigint } } | { kind: 'dimensions'; row: Row };

function backfillWhere(byLibrary: boolean): string {
  return `f.media_type IN ('image','video') AND f.missing_at_ms IS NULL${byLibrary ? ' AND f.library_id=?' : ''}`;
}

/**
 * 下一轮要处理的文件，按 id 顺序。固定走 id 唯一索引：统计信息失真时规划器会改走媒体库索引再对全表临时排序，
 * 约 94 万文件时每轮要 5 秒以上并卡住 worker 主线程。
 */
export function backfillRowsSql(byLibrary: boolean): string {
  return `SELECT f.id,f.size,f.modified_at,f.cache_generation,f.media_type,f.width,f.height,f.metadata_status,l.root,f.relative_path
    FROM files f INDEXED BY sqlite_autoindex_files_1 CROSS JOIN libraries l ON l.id=f.library_id AND l.enabled=1
    WHERE ${backfillWhere(byLibrary)} AND f.id>? ORDER BY f.id LIMIT ?`;
}

/**
 * 全库生成、补全与修复缩略图：按 id 顺序分轮遍历图片与视频，缺少的尺寸直接生成（生成时顺带记录原始宽高）；
 * 缓存记录存在但文件已丢失的先删除记录再生成；缩略图齐全但没有宽高的单独读取宽高。
 * 有可用的 1.x 缩略图时，小尺寸直接从它缩放（不读原文件内容），中尺寸跳过：浏览时由 1.x 缩略图顶替并按需生成。
 * 每轮处理一批后返回，由调用方释放作业以便其它作业被领取。
 */
export async function processThumbnailBackfill(db: Database.Database, job: JobRow, options: {
  owner: string; cacheDir: string; allowedRoots: string[]; libraryId?: string | null; assertLease: () => void; signal: AbortSignal;
}): Promise<{ complete: boolean; counts: Omit<Checkpoint, 'lastId'> }> {
  const libraryArgs = options.libraryId ? [options.libraryId] : [];
  const where = backfillWhere(!!options.libraryId);
  const saved = job.checkpoint ? JSON.parse(job.checkpoint) as Partial<Checkpoint> : {};
  const state: Checkpoint = { lastId: saved.lastId ?? '', total: saved.total ?? -1, done: saved.done ?? 0, generated: saved.generated ?? 0, repaired: saved.repaired ?? 0, dimensions: saved.dimensions ?? 0, failed: saved.failed ?? 0, legacy: saved.legacy ?? 0 };
  if (state.total < 0) {
    state.total = (db.prepare(`SELECT count(*) AS n FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE ${where}`).get(...libraryArgs) as { n: number }).n;
    db.prepare('UPDATE jobs SET progress_total=?,checkpoint=? WHERE id=?').run(state.total, JSON.stringify(state), job.id);
  }
  const workers = readSettings(db).workers;
  const concurrency = Math.max(1, workers.thumbnailConcurrency - INTERACTIVE_RESERVE);
  const chunk = Math.max(256, concurrency * 8);
  const rows = db.prepare(backfillRowsSql(!!options.libraryId))
    .all(...libraryArgs, state.lastId, chunk) as Row[];
  const entry = db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=?');
  const tasks: Task[] = [];
  for (const row of rows) {
    const before = tasks.length;
    for (const variant of BACKFILL_VARIANTS) {
      if (mediaIgnored(db, row, variant)) continue;
      const key = cacheKey(row, variant);
      let replaceEmpty: { dev: bigint; ino: bigint; mtimeNs: bigint } | undefined;
      if (entry.get(key)) {
        const info = await lstat(cachePath(options.cacheDir, row, variant), { bigint: true }).catch(() => null);
        if (info?.isFile() && !info.isSymbolicLink() && info.size > 0n) continue;
        if (info?.isFile() && info.size === 0n) replaceEmpty = { dev: info.dev, ino: info.ino, mtimeNs: info.mtimeNs };
        else db.prepare('DELETE FROM cache_entries WHERE cache_key=?').run(key);
        state.repaired++;
      }
      tasks.push({ kind: 'thumb', row, variant, key, replaceEmpty });
    }
    if (tasks.length === before && (!row.width || !row.height)) tasks.push({ kind: 'dimensions', row });
  }
  // 同一文件的两个尺寸共用一次查找
  const legacyLookups = new Map<string, Promise<string | undefined>>();
  const replaced = db.prepare("SELECT 1 FROM editor_overwrites WHERE media_id=? AND status='saved' LIMIT 1");
  const legacyOf = (row: Row) => {
    let lookup = legacyLookups.get(row.id);
    if (!lookup) { lookup = replaced.get(row.id) ? Promise.resolve(undefined) : findLegacyThumbnail(options.cacheDir, row); legacyLookups.set(row.id, lookup); }
    return lookup;
  };
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  const readDimensions = async (row: Row) => {
    if (row.metadata_status === 'pending') {
      // 读取宽高的磁盘开销与读取全部拍摄信息相同，直接读取全部；先认领，避免与后台拍摄信息作业重复读取同一文件
      const claimed = db.prepare('INSERT OR IGNORE INTO metadata_claims(file_id,job_id,owner,lease_expires_at) VALUES (?,?,?,?)')
        .run(row.id, job.id, options.owner, Math.floor(Date.now() / 1000) + 60).changes;
      if (!claimed) return;
      try { if (await extractMetadataNow(db, row.id, signal)) state.dimensions++; }
      finally { db.prepare('DELETE FROM metadata_claims WHERE file_id=? AND job_id=?').run(row.id, job.id); }
    } else if (row.media_type === 'image') {
      const source = { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation };
      await generateMediaCache(db, { ...source, variant: { kind: 'dimensions' } }, { owner: options.owner, cacheDir: options.cacheDir, allowedRoots: options.allowedRoots, assertLease: options.assertLease, signal });
      state.dimensions++;
    }
  };
  let next = 0;
  const lane = async () => {
    while (next < tasks.length) {
      // 先同步取任务再让路：等待期间其它通道可能取走剩余任务，醒来后再取会拿到空任务
      const task = tasks[next++]!;
      await waitForWalCapacity(signal);
      signal.throwIfAborted(); options.assertLease();
      const source = { mediaId: task.row.id, sourceSize: task.row.size, sourceModified: task.row.modified_at, sourceGeneration: task.row.cache_generation };
      let thumbnailReady = false;
      try {
        if (task.kind === 'dimensions') { await readDimensions(task.row); continue; }
        const legacyInput = task.variant.kind === 'thumb' ? await legacyOf(task.row) : undefined;
        if (legacyInput && task.variant.kind === 'thumb' && task.variant.size === 'm') continue;
        let usedLegacy = false;
        let generated: { partialDecode: boolean } | undefined;
        await withMediaGenerationLock(db, options.owner, `media:${task.key}`, async (lockSignal, assertMediaLease) => {
          if (mediaIgnored(db, task.row, task.variant)) return;
          if (entry.get(task.key) && !task.replaceEmpty) return;
          const payload = { ...source, variant: task.variant };
          const result = await withThumbnailSlot(db, options.owner, (inner, assertSlot) => mediaIgnored(db, task.row, task.variant) ? Promise.resolve(undefined) : generateMediaCache(db, payload, { owner: options.owner, cacheDir: options.cacheDir, allowedRoots: options.allowedRoots, assertLease: assertSlot, signal: inner, legacyInput, replaceEmpty: task.replaceEmpty }),
            { signal: lockSignal, assertLease: assertMediaLease });
          if (!result) return;
          if (result.keptExisting) return;
          generated = result;
          state.generated++;
          if (result.fromLegacy) { state.legacy++; usedLegacy = true; }
        }, { signal, assertLease: options.assertLease });
        thumbnailReady = true;
        if (!generated?.partialDecode) db.transaction(() => { options.assertLease(); clearMediaFailure(db, task.row, task.variant, { preservePartial: !generated }); }).immediate();
        // 从 1.x 缩略图缩放时不知道原始宽高，单独读取（图片只读文件头）
        if (usedLegacy && (!task.row.width || !task.row.height)) await readDimensions(task.row);
      } catch (error) {
        // 取消、租约失效向上抛出；单个文件损坏或变化只计入失败
        if (signal.aborted || isTransientSqliteError(error)) throw error;
        options.assertLease();
        if (task.kind === 'thumb' && !thumbnailReady) db.transaction(() => {
          options.assertLease();
          if ((error as NodeJS.ErrnoException | null)?.code === 'EEXIST') recordUnindexedCacheFailure(db, task.row, task.variant);
          else recordMediaFailure(db, task.row, task.variant, error instanceof NoVideoPacketsError ? error.message : '媒体处理失败，请检查文件、编码器及存储', classifyMediaFailure(error, error instanceof NoVideoPacketsError || isImageDecodeError(error)));
        }).immediate();
        state.failed++;
      }
    }
  };
  await runLanes(Math.min(concurrency, Math.max(1, tasks.length)), stop, lane);
  if (rows.length) state.lastId = rows[rows.length - 1]!.id;
  state.done += rows.length;
  options.assertLease();
  db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify(state), Math.min(state.done, state.total), job.id);
  const { lastId: _lastId, ...counts } = state;
  return { complete: rows.length < chunk, counts };
}
