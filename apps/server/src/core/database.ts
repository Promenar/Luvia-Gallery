import Database from 'better-sqlite3';

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

export function openDatabase(filename: string, options: { readonly?: boolean } = {}): Database.Database {
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
        if (version !== 0 && version !== 1 && version !== 2 && version !== 3) throw new Error(`不支持的数据库版本: ${version}`);
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
      }).immediate();
    } else if (db.pragma('user_version', { simple: true }) !== 3) {
      throw new Error('数据库尚未就绪或版本不受支持');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
