import type Database from 'better-sqlite3';
import type { WatchLibraryChange as LibraryChange } from '../watch/coordinator.ts';

const retentionMs = 30 * 86_400_000;

export function appendLibraryChange(db: Database.Database, libraryId: string, change: LibraryChange, now = Date.now()): void {
  db.transaction(() => {
    db.prepare('INSERT INTO library_changes(library_id,ts,kind,path,from_path,is_dir,media_id,source) VALUES (?,?,?,?,?,?,?,?)')
      .run(libraryId, Date.parse(change.ts), change.kind, change.path, change.fromPath, change.isDir ? 1 : 0, change.mediaId, change.source);
    db.prepare('DELETE FROM library_changes WHERE ts < ?').run(now - retentionMs);
  })();
}

export function listLibraryChanges(db: Database.Database, libraryId: string, limit: number, now = Date.now()): LibraryChange[] {
  const rows = db.prepare('SELECT ts,kind,path,from_path,is_dir,media_id,source FROM library_changes WHERE library_id=? AND ts>=? ORDER BY ts DESC,id DESC LIMIT ?')
    .all(libraryId, now - retentionMs, limit) as { ts: number; kind: LibraryChange['kind']; path: string; from_path: string | null; is_dir: number; media_id: string | null; source: LibraryChange['source'] }[];
  return rows.map((row) => ({ ts: new Date(row.ts).toISOString(), kind: row.kind, path: row.path, fromPath: row.from_path,
    isDir: !!row.is_dir, mediaId: row.media_id, source: row.source }));
}
