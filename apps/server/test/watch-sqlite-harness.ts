import type { LibraryChangedEvent } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { SqliteLibraryIndex } from '../src/watch/sqlite-index.ts';
import type { IndexedRecord, WatchLibraryChange } from '../src/watch/coordinator.ts';
import { virtualPath } from '../src/core/paths.ts';
import path from 'node:path';

export function sqliteHarness(root: string, clock: { now(): number }) {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
  db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
  const events: LibraryChangedEvent[] = []; const requests: string[] = [];
  class Records extends Map<string, IndexedRecord> {
    private snapshot(): Map<string, IndexedRecord> {
      const result = new Map<string, IndexedRecord>();
      const files = db.prepare("SELECT id,relative_path,size,modified_at,mtime_ms,dev,ino,head_hash,missing_at_ms FROM files WHERE library_id='lib'").all() as { id: string; relative_path: string; size: number; modified_at: number; mtime_ms: number | null; dev: string | null; ino: string | null; head_hash: string | null; missing_at_ms: number | null }[];
      for (const row of files) result.set(row.relative_path, { path: row.relative_path, isDir: false, mediaId: row.id, size: row.size, mtimeMs: row.mtime_ms ?? row.modified_at * 1000, dev: row.dev, ino: row.ino, headHash: row.head_hash, missingAt: row.missing_at_ms });
      const folders = db.prepare("SELECT path,mtime_ms,dev,ino,missing_at_ms FROM folders WHERE library_id='lib' AND path<>'lib'").all() as { path: string; mtime_ms: number | null; dev: string | null; ino: string | null; missing_at_ms: number | null }[];
      for (const row of folders) { const relative = row.path.slice(4); result.set(relative, { path: relative, isDir: true, mediaId: null, size: 0, mtimeMs: row.mtime_ms ?? 0, dev: row.dev, ino: row.ino, headHash: null, missingAt: row.missing_at_ms }); }
      return result;
    }
    override get size(): number { return this.snapshot().size; }
    override has(key: string): boolean { return this.snapshot().has(key); }
    override get(key: string): IndexedRecord | undefined {
      const value = this.snapshot().get(key); if (!value) return undefined;
      return new Proxy(value, { set(target, field: string, next) {
        const columns: Record<string, string> = { dev: 'dev', ino: 'ino', headHash: 'head_hash', mtimeMs: 'mtime_ms', missingAt: 'missing_at_ms', size: 'size' };
        const column = columns[field]; if (!column || target.isDir) throw new Error('测试记录字段不可写');
        db.prepare(`UPDATE files SET ${column}=? WHERE id=?`).run(field === 'dev' || field === 'ino' ? String(next) : next, target.mediaId);
        return Reflect.set(target, field, next);
      } });
    }
    override set(key: string, value: IndexedRecord): this {
      if (value.isDir || !value.mediaId) throw new Error('测试注入只支持媒体');
      const parent = path.posix.dirname(key); const folder = virtualPath('lib', parent === '.' ? '' : parent);
      db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,dev,ino,mtime_ms,head_hash,missing_at_ms)
        VALUES (?,'lib',?,?,?,'image/jpeg','image',?,?,?,'mtime',?,?,?,?,?)`).run(value.mediaId, key, folder, path.posix.basename(key), value.size,
        Math.floor(value.mtimeMs / 1000), Math.floor(value.mtimeMs / 1000), value.dev === null ? null : String(value.dev), value.ino === null ? null : String(value.ino), value.mtimeMs, value.headHash, value.missingAt);
      return this;
    }
  }
  class Harness extends SqliteLibraryIndex {
    records = new Records(); events = events; requests = requests; testDb = db;
    get changes(): WatchLibraryChange[] {
      const rows = db.prepare('SELECT ts,kind,path,from_path,is_dir,media_id,source FROM library_changes ORDER BY id').all() as { ts: number; kind: WatchLibraryChange['kind']; path: string; from_path: string | null; is_dir: number; media_id: string | null; source: WatchLibraryChange['source'] }[];
      return rows.map((row) => ({ ts: new Date(row.ts).toISOString(), kind: row.kind, path: row.path, fromPath: row.from_path, isDir: !!row.is_dir, mediaId: row.media_id, source: row.source }));
    }
    override close(): void { super.close(); db.close(); }
  }
  return new Harness(db, { libraryId: 'lib', now: clock.now, requestFullReconcile: async (reason) => { requests.push(reason); }, publishEvent: async (event) => { events.push(event); } });
}
