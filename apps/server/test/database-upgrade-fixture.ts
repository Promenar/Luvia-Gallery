import type Database from 'better-sqlite3';

export function restoreVersion21Fixture(db: Database.Database): void {
  db.exec(`DROP TRIGGER timeline_rebuild_insert; DROP TRIGGER timeline_rebuild_delete; DROP TRIGGER timeline_rebuild_update;
    DROP TABLE timeline_rebuild_counts; DROP TABLE timeline_rebuild_state;
    DROP TABLE scan_change_directories; DROP TABLE scan_current_markers; DROP TABLE scan_expiry_logged; ALTER TABLE files DROP COLUMN cache_generation; DROP TABLE cache_gc; DROP TABLE scan_conflicts; DROP TABLE index_backfill; DROP TABLE library_changes;
    DROP TRIGGER files_timeline_insert; DROP TRIGGER files_timeline_delete; DROP TRIGGER files_timeline_update;
    DROP TRIGGER files_watch_insert; DROP TRIGGER files_watch_update; DROP TRIGGER files_watch_delete;
    DROP TRIGGER folders_watch_insert; DROP TRIGGER folders_watch_update; DROP TRIGGER folders_watch_delete;
    DROP TABLE file_watch_index; DROP TABLE folder_watch_index;
    ALTER TABLE files DROP COLUMN missing_at_ms; ALTER TABLE files DROP COLUMN dev;
    ALTER TABLE files DROP COLUMN ino; ALTER TABLE files DROP COLUMN mtime_ms; ALTER TABLE files DROP COLUMN head_hash;
    ALTER TABLE folders DROP COLUMN missing_at_ms; ALTER TABLE folders DROP COLUMN dev;
    ALTER TABLE folders DROP COLUMN ino; ALTER TABLE folders DROP COLUMN mtime_ms;
    CREATE TRIGGER files_timeline_insert AFTER INSERT ON files WHEN strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
      INSERT INTO timeline_counts(month,count) VALUES(strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1) ON CONFLICT(month) DO UPDATE SET count=count+1;
    END;
    CREATE TRIGGER files_timeline_delete AFTER DELETE ON files WHEN strftime('%Y-%m',old.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
      UPDATE timeline_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime'); DELETE FROM timeline_counts WHERE count<=0;
    END;
    CREATE TRIGGER files_timeline_update AFTER UPDATE OF taken_at ON files BEGIN
      UPDATE timeline_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime'); DELETE FROM timeline_counts WHERE count<=0;
      INSERT INTO timeline_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1 WHERE strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL ON CONFLICT(month) DO UPDATE SET count=count+1;
    END;
    DROP TABLE legacy_import_users; DROP TABLE legacy_import_tokens;
    ALTER TABLE api_tokens DROP COLUMN legacy_jwt; PRAGMA user_version=21`);
}
