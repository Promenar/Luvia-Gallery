import type Database from 'better-sqlite3';
import { realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

type Entry = { cache_key: string; relative_path: string; bytes: number; last_access_at: number; media_id: string | null; variant: string | null };
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function pruneCache(db: Database.Database, cacheDir: string, limitBytes: number, assertLease: () => void = () => {}): Promise<{ removed: number; bytes: number }> {
  if (!Number.isFinite(limitBytes) || limitBytes < 0) throw new Error('缓存上限无效');
  let total = (db.prepare('SELECT COALESCE(sum(bytes),0) AS n FROM cache_entries').get() as { n: number }).n;
  let removed = 0; let bytes = 0; let lastAccess = -1; let lastKey = '';
  const root = path.resolve(cacheDir);
  let actualRoot: string;
  try { actualRoot = await realpath(root); } catch { actualRoot = root; }
  while (total > limitBytes) {
    assertLease();
    const entries = db.prepare(`SELECT * FROM cache_entries WHERE last_access_at>? OR (last_access_at=? AND cache_key>?)
      ORDER BY last_access_at,cache_key LIMIT 256`).all(lastAccess, lastAccess, lastKey) as Entry[];
    if (!entries.length) break;
    for (const entry of entries) {
      if (total <= limitBytes) break;
      lastAccess = entry.last_access_at; lastKey = entry.cache_key;
      assertLease();
      const filename = path.resolve(root, entry.relative_path);
      let safe = within(root, filename);
      if (safe) {
        try { safe = within(actualRoot, await realpath(path.dirname(filename))); }
        catch { safe = false; }
      }
      let deleted = false; let missing = false;
      if (safe) {
        try { await unlink(filename); deleted = true; }
        catch (error) { missing = (error as NodeJS.ErrnoException).code === 'ENOENT'; if (!missing) continue; }
      }
      assertLease();
      const changed = db.transaction(() => {
        const result = db.prepare('DELETE FROM cache_entries WHERE cache_key=? AND last_access_at=?').run(entry.cache_key, entry.last_access_at).changes;
        if (result && entry.media_id && entry.variant === 'preview') db.prepare(`UPDATE files SET has_preview=0 WHERE id=?
          AND NOT EXISTS(SELECT 1 FROM cache_entries WHERE media_id=? AND variant='preview')`).run(entry.media_id, entry.media_id);
        return result;
      }).immediate();
      if (changed) {
        total -= entry.bytes;
        if (deleted) { removed++; bytes += entry.bytes; }
      }
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { removed, bytes };
}
