import type Database from 'better-sqlite3';

export function restoreVersion21Fixture(db: Database.Database): void {
  db.exec(`DROP TABLE index_backfill; DROP TABLE library_changes;
    DROP INDEX files_missing; DROP INDEX files_identity; DROP INDEX files_head;
    DROP INDEX folders_missing; DROP INDEX folders_identity;
    ALTER TABLE files DROP COLUMN missing_at_ms; ALTER TABLE files DROP COLUMN dev;
    ALTER TABLE files DROP COLUMN ino; ALTER TABLE files DROP COLUMN mtime_ms; ALTER TABLE files DROP COLUMN head_hash;
    ALTER TABLE folders DROP COLUMN missing_at_ms; ALTER TABLE folders DROP COLUMN dev;
    ALTER TABLE folders DROP COLUMN ino; ALTER TABLE folders DROP COLUMN mtime_ms;
    DROP TABLE legacy_import_users; DROP TABLE legacy_import_tokens;
    ALTER TABLE api_tokens DROP COLUMN legacy_jwt; PRAGMA user_version=21`);
}
