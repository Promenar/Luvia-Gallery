import type Database from 'better-sqlite3';
import { realpath } from 'node:fs/promises';
import { unlinkSync } from 'node:fs';
import path from 'node:path';
import { replaceEvictedThumbnailCovers } from '../core/folder-covers.ts';
import { withMediaGenerationLock } from './media-lock.ts';
import { readCacheUsage } from './cache-usage.ts';

type Entry = { cache_key: string; relative_path: string; bytes: number; last_access_at: number; media_id: string | null; variant: string | null };
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function cleanupDeletedMediaCache(db: Database.Database, cacheDir: string, options: { owner: string; signal?: AbortSignal; assertLease?: () => void }): Promise<void> {
  let cursor = ''; const root = path.resolve(cacheDir);
  while (true) {
    options.signal?.throwIfAborted(); options.assertLease?.();
    const entries = db.prepare('SELECT cache_key,relative_path FROM cache_gc WHERE cache_key>? ORDER BY cache_key LIMIT 256').all(cursor) as { cache_key: string; relative_path: string }[];
    if (!entries.length) return;
    for (const entry of entries) {
      cursor = entry.cache_key;
      await withMediaGenerationLock(db, options.owner, `media:${entry.cache_key}`, async (signal, assertMediaLease) => {
        const stillUsed = db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=? OR relative_path=?').get(entry.cache_key, entry.relative_path);
        let filename: string | undefined;
        if (!stillUsed) {
          filename = path.resolve(root, entry.relative_path);
          if (!within(root, filename)) return;
          let safe = false;
          try { const actualRoot = await realpath(root); const parent = await realpath(path.dirname(filename)); safe = parent === actualRoot || within(actualRoot, parent); } catch { return; }
          if (!safe) return;
        }
        db.transaction(() => {
          signal.throwIfAborted(); assertMediaLease();
          const inUse = db.prepare('SELECT 1 FROM cache_entries WHERE cache_key=? OR relative_path=?').get(entry.cache_key, entry.relative_path);
          if (!inUse) {
            if (!filename) return;
            // 在同一写事务内校验所有权、复查引用并删除，阻止并发接管与登记。
            try { unlinkSync(filename); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return; }
          }
          db.prepare('DELETE FROM cache_gc WHERE cache_key=? AND relative_path=?').run(entry.cache_key, entry.relative_path);
        }).immediate();
      }, options);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
export async function pruneCache(db: Database.Database, cacheDir: string, limitBytes: number, assertLease: () => void = () => {}, signal?: AbortSignal): Promise<{ removed: number; bytes: number }> {
  if (!Number.isFinite(limitBytes) || limitBytes < 0) throw new Error('缓存上限无效');
  let total = await readCacheUsage(db, signal);
  let removed = 0; let bytes = 0; let lastAccess = -1; let lastKey = '';
  const root = path.resolve(cacheDir);
  let actualRoot: string;
  try { actualRoot = await realpath(root); } catch { actualRoot = root; }
  while (total > limitBytes) {
    signal?.throwIfAborted();
    assertLease();
    const entries = db.prepare(`SELECT * FROM cache_entries WHERE (last_access_at>? OR (last_access_at=? AND cache_key>?))
      AND (variant IS NULL OR variant<>'hls' OR NOT EXISTS(SELECT 1 FROM hls_sessions h WHERE h.id=cache_entries.hls_session_id AND h.last_access_at>?))
      ORDER BY last_access_at,cache_key LIMIT 256`).all(lastAccess, lastAccess, lastKey, Date.now() - 60_000) as Entry[];
    if (!entries.length) break;
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (total <= limitBytes) break;
      lastAccess = entry.last_access_at; lastKey = entry.cache_key;
      assertLease();
      const filename = path.resolve(root, entry.relative_path);
      let safe = within(root, filename);
      if (safe) {
        try { safe = within(actualRoot, await realpath(path.dirname(filename))); }
        catch { safe = false; }
      }
      const outcome = db.transaction(() => {
        signal?.throwIfAborted();
        assertLease();
        const current = db.prepare(`SELECT 1 FROM cache_entries WHERE cache_key=? AND last_access_at=?
          AND (variant IS NULL OR variant<>'hls' OR NOT EXISTS(SELECT 1 FROM hls_sessions h WHERE h.id=cache_entries.hls_session_id AND h.last_access_at>?))`)
          .get(entry.cache_key, entry.last_access_at, Date.now() - 60_000);
        if (!current) return { changed: 0, deleted: false };
        let deleted = false;
        if (safe) {
          try { unlinkSync(filename); deleted = true; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { changed: 0, deleted: false }; }
        }
        const result = db.prepare('DELETE FROM cache_entries WHERE cache_key=? AND last_access_at=?').run(entry.cache_key, entry.last_access_at).changes;
        if (result && entry.media_id && entry.variant === 'preview') db.prepare(`UPDATE files SET has_preview=0 WHERE id=?
          AND NOT EXISTS(SELECT 1 FROM cache_entries c WHERE c.media_id=files.id AND c.variant='preview' AND c.source_size=files.size AND c.source_modified=files.modified_at)`).run(entry.media_id);
        if (result && entry.media_id && entry.variant === 'thumb') {
          const changed = db.prepare(`UPDATE files SET thumb_ready=0 WHERE id=? AND thumb_ready=1
            AND NOT EXISTS(SELECT 1 FROM cache_entries c WHERE c.media_id=files.id AND c.variant='thumb' AND c.source_size=files.size AND c.source_modified=files.modified_at)`).run(entry.media_id);
          if (changed.changes) replaceEvictedThumbnailCovers(db, entry.media_id);
        }
        return { changed: result, deleted };
      }).immediate();
      if (outcome.changed) {
        total -= entry.bytes;
        if (outcome.deleted) { removed++; bytes += entry.bytes; }
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  signal?.throwIfAborted();
  return { removed, bytes };
}
