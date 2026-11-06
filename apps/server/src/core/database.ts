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
const schemaV14 = `
  ALTER TABLE files ADD COLUMN thumb_ready INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE cache_entries ADD COLUMN source_size INTEGER;
  ALTER TABLE cache_entries ADD COLUMN source_modified INTEGER;
  CREATE INDEX folders_cover ON folders(cover_file_id);
`;
const schemaV15 = `
  CREATE TABLE hls_sessions (
    id TEXT PRIMARY KEY, media_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    principal_hash TEXT NOT NULL, source_size INTEGER NOT NULL, source_modified INTEGER NOT NULL,
    job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL, generation TEXT, state TEXT NOT NULL,
    last_access_at INTEGER NOT NULL
  );
  CREATE INDEX hls_sessions_idle ON hls_sessions(last_access_at);
  ALTER TABLE cache_entries ADD COLUMN hls_session_id TEXT;
  CREATE INDEX cache_entries_hls ON cache_entries(hls_session_id);
`;
const schemaV16 = `
  ALTER TABLE ffmpeg_slots ADD COLUMN kind TEXT NOT NULL DEFAULT 'ffmpeg';
  CREATE INDEX worker_slots_kind ON ffmpeg_slots(kind,lease_expires_at);
`;
const schemaV17 = `
  CREATE TABLE metadata_dirty_folders (path TEXT PRIMARY KEY, updated INTEGER NOT NULL);
  CREATE INDEX files_folder_cover ON files(folder,taken_at DESC,id ASC) WHERE thumb_ready=1;
`;
const schemaV18 = `
  ALTER TABLE jobs ADD COLUMN media_background INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE media_waiters (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, lease_expires_at INTEGER NOT NULL
  );
  CREATE INDEX media_waiters_job ON media_waiters(job_id,lease_expires_at);
`;
const schemaV19 = `
  ALTER TABLE jobs ADD COLUMN lease_token TEXT;
  ALTER TABLE scan_locks ADD COLUMN lease_token TEXT;
`;
const schemaV20 = `
  CREATE TABLE legacy_jwt_users (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE);
  CREATE TABLE legacy_jwt_sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
  CREATE INDEX legacy_jwt_sessions_user ON legacy_jwt_sessions(user_id);
  CREATE TABLE legacy_jwt_revoked_users (username TEXT PRIMARY KEY);
  INSERT INTO legacy_jwt_users(user_id) SELECT id FROM users WHERE id GLOB 'usr_*';
  CREATE TRIGGER legacy_user_retire AFTER DELETE ON users BEGIN
    INSERT OR IGNORE INTO legacy_jwt_revoked_users(username) VALUES(old.username);
  END;
`;
const schemaV21 = `
  CREATE TABLE media_generation_locks (
    cache_key TEXT PRIMARY KEY,owner TEXT NOT NULL,lease_token TEXT NOT NULL,lease_expires_at INTEGER NOT NULL
  );
`;
const schemaV22 = `
  ALTER TABLE api_tokens ADD COLUMN legacy_jwt INTEGER NOT NULL DEFAULT 0;
  UPDATE api_tokens SET legacy_jwt=1 WHERE id GLOB 'tok_*';
  CREATE TABLE legacy_import_users (username TEXT PRIMARY KEY,user_id TEXT NOT NULL);
  CREATE TABLE legacy_import_tokens (token_hash TEXT PRIMARY KEY);
  INSERT OR IGNORE INTO legacy_import_users(username,user_id)
    SELECT u.username,u.id FROM users u WHERE EXISTS(SELECT 1 FROM legacy_jwt_users j WHERE j.user_id=u.id)
      OR EXISTS(SELECT 1 FROM api_tokens t WHERE t.user_id=u.id AND t.legacy_jwt=1);
  INSERT OR IGNORE INTO legacy_import_users(username,user_id) SELECT username,'' FROM legacy_jwt_revoked_users;
  INSERT OR IGNORE INTO legacy_import_tokens(token_hash) SELECT token_hash FROM api_tokens WHERE legacy_jwt=1;
  INSERT OR IGNORE INTO settings(key,value)
    SELECT 'legacy.identity_upgrade_locked','true' WHERE EXISTS(SELECT 1 FROM legacy_import_users)
      OR EXISTS(SELECT 1 FROM jobs WHERE type='import_legacy' AND started_at IS NOT NULL);
  INSERT INTO settings(key,value)
    SELECT 'legacy.pending','true' WHERE EXISTS(SELECT 1 FROM settings WHERE key='legacy.identity_upgrade_locked')
      AND NOT EXISTS(SELECT 1 FROM users WHERE role='admin')
    ON CONFLICT(key) DO UPDATE SET value='true';
`;

const schemaV23 = `
  ALTER TABLE files ADD COLUMN missing_at_ms INTEGER;
  ALTER TABLE files ADD COLUMN dev TEXT;
  ALTER TABLE files ADD COLUMN ino TEXT;
  ALTER TABLE files ADD COLUMN mtime_ms REAL;
  ALTER TABLE files ADD COLUMN head_hash TEXT;
  ALTER TABLE folders ADD COLUMN missing_at_ms INTEGER;
  ALTER TABLE folders ADD COLUMN dev TEXT;
  ALTER TABLE folders ADD COLUMN ino TEXT;
  ALTER TABLE folders ADD COLUMN mtime_ms REAL;
  CREATE TABLE file_watch_index (file_id TEXT PRIMARY KEY,library_id TEXT NOT NULL,missing_at_ms INTEGER,
    dev TEXT,ino TEXT,size INTEGER NOT NULL,mtime_ms REAL,head_hash TEXT);
  CREATE INDEX files_missing ON file_watch_index(library_id,missing_at_ms) WHERE missing_at_ms IS NOT NULL;
  CREATE INDEX files_identity ON file_watch_index(library_id,dev,ino) WHERE dev IS NOT NULL AND ino IS NOT NULL;
  CREATE INDEX files_head ON file_watch_index(library_id,size,mtime_ms,head_hash) WHERE head_hash IS NOT NULL;
  CREATE TABLE folder_watch_index (folder_path TEXT PRIMARY KEY,library_id TEXT NOT NULL,missing_at_ms INTEGER,dev TEXT,ino TEXT);
  CREATE INDEX folders_missing ON folder_watch_index(library_id,missing_at_ms) WHERE missing_at_ms IS NOT NULL;
  CREATE INDEX folders_identity ON folder_watch_index(library_id,dev,ino) WHERE dev IS NOT NULL AND ino IS NOT NULL;
  CREATE TRIGGER files_watch_insert AFTER INSERT ON files WHEN new.missing_at_ms IS NOT NULL OR (new.dev IS NOT NULL AND new.ino IS NOT NULL) OR new.head_hash IS NOT NULL BEGIN
    INSERT INTO file_watch_index VALUES(new.id,new.library_id,new.missing_at_ms,new.dev,new.ino,new.size,new.mtime_ms,new.head_hash);
  END;
  CREATE TRIGGER files_watch_update AFTER UPDATE OF id,library_id,missing_at_ms,dev,ino,size,mtime_ms,head_hash ON files BEGIN
    DELETE FROM file_watch_index WHERE file_id=old.id;
    INSERT INTO file_watch_index SELECT new.id,new.library_id,new.missing_at_ms,new.dev,new.ino,new.size,new.mtime_ms,new.head_hash
      WHERE new.missing_at_ms IS NOT NULL OR (new.dev IS NOT NULL AND new.ino IS NOT NULL) OR new.head_hash IS NOT NULL;
  END;
  CREATE TRIGGER files_watch_delete AFTER DELETE ON files BEGIN DELETE FROM file_watch_index WHERE file_id=old.id; END;
  CREATE TRIGGER folders_watch_insert AFTER INSERT ON folders WHEN new.missing_at_ms IS NOT NULL OR (new.dev IS NOT NULL AND new.ino IS NOT NULL) BEGIN
    INSERT INTO folder_watch_index VALUES(new.path,new.library_id,new.missing_at_ms,new.dev,new.ino);
  END;
  CREATE TRIGGER folders_watch_update AFTER UPDATE OF path,library_id,missing_at_ms,dev,ino ON folders BEGIN
    DELETE FROM folder_watch_index WHERE folder_path=old.path;
    INSERT INTO folder_watch_index SELECT new.path,new.library_id,new.missing_at_ms,new.dev,new.ino
      WHERE new.missing_at_ms IS NOT NULL OR (new.dev IS NOT NULL AND new.ino IS NOT NULL);
  END;
  CREATE TRIGGER folders_watch_delete AFTER DELETE ON folders BEGIN DELETE FROM folder_watch_index WHERE folder_path=old.path; END;
`;
const schemaV24 = `
  CREATE TABLE library_changes (
    id INTEGER PRIMARY KEY, library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, from_path TEXT,
    is_dir INTEGER NOT NULL, media_id TEXT, source TEXT NOT NULL
  );
  CREATE INDEX library_changes_recent ON library_changes(library_id,ts DESC,id DESC);
  CREATE INDEX library_changes_retention ON library_changes(ts);
`;
const schemaV25 = `
  CREATE TABLE index_backfill (
    id INTEGER PRIMARY KEY CHECK(id=1), last_rowid INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0,
    complete INTEGER NOT NULL DEFAULT 0, owner TEXT, lease_until_ms INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO index_backfill(id) VALUES (1);
`;
const schemaV26 = `
  CREATE TABLE scan_conflicts (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, marker TEXT NOT NULL,
    relative_path TEXT NOT NULL, size INTEGER NOT NULL, mtime INTEGER NOT NULL, mtime_ms REAL NOT NULL,
    dev TEXT NOT NULL, ino TEXT NOT NULL, moved_id TEXT,
    PRIMARY KEY(library_id,marker,relative_path)
  );
  CREATE INDEX scan_conflicts_identity ON scan_conflicts(library_id,marker,moved_id) WHERE moved_id IS NOT NULL;
`;
const schemaV27 = `
  CREATE TABLE cache_gc (cache_key TEXT PRIMARY KEY,relative_path TEXT NOT NULL);
  CREATE TABLE timeline_missing_counts(month TEXT PRIMARY KEY,count INTEGER NOT NULL);
  CREATE TRIGGER missing_timeline_insert AFTER INSERT ON files WHEN new.missing_at_ms IS NOT NULL AND strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    INSERT INTO timeline_missing_counts(month,count) VALUES(strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1) ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
  CREATE TRIGGER missing_timeline_delete AFTER DELETE ON files WHEN old.missing_at_ms IS NOT NULL AND strftime('%Y-%m',old.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    UPDATE timeline_missing_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime'); DELETE FROM timeline_missing_counts WHERE count<=0;
  END;
  CREATE TRIGGER missing_timeline_update AFTER UPDATE OF missing_at_ms,taken_at ON files BEGIN
    UPDATE timeline_missing_counts SET count=count-1 WHERE old.missing_at_ms IS NOT NULL AND month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_missing_counts WHERE count<=0;
    INSERT INTO timeline_missing_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1
      WHERE new.missing_at_ms IS NOT NULL AND strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
`;
const schemaV28 = `
  DROP TRIGGER files_timeline_insert;
  DROP TRIGGER files_timeline_delete;
  DROP TRIGGER files_timeline_update;
  CREATE TRIGGER files_timeline_insert AFTER INSERT ON files
  WHEN new.missing_at_ms IS NULL AND strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    INSERT INTO timeline_counts(month,count) VALUES (strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1)
      ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
  CREATE TRIGGER files_timeline_delete AFTER DELETE ON files
  WHEN old.missing_at_ms IS NULL AND strftime('%Y-%m',old.taken_at,'unixepoch','localtime') IS NOT NULL BEGIN
    UPDATE timeline_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_counts WHERE count<=0;
  END;
  CREATE TRIGGER files_timeline_update AFTER UPDATE OF taken_at,missing_at_ms ON files BEGIN
    UPDATE timeline_counts SET count=count-1 WHERE old.missing_at_ms IS NULL AND month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_counts WHERE count<=0;
    INSERT INTO timeline_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1
      WHERE new.missing_at_ms IS NULL AND strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL
      ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
  CREATE TABLE timeline_rebuild_state(id INTEGER PRIMARY KEY CHECK(id=1),cursor INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE timeline_rebuild_counts(month TEXT PRIMARY KEY,count INTEGER NOT NULL);
  CREATE TRIGGER timeline_rebuild_insert AFTER INSERT ON files WHEN new.missing_at_ms IS NULL AND EXISTS(SELECT 1 FROM timeline_rebuild_state WHERE id=1 AND cursor>=new.rowid) BEGIN
    INSERT INTO timeline_rebuild_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1
      WHERE strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
  CREATE TRIGGER timeline_rebuild_delete AFTER DELETE ON files WHEN old.missing_at_ms IS NULL AND EXISTS(SELECT 1 FROM timeline_rebuild_state WHERE id=1 AND cursor>=old.rowid) BEGIN
    UPDATE timeline_rebuild_counts SET count=count-1 WHERE month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime'); DELETE FROM timeline_rebuild_counts WHERE count<=0;
  END;
  CREATE TRIGGER timeline_rebuild_update AFTER UPDATE OF taken_at,missing_at_ms ON files WHEN EXISTS(SELECT 1 FROM timeline_rebuild_state WHERE id=1 AND cursor>=old.rowid) BEGIN
    UPDATE timeline_rebuild_counts SET count=count-1 WHERE old.missing_at_ms IS NULL AND month=strftime('%Y-%m',old.taken_at,'unixepoch','localtime');
    DELETE FROM timeline_rebuild_counts WHERE count<=0;
    INSERT INTO timeline_rebuild_counts(month,count) SELECT strftime('%Y-%m',new.taken_at,'unixepoch','localtime'),1
      WHERE new.missing_at_ms IS NULL AND strftime('%Y-%m',new.taken_at,'unixepoch','localtime') IS NOT NULL ON CONFLICT(month) DO UPDATE SET count=count+1;
  END;
`;
const schemaV29 = `
  ALTER TABLE files ADD COLUMN cache_generation INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE scan_current_markers (library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE, marker TEXT NOT NULL);
  CREATE TABLE scan_expiry_logged (library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, path TEXT NOT NULL, PRIMARY KEY(library_id,path));
  CREATE TABLE scan_change_directories (
    library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
    marker TEXT NOT NULL, relative_path TEXT NOT NULL,
    PRIMARY KEY(library_id,marker,relative_path)
  );
`;
const schemaV30 = `
  CREATE TABLE watch_reconcile_requests (
    library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    reason TEXT NOT NULL, requested_at INTEGER NOT NULL
  );
`;
const schemaV31 = `
  CREATE TABLE watch_leases (library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    owner TEXT NOT NULL, token TEXT NOT NULL, lease_expires_at INTEGER NOT NULL);
`;
const schemaV32 = `
  ALTER TABLE libraries ADD COLUMN watch_mode TEXT NOT NULL DEFAULT 'auto';
  ALTER TABLE libraries ADD COLUMN watch_poll_interval_sec INTEGER NOT NULL DEFAULT 300;
`;
const schemaV33 = `
  CREATE TABLE library_watch_state (
    library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,
    mount_root TEXT, mount_identity TEXT, mount_attempted INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'starting',
    watched_dirs INTEGER, last_event_at TEXT, degraded_reason TEXT
  );
  CREATE TRIGGER library_watch_root_reset AFTER UPDATE OF root ON libraries WHEN old.root<>new.root BEGIN
    UPDATE library_watch_state SET mount_root=NULL,mount_identity=NULL,mount_attempted=0,state='starting',watched_dirs=NULL,degraded_reason=NULL WHERE library_id=new.id;
  END;
`;
const schemaV34 = `CREATE TABLE watch_worker_usage(owner TEXT PRIMARY KEY,watched_count INTEGER NOT NULL,lease_expires_at INTEGER NOT NULL);`;
const schemaV35 = `CREATE TABLE library_event_pending(library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,source TEXT NOT NULL,payload TEXT NOT NULL,queued_at_ms INTEGER NOT NULL,PRIMARY KEY(library_id,source));
  CREATE TABLE library_event_sent(library_id TEXT PRIMARY KEY REFERENCES libraries(id) ON DELETE CASCADE,sent_at_ms INTEGER NOT NULL);`;
const schemaV36 = `CREATE TABLE scan_event_counts(job_id TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,added INTEGER NOT NULL DEFAULT 0,removed INTEGER NOT NULL DEFAULT 0,updated INTEGER NOT NULL DEFAULT 0,moved INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE scan_event_restored(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,path TEXT NOT NULL,PRIMARY KEY(job_id,path));`;
const schemaV37 = `CREATE TABLE IF NOT EXISTS scan_event_folders(job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,path TEXT NOT NULL,PRIMARY KEY(job_id,path));`;

export function openDatabase(filename: string, options: { readonly?: boolean; bootstrapLegacy?: boolean } = {}): Database.Database {
  const readonly = options.readonly ?? false;
  const db = new Database(filename, { readonly, fileMustExist: readonly });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.pragma('cache_size = -32768');
    db.pragma('mmap_size = 67108864');
    // WAL 每次从头复用时把文件截到 64MB，避免长期读取期间涨大的 WAL 一直占着磁盘
    db.pragma('journal_size_limit = 67108864');
    if (!readonly) {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      // 关闭提交时的自动检查点：它在提交线程里同步写回主库并 fsync，磁盘繁忙时一次 1 秒以上。
      // 检查点由 worker 的后台线程定期执行（worker/wal-checkpoint.ts）
      db.pragma('wal_autocheckpoint = 0');
      db.transaction(() => {
        const version = db.pragma('user_version', { simple: true });
        if (typeof version !== 'number' || version < 0 || version > 39) throw new Error(`不支持的数据库版本: ${version}`);
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
        if (version <= 13) {
          db.exec(schemaV14);
          db.pragma('user_version = 14');
        }
        if (version <= 14) {
          db.exec(schemaV15);
          db.pragma('user_version = 15');
        }
        if (version <= 15) {
          db.exec(schemaV16);
          db.pragma('user_version = 16');
        }
        if (version <= 16) {
          db.exec(schemaV17);
          db.pragma('user_version = 17');
        }
        if (version <= 17) {
          db.exec(schemaV18);
          db.pragma('user_version = 18');
        }
        if (version <= 18) {
          db.exec(schemaV19);
          db.pragma('user_version = 19');
        }
        if (version <= 19) {
          db.exec(schemaV20);
          db.pragma('user_version = 20');
        }
        if (version <= 20) {
          db.exec(schemaV21);
          db.pragma('user_version = 21');
        }
        if (version <= 21) {
          db.exec(schemaV22);
          db.pragma('user_version = 22');
        }
        if (version <= 22) {
          db.exec(schemaV23);
          db.pragma('user_version = 23');
        }
        if (version <= 23) {
          db.exec(schemaV24);
          db.pragma('user_version = 24');
        }
        if (version <= 24) {
          db.exec(schemaV25);
          db.pragma('user_version = 25');
        }
        if (version <= 25) {
          db.exec(schemaV26);
          db.pragma('user_version = 26');
        }
        if (version <= 26) {
          db.exec(schemaV27);
          db.pragma('user_version = 27');
        }
        if (version <= 27) {
          const hasSummary = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='timeline_missing_counts'").get();
          let rebuild = false;
          if (hasSummary) {
            db.exec(`UPDATE timeline_counts SET count=count-COALESCE((SELECT count FROM timeline_missing_counts m WHERE m.month=timeline_counts.month),0);
              DELETE FROM timeline_counts WHERE count<=0; DROP TRIGGER missing_timeline_insert; DROP TRIGGER missing_timeline_delete;
              DROP TRIGGER missing_timeline_update; DROP TABLE timeline_missing_counts`);
          } else rebuild = true;
          db.exec(schemaV28);
          if (rebuild) db.prepare('INSERT INTO timeline_rebuild_state(id) VALUES (1)').run();
          db.pragma('user_version = 28');
        }
        if (version <= 28) {
          db.exec(schemaV29);
          db.pragma('user_version = 29');
        }
        if (version <= 29) {
          db.exec(schemaV30);
          db.pragma('user_version = 30');
        }
        if (version <= 30) {
          db.exec(schemaV31);
          db.pragma('user_version = 31');
        }
        if (version <= 31) {
          db.exec(schemaV32);
          db.pragma('user_version = 32');
        }
        if (version <= 32) {
          db.exec(schemaV33);
          db.pragma('user_version = 33');
        }
        if (version <= 33) {
          db.exec(schemaV34);
          db.pragma('user_version = 34');
        }
        if (version <= 34) {
          db.exec(schemaV35);
          db.pragma('user_version = 35');
        }
        if (version <= 35) {
          db.exec(schemaV36);
          db.pragma('user_version = 36');
        }
        if (version <= 36) {
          db.exec(schemaV37);
          db.pragma('user_version = 37');
        }
        if (version <= 37) {
          const columns = new Set((db.pragma('table_info(watch_reconcile_requests)') as { name: string }[]).map((column) => column.name));
          for (const [name, definition] of [['attempts', 'INTEGER NOT NULL DEFAULT 0'], ['next_attempt_at', 'INTEGER NOT NULL DEFAULT 0'],
            ['generation', 'INTEGER NOT NULL DEFAULT 1'], ['job_generation', 'INTEGER'], ['job_id', 'TEXT']] as const) {
            if (!columns.has(name)) db.exec(`ALTER TABLE watch_reconcile_requests ADD COLUMN ${name} ${definition}`);
          }
          db.pragma('user_version = 38');
        }
        if (version <= 38) {
          db.exec('CREATE TABLE IF NOT EXISTS scan_pending_media_moves (file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE)');
          db.pragma('user_version = 39');
        }
        // 元数据作业按媒体库认领：待处理文件在 id 上跨库交错，只靠 files_metadata 需要逐条跳过其它库的记录。
        // 纯增量索引不提升版本号，回滚到旧镜像时旧代码仍能打开数据库。
        const fileColumns = new Set((db.pragma('table_info(files)') as { name: string }[]).map((column) => column.name));
        if (fileColumns.has('library_id') && fileColumns.has('metadata_status')) db.exec('CREATE INDEX IF NOT EXISTS files_library_metadata ON files(library_id, metadata_status, id)');
        // 拍摄信息按修改时间倒序读取（与默认时间线顺序一致）；界面正在显示的文件记入 metadata_priority 优先读取
        if (fileColumns.has('library_id') && fileColumns.has('metadata_status') && fileColumns.has('modified_at')) {
          db.exec(`CREATE INDEX IF NOT EXISTS files_metadata_recent ON files(metadata_status, modified_at);
            CREATE INDEX IF NOT EXISTS files_library_metadata_recent ON files(library_id, metadata_status, modified_at);
            CREATE TABLE IF NOT EXISTS metadata_priority (file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE, requested_at INTEGER NOT NULL);
            CREATE INDEX IF NOT EXISTS metadata_priority_recent ON metadata_priority(requested_at)`);
        }
        // 时间线按修改时间分桶：无筛选时只读这个部分覆盖索引
        if (fileColumns.has('modified_at') && fileColumns.has('missing_at_ms')) db.exec('CREATE INDEX IF NOT EXISTS files_present_modified ON files(modified_at) WHERE missing_at_ms IS NULL');
        const timezone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const previous = db.prepare("SELECT value FROM settings WHERE key='timeline.timezone'").get() as { value: string } | undefined;
        if (previous && previous.value !== timezone) {
          db.exec('DELETE FROM timeline_rebuild_counts; INSERT INTO timeline_rebuild_state(id,cursor) VALUES(1,0) ON CONFLICT(id) DO UPDATE SET cursor=0');
        }
        db.prepare("INSERT INTO settings(key,value) VALUES('timeline.timezone',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(timezone);
        if (version === 0 && options.bootstrapLegacy) {
          db.prepare("INSERT INTO settings(key,value) VALUES('legacy.pending','true')").run();
          db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES (?,'import_legacy','导入旧版数据','queued','system',unixepoch())").run(randomUUID());
        }
      }).immediate();
    } else if (db.pragma('user_version', { simple: true }) !== 39) {
      throw new Error('数据库尚未就绪或版本不受支持');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
