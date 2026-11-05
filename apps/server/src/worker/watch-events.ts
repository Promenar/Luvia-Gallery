import type Database from 'better-sqlite3';
import type { LibraryChangedEvent } from '@luvia/contracts';
import { compressFolders } from '../watch/throttle.ts';

function merge(a: LibraryChangedEvent, b: LibraryChangedEvent): LibraryChangedEvent {
  return { libraryId: a.libraryId, source: b.source,
    folders: compressFolders([...a.folders, ...b.folders]),
    added: a.added + b.added, removed: a.removed + b.removed, updated: a.updated + b.updated, moved: a.moved + b.moved };
}
export function publishScanChanges(db: Database.Database, jobId: string, libraryId: string, includeEmpty: boolean): void {
  const summary = (db.prepare('SELECT added,removed,updated,moved FROM scan_event_counts WHERE job_id=?').get(jobId) as { added: number; removed: number; updated: number; moved: number } | undefined)
    ?? { added: 0, removed: 0, updated: 0, moved: 0 };
  const folders = (db.prepare('SELECT path FROM scan_event_folders WHERE job_id=? ORDER BY path').all(jobId) as { path: string }[]).map((row) => row.path);
  if (includeEmpty || folders.length) publishLibraryEvent(db, { libraryId, source: 'scan', folders, ...summary });
  db.prepare('DELETE FROM scan_event_restored WHERE job_id=?').run(jobId);
  db.prepare('DELETE FROM scan_event_counts WHERE job_id=?').run(jobId);
  db.prepare('DELETE FROM scan_event_folders WHERE job_id=?').run(jobId);
}
function flushOne(db: Database.Database, libraryId: string, at: number): boolean {
  const pending = db.prepare('SELECT source,payload FROM library_event_pending WHERE library_id=? ORDER BY queued_at_ms,source LIMIT 1').get(libraryId) as { source: string; payload: string } | undefined;
  if (!pending) return false;
  const sent = db.prepare('SELECT sent_at_ms FROM library_event_sent WHERE library_id=?').get(libraryId) as { sent_at_ms: number } | undefined;
  if (sent && at - sent.sent_at_ms < 2000) return false;
  db.prepare("INSERT INTO job_events(event_type,payload) VALUES ('library',?)").run(pending.payload);
  db.prepare('INSERT INTO library_event_sent(library_id,sent_at_ms) VALUES (?,?) ON CONFLICT(library_id) DO UPDATE SET sent_at_ms=excluded.sent_at_ms').run(libraryId, at);
  db.prepare('INSERT INTO library_watch_state(library_id,last_event_at) VALUES (?,?) ON CONFLICT(library_id) DO UPDATE SET last_event_at=excluded.last_event_at').run(libraryId, new Date(at).toISOString());
  db.prepare('DELETE FROM library_event_pending WHERE library_id=? AND source=?').run(libraryId, pending.source);
  return true;
}
export function publishLibraryEvent(db: Database.Database, event: LibraryChangedEvent, at = Date.now()): void {
  if (!event.libraryId) throw new Error('媒体库事件缺少媒体库 ID');
  const id = event.libraryId;
  db.transaction(() => {
    const current = db.prepare('SELECT payload FROM library_event_pending WHERE library_id=? AND source=?').get(id, event.source) as { payload: string } | undefined;
    const value = current ? merge(JSON.parse(current.payload) as LibraryChangedEvent, event) : event;
    db.prepare('INSERT INTO library_event_pending(library_id,source,payload,queued_at_ms) VALUES (?,?,?,?) ON CONFLICT(library_id,source) DO UPDATE SET payload=excluded.payload').run(id, event.source, JSON.stringify(value), at);
    flushOne(db, id, at);
  }).immediate();
}
export function flushLibraryEvents(db: Database.Database, at = Date.now()): number {
  return db.transaction(() => {
    const rows = db.prepare('SELECT DISTINCT library_id FROM library_event_pending').all() as { library_id: string }[];
    return rows.reduce((count, row) => count + (flushOne(db, row.library_id, at) ? 1 : 0), 0);
  }).immediate();
}
