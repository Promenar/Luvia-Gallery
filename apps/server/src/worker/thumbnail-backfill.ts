import { lstat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { cacheKey, cachePath, type Variant } from '../core/media-cache.ts';
import type { JobRow } from '../core/jobs.ts';
import { readSettings } from '../core/settings.ts';
import { withThumbnailSlot } from './ffmpeg-slots.ts';
import { generateMediaCache } from './media-cache.ts';
import { withMediaGenerationLock } from './media-lock.ts';

/** 网格使用的两个尺寸；查看器大图（l）仍在打开时按需生成，避免全库生成占用过多缓存。 */
export const BACKFILL_VARIANTS: Variant[] = [{ kind: 'thumb', size: 's' }, { kind: 'thumb', size: 'm' }];
/** 全库生成时为浏览中的按需生成保留的缩略图并发数。 */
const INTERACTIVE_RESERVE = 2;

type Checkpoint = { lastId: string; total: number; done: number; generated: number; repaired: number; failed: number };
type Row = { id: string; size: number; modified_at: number; cache_generation: number };

/**
 * 全库生成、补全与修复缩略图：按 id 顺序分轮遍历图片与视频，缺少的尺寸直接生成；
 * 缓存记录存在但文件已丢失的先删除记录再生成。每轮处理一批后返回，由调用方释放作业以便其它作业被领取。
 */
export async function processThumbnailBackfill(db: Database.Database, job: JobRow, options: {
  owner: string; cacheDir: string; allowedRoots: string[]; libraryId?: string | null; assertLease: () => void; signal: AbortSignal;
}): Promise<{ complete: boolean; counts: Omit<Checkpoint, 'lastId'> }> {
  const libraryClause = options.libraryId ? ' AND f.library_id=?' : '';
  const libraryArgs = options.libraryId ? [options.libraryId] : [];
  const scope = `FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
    WHERE f.media_type IN ('image','video') AND f.missing_at_ms IS NULL${libraryClause}`;
  const saved = job.checkpoint ? JSON.parse(job.checkpoint) as Partial<Checkpoint> : {};
  const state: Checkpoint = { lastId: saved.lastId ?? '', total: saved.total ?? -1, done: saved.done ?? 0, generated: saved.generated ?? 0, repaired: saved.repaired ?? 0, failed: saved.failed ?? 0 };
  if (state.total < 0) {
    state.total = (db.prepare(`SELECT count(*) AS n ${scope}`).get(...libraryArgs) as { n: number }).n;
    db.prepare('UPDATE jobs SET progress_total=?,checkpoint=? WHERE id=?').run(state.total, JSON.stringify(state), job.id);
  }
  const concurrency = Math.max(1, readSettings(db).workers.thumbnailConcurrency - INTERACTIVE_RESERVE);
  const rows = db.prepare(`SELECT f.id,f.size,f.modified_at,f.cache_generation ${scope} AND f.id>? ORDER BY f.id LIMIT ?`)
    .all(...libraryArgs, state.lastId, Math.max(256, concurrency * 8)) as Row[];
  const entry = db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=?');
  const tasks: { row: Row; variant: Variant; key: string }[] = [];
  for (const row of rows) {
    for (const variant of BACKFILL_VARIANTS) {
      const key = cacheKey(row, variant);
      if (entry.get(key)) {
        const info = await lstat(cachePath(options.cacheDir, row, variant)).catch(() => null);
        if (info?.isFile() && !info.isSymbolicLink() && info.size > 0) continue;
        db.prepare('DELETE FROM cache_entries WHERE cache_key=?').run(key);
        state.repaired++;
      }
      tasks.push({ row, variant, key });
    }
  }
  const stop = new AbortController();
  const signal = AbortSignal.any([options.signal, stop.signal]);
  let next = 0;
  const lane = async () => {
    while (next < tasks.length) {
      signal.throwIfAborted(); options.assertLease();
      const task = tasks[next++]!;
      try {
        await withMediaGenerationLock(db, options.owner, `media:${task.key}`, async (lockSignal) => {
          if (entry.get(task.key)) return;
          const payload = { mediaId: task.row.id, sourceSize: task.row.size, sourceModified: task.row.modified_at, sourceGeneration: task.row.cache_generation, variant: task.variant };
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
  return { complete: rows.length < Math.max(256, concurrency * 8), counts };
}
