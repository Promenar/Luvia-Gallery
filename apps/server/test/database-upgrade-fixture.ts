import type Database from 'better-sqlite3';

export function restoreVersion21Fixture(db: Database.Database): void {
  db.exec(`DROP TABLE cache_gc; DROP TABLE scan_conflicts; DROP TABLE index_backfill; DROP TABLE library_changes;
    DROP TRIGGER files_watch_insert; DROP TRIGGER files_watch_update; DROP TRIGGER files_watch_delete;
    DROP TRIGGER folders_watch_insert; DROP TRIGGER folders_watch_update; DROP TRIGGER folders_watch_delete;
    DROP TABLE file_watch_index; DROP TABLE folder_watch_index;
    ALTER TABLE files DROP COLUMN missing_at_ms; ALTER TABLE files DROP COLUMN dev;
    ALTER TABLE files DROP COLUMN ino; ALTER TABLE files DROP COLUMN mtime_ms; ALTER TABLE files DROP COLUMN head_hash;
    ALTER TABLE folders DROP COLUMN missing_at_ms; ALTER TABLE folders DROP COLUMN dev;
    ALTER TABLE folders DROP COLUMN ino; ALTER TABLE folders DROP COLUMN mtime_ms;
    DROP TABLE legacy_import_users; DROP TABLE legacy_import_tokens;
    ALTER TABLE api_tokens DROP COLUMN legacy_jwt; PRAGMA user_version=21`);
}
