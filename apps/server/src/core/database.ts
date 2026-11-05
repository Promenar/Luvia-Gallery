import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const schemaV1 = `
  CREATE TABLE libraries (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'ok', last_scan_at INTEGER
  );
  CREATE TABLE files (
    id TEXT NOT NULL UNIQUE, legacy_id TEXT UNIQUE,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL, folder TEXT NOT NULL, name TEXT NOT NULL,
    mime TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL,
    modified_at INTEGER NOT NULL, taken_at INTEGER NOT NULL, taken_at_source TEXT NOT NULL,
    width INTEGER, height INTEGER, orientation INTEGER, duration_sec REAL,
    codec TEXT, audio_codec TEXT, container TEXT, fps REAL, bitrate INTEGER,
    make TEXT, model TEXT, lens TEXT, f_number REAL, exposure_time REAL, iso REAL,
    focal_length REAL, focal_length35 REAL, software TEXT, latitude REAL, longitude REAL, altitude REAL,
    thumbhash TEXT, thumb_version INTEGER NOT NULL DEFAULT 0, has_preview INTEGER NOT NULL DEFAULT 0,
    playability TEXT, metadata_status TEXT NOT NULL DEFAULT 'pending', scan_marker TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE (library_id, relative_path)
  );
  CREATE INDEX files_taken_id ON files(taken_at DESC, id ASC);
  CREATE INDEX files_modified_id ON files(modified_at DESC, id ASC);
  CREATE INDEX files_name_id ON files(name COLLATE NOCASE, id ASC);
  CREATE INDEX files_size_id ON files(size DESC, id ASC);
  CREATE INDEX files_folder ON files(folder, taken_at DESC, id ASC);
  CREATE INDEX files_library ON files(library_id, scan_marker);
  CREATE INDEX files_type_taken ON files(media_type, taken_at DESC, id ASC);
  CREATE INDEX files_metadata ON files(metadata_status, id);
  CREATE VIRTUAL TABLE files_fts USING fts5(name, folder, content='files', content_rowid='rowid', tokenize='trigram');
  CREATE TRIGGER files_fts_insert AFTER INSERT ON files BEGIN
    INSERT INTO files_fts(rowid, name, folder) VALUES (new.rowid, new.name, new.folder);
  END;
  CREATE TRIGGER files_fts_delete AFTER DELETE ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder) VALUES ('delete', old.rowid, old.name, old.folder);
  END;
  CREATE TRIGGER files_fts_update AFTER UPDATE OF name, folder ON files BEGIN
    INSERT INTO files_fts(files_fts, rowid, name, folder) VALUES ('delete', old.rowid, old.name, old.folder);
    INSERT INTO files_fts(rowid, name, folder) VALUES (new.rowid, new.name, new.folder);
  END;
  CREATE TABLE folders (
    path TEXT PRIMARY KEY, library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    parent TEXT, name TEXT NOT NULL, media_count INTEGER NOT NULL DEFAULT 0,
    child_count INTEGER NOT NULL DEFAULT 0, cover_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
    latest_at INTEGER, direct_media_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX folders_parent ON folders(parent, name);
  CREATE TABLE users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','user')), allowed_paths TEXT,
    preferences TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, scope TEXT NOT NULL,
    prefix TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER, expires_at INTEGER
  );
  CREATE TABLE favorites (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL, item_type TEXT NOT NULL CHECK (item_type IN ('file','folder')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), PRIMARY KEY (user_id, item_type, item_id)
  );
  CREATE TABLE albums (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, description TEXT, kind TEXT NOT NULL, filter TEXT, cover_id TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX albums_user ON albums(user_id, updated_at DESC);
  CREATE TABLE album_items (
    album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, PRIMARY KEY (album_id, file_id)
  );
  CREATE INDEX album_items_file ON album_items(file_id);
  CREATE TABLE shares (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE, title TEXT NOT NULL, target TEXT NOT NULL, password_hash TEXT,
    allow_download INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, created_at INTEGER NOT NULL,
    view_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE share_sessions (
    token_hash TEXT PRIMARY KEY, share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE download_tickets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL,
    progress_done INTEGER NOT NULL DEFAULT 0, progress_total INTEGER, message TEXT, error TEXT,
    result TEXT, trigger TEXT NOT NULL, payload TEXT, checkpoint TEXT, created_at INTEGER NOT NULL,
    started_at INTEGER, finished_at INTEGER
  );
  CREATE INDEX jobs_status_created ON jobs(status, created_at);
  CREATE TABLE job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, payload TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const schemaV2 = `
  CREATE TABLE IF NOT EXISTS scan_locks (
    library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    owner TEXT NOT NULL, acquired_at INTEGER NOT NULL
  );
`;

const schemaV3 = `ALTER TABLE api_tokens ADD COLUMN wallpaper TEXT;`;

const schemaV4 = `
  ALTER TABLE jobs ADD COLUMN owner TEXT;
  ALTER TABLE jobs ADD COLUMN heartbeat_at INTEGER;
  ALTER TABLE jobs ADD COLUMN lease_expires_at INTEGER;
  ALTER TABLE scan_locks ADD COLUMN heartbeat_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE scan_locks ADD COLUMN lease_expires_at INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX jobs_lease ON jobs(status, lease_expires_at);
  CREATE TABLE scan_runs (
    job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    marker TEXT NOT NULL, added INTEGER NOT NULL DEFAULT 0,
    removed INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE scan_directories (
    job_id TEXT NOT NULL REFERENCES scan_runs(job_id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(job_id,relative_path)
  );
  CREATE INDEX scan_directories_pending ON scan_directories(job_id,done,relative_path);
`;

const schemaV5 = `
  CREATE TABLE legacy_favorites_pending (
    source_key TEXT PRIMARY KEY, username TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    legacy_item TEXT NOT NULL, absolute_path TEXT,
    item_type TEXT NOT NULL, created_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','matched','unmatched'))
  );
  CREATE INDEX legacy_favorites_status ON legacy_favorites_pending(status,source_key);
`;

const schemaV6 = `
  ALTER TABLE libraries ADD COLUMN host_root TEXT;
  ALTER TABLE libraries ADD COLUMN host_root_source TEXT;
  ALTER TABLE libraries ADD COLUMN exclude TEXT NOT NULL DEFAULT '["@eaDir","#recycle",".*",".thumbnails"]';
  ALTER TABLE folders ADD COLUMN scan_marker TEXT;
  CREATE INDEX folders_library_marker ON folders(library_id,scan_marker);
`;

const schemaV7 = `
  ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
  CREATE UNIQUE INDEX jobs_active_dedupe ON jobs(dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status IN ('queued','running','paused');
`;

const schemaV8 = `
  CREATE TABLE cache_entries (
    cache_key TEXT PRIMARY KEY, relative_path TEXT NOT NULL UNIQUE,
    bytes INTEGER NOT NULL, last_access_at INTEGER NOT NULL
  );
  CREATE INDEX cache_lru ON cache_entries(last_access_at,cache_key);
`;

const rebuildTimeline = `
  INSERT INTO timeline_counts(month,count)
  SELECT strftime('%Y-%m',taken_at,'unixepoch','localtime'),count(*) FROM files
  WHERE strftime('%Y-%m',taken_at,'unixepoch','localtime') IS NOT NULL GROUP BY 1;
`;
const schemaV9 = `
  CREATE TABLE timeline_counts (month TEXT PRIMARY KEY, count INTEGER NOT NULL);
  ${rebuildTimeline}
  CREATE TRIGGER files_timeline_insert AFTER INSERT ON files
  WHEN strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    INSERT INTO timeline_counts(month,count) VALUES (strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1)
      ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
  CREATE TRIGGER files_timeline_delete AFTER DELETE ON files
  WHEN strftime('%Y-%m',old.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    UPDATE timeline_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_counts WHERE count<=0;
  END;
  CREATE TRIGGER files_timeline_update AFTER UPDATE OF taken_at ON files
  WHEN strftime('%Y-%m',old.taken_at,'unixepoch','localtime') IS NOT strftime('%Y-%m',new.taken_at,'unixepoch','localtime') BEGIN
    UPDATE timeline_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_counts WHERE count<=0;
    INSERT INTO timeline_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1
      WHERE strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL
      ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
`;

const schemaV10 = `
  CREATE TABLE metadata_claims (
    file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    owner TEXT NOT NULL, lease_expires_at INTEGER NOT NULL
  );
  CREATE INDEX metadata_claims_expiry ON metadata_claims(lease_expires_at);
`;
const schemaV11 = `
  CREATE TABLE ffmpeg_slots (id TEXT PRIMARY KEY, owner TEXT NOT NULL, lease_expires_at INTEGER NOT NULL);
  CREATE INDEX ffmpeg_slots_expiry ON ffmpeg_slots(lease_expires_at);
`;
const schemaV12 = `
  ALTER TABLE cache_entries ADD COLUMN media_id TEXT;
  ALTER TABLE cache_entries ADD COLUMN variant TEXT;
  CREATE INDEX cache_entries_media_variant ON cache_entries(media_id,variant);
`;
const schemaV13 = `CREATE INDEX files_created_id ON files(created_at DESC,id ASC);`;

export function openDatabase(filename: string, options: { readonly?: boolean; bootstrapLegacy?: boolean } = {}): Database.Database {
  const readonly = options.readonly ?? false;
  const db = new Database(filename, { readonly, fileMustExist: readonly });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('cache_size = -32768');
    db.pragma('mmap_size = 67108864');
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.transaction(() => {
        const version = db.pragma('user_version', { simple: true });
        if (typeof version !== 'number' || version < 0 || version > 13) throw new Error(`不支持的数据库版本: ${version}`);
        if (version === 0) {
          db.exec(schemaV1);
          db.pragma('user_version = 1');
        }
        if (version === 0 || version === 1) {
          db.exec(schemaV2);
          db.pragma('user_version = 2');
        }
        if (version === 0 || version === 1 || version === 2) {
          db.exec(schemaV3);
          db.pragma('user_version = 3');
        }
        if (version === 0 || version === 1 || version === 2 || version === 3) {
          db.exec(schemaV4);
          db.pragma('user_version = 4');
        }
        if (version === 0 || version === 1 || version === 2 || version === 3 || version === 4) {
          db.exec(schemaV5);
          db.pragma('user_version = 5');
        }
        if (version === 0 || version === 1 || version === 2 || version === 3 || version === 4 || version === 5) {
          db.exec(schemaV6);
          db.pragma('user_version = 6');
        }
        if (version === 0 || version === 1 || version === 2 || version === 3 || version === 4 || version === 5 || version === 6) {
          db.exec(schemaV7);
          db.pragma('user_version = 7');
        }
        if (version === 0 || version === 1 || version === 2 || version === 3 || version === 4 || version === 5 || version === 6 || version === 7) {
          db.exec(schemaV8);
          db.pragma('user_version = 8');
        }
        if (version <= 8) {
          db.exec(schemaV9);
          db.pragma('user_version = 9');
        }
        if (version <= 9) {
          db.exec(schemaV10);
          db.pragma('user_version = 10');
        }
        if (version <= 10) {
          db.exec(schemaV11);
          db.pragma('user_version = 11');
        }
        if (version <= 11) {
          db.exec(schemaV12);
          db.pragma('user_version = 12');
        }
        if (version <= 12) {
          db.exec(schemaV13);
          db.pragma('user_version = 13');
        }
        const timezone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const previous = db.prepare("SELECT value FROM settings WHERE key='timeline.timezone'").get() as { value: string } | undefined;
        if (previous && previous.value !== timezone) {
          db.exec('DELETE FROM timeline_counts');
          db.exec(rebuildTimeline);
        }
        db.prepare("INSERT INTO settings(key,value) VALUES('timeline.timezone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(timezone);
        if (version === 0 && options.bootstrapLegacy) {
          db.prepare("INSERT INTO settings(key,value) VALUES('legacy.pending','true')").run();
          db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES (?,'import_legacy','导入旧版数据','queued','system',unixepoch())").run(randomUUID());
        }
      }).immediate();
    } else if (db.pragma('user_version', { simple: true }) !== 13) {
      throw new Error('数据库尚未就绪或版本不受支持');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
