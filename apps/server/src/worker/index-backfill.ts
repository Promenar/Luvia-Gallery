import type Database from 'better-sqlite3';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { secureMediaPath } from '../core/paths.ts';
import { statFields } from '../watch/file-info.ts';

type Options = { allowedRoots: string[]; batchSize?: number; signal?: AbortSignal };
type FileRow = { rowid: number; id: string; root: string; relative_path: string; size: number; modified_at: number; mtime_ms: number | null; dev: string | null; ino: string | null };

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export async function processIndexBackfillBatch(db: Database.Database, options: Options): Promise<boolean> {
  options.signal?.throwIfAborted();
  const owner = randomUUID(); const now = Date.now();
  const claimed = db.prepare(`UPDATE index_backfill SET owner=?,lease_until_ms=?
    WHERE id=1 AND complete=0 AND (owner IS NULL OR lease_until_ms<=?)`).run(owner, now + 30_000, now);
  if (!claimed.changes) return !!(db.prepare('SELECT complete FROM index_backfill WHERE id=1').get() as { complete: number }).complete;
  try {
    const state = db.prepare('SELECT last_rowid FROM index_backfill WHERE id=1 AND owner=?').get(owner) as { last_rowid: number };
    const limit = Math.max(1, Math.min(500, options.batchSize ?? 256));
    const rows = db.prepare(`SELECT f.rowid,f.id,f.relative_path,f.size,f.modified_at,f.mtime_ms,f.dev,f.ino,l.root FROM files f JOIN libraries l ON l.id=f.library_id
      WHERE f.rowid>? AND (f.dev IS NULL OR f.ino IS NULL OR f.mtime_ms IS NULL OR f.head_hash IS NULL)
      ORDER BY f.rowid LIMIT ?`).all(state.last_rowid, limit) as FileRow[];
    const roots = await Promise.all(options.allowedRoots.map((root) => realpath(root).catch(() => null)));
    for (const row of rows) {
      options.signal?.throwIfAborted();
      let fields: ReturnType<typeof statFields> | null = null; let hash: string | null = null;
      try {
        const root = await realpath(row.root);
        if (!roots.some((allowed) => allowed !== null && within(allowed, root))) throw new Error('媒体库不在允许的根目录中');
        const filename = await secureMediaPath(root, row.relative_path);
        const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        try {
          const before = await file.stat({ bigint: true });
          const observed = statFields(before);
          if (!before.isFile() || observed.size !== row.size || Math.floor(observed.mtimeMs / 1000) !== row.modified_at ||
            (row.mtime_ms !== null && observed.mtimeMs !== row.mtime_ms) || (row.dev !== null && observed.dev !== row.dev) || (row.ino !== null && observed.ino !== row.ino)) throw new Error('媒体文件发生变化');
          const buffer = Buffer.alloc(65_536); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
          const after = statFields(await file.stat({ bigint: true }));
          if (after.dev !== observed.dev || after.ino !== observed.ino || after.size !== observed.size || after.mtimeMs !== observed.mtimeMs) throw new Error('媒体文件发生变化');
          const currentPath = await lstat(filename, { bigint: true });
          if (!currentPath.isFile() || currentPath.dev.toString() !== observed.dev || currentPath.ino.toString() !== observed.ino) throw new Error('媒体文件发生变化');
          fields = observed; hash = createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
        } finally { await file.close(); }
      } catch { /* 单个文件不可读不阻断后续批次。 */ }
      db.transaction(() => {
        const lease = db.prepare('UPDATE index_backfill SET lease_until_ms=? WHERE id=1 AND owner=? AND lease_until_ms>?').run(Date.now() + 30_000, owner, Date.now());
        if (!lease.changes) throw new Error('存量回填租约已失效');
        const updated = fields && hash ? db.prepare(`UPDATE files SET dev=?,ino=?,mtime_ms=?,head_hash=?
          WHERE id=? AND relative_path=? AND size=? AND modified_at=? AND mtime_ms IS ? AND dev IS ? AND ino IS ?`).run(fields.dev, fields.ino, fields.mtimeMs, hash, row.id, row.relative_path, row.size, row.modified_at, row.mtime_ms, row.dev, row.ino).changes : 0;
        db.prepare('UPDATE index_backfill SET last_rowid=?,processed=processed+?,errors=errors+? WHERE id=1 AND owner=?')
          .run(row.rowid, updated ? 1 : 0, updated ? 0 : 1, owner);
      }).immediate();
    }
    if (rows.length < limit) {
      db.prepare('UPDATE index_backfill SET complete=1 WHERE id=1 AND owner=?').run(owner);
      return true;
    }
    return false;
  } finally {
    db.prepare('UPDATE index_backfill SET owner=NULL,lease_until_ms=0 WHERE id=1 AND owner=?').run(owner);
  }
}

export async function runIndexBackfill(db: Database.Database, options: Options): Promise<void> {
  while (!options.signal?.aborted) {
    if (await processIndexBackfillBatch(db, options)) return;
    try { await delay(50, undefined, { signal: options.signal }); }
    catch (error) { if (!options.signal?.aborted) throw error; }
  }
}
