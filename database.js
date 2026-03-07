const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'lumina.db');

let db = null;

/**
 * Initialize the database connection and schema
 */
function initDatabase() {
    // Ensure data directory exists
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
        console.log('Database loaded from', DB_FILE);
        db = new Database(DB_FILE);
    } else {
        console.log('Created new database');
        db = new Database(DB_FILE);
        createSchema();
    }

    db.pragma('journal_mode = WAL'); // Enable WAL mode for high concurrency

    // Create/Verify schema exists (for upgrades)
    ensureSchema();

    // Migration
    migrateFavorites();
    migrateToFTS5(); // FTS5 migration for existing data
}

/**
 * Create database schema
 */
function createSchema() {
    console.log('Creating database schema...');

    // Files table
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            folder_path TEXT NOT NULL,
            size INTEGER NOT NULL,
            type TEXT NOT NULL,
            media_type TEXT NOT NULL,
            last_modified INTEGER NOT NULL,
            source_id TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            thumb_width INTEGER,
            thumb_height INTEGER,
            thumb_aspect_ratio REAL
        )
    `);

    // Indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_folder_path ON files(folder_path);
        CREATE INDEX IF NOT EXISTS idx_media_type ON files(media_type);
        CREATE INDEX IF NOT EXISTS idx_source_id ON files(source_id);
        CREATE INDEX IF NOT EXISTS idx_last_modified ON files(last_modified DESC);
        CREATE INDEX IF NOT EXISTS idx_name ON files(name COLLATE NOCASE);
    `);

    // FTS5 Virtual Table for Search
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            name, 
            folder_path, 
            tokenize='unicode61'
        );
    `);

    // FTS5 Triggers synchronized via Native ROWID
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
        END;
        CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
        END;
        CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
        END;
    `);

    // Thumbnails table
    db.exec(`
        CREATE TABLE IF NOT EXISTS thumbnails (
            file_id TEXT PRIMARY KEY,
            thumbnail_path TEXT NOT NULL,
            generated_at INTEGER NOT NULL
        )
    `);

    // Favorites table
    db.exec(`
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            item_id TEXT NOT NULL,
            item_type TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(user_id, item_id, item_type)
        )
    `);

    // Folders cache table
    db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
            path TEXT PRIMARY KEY,
            media_count INTEGER DEFAULT 0,
            cover_file_id TEXT,
            last_updated INTEGER NOT NULL
        )
    `);

    console.log('Schema created successfully');
}

/**
 * Ensure schema exists (for database upgrades)
 */
function ensureSchema() {
    const tableInfo = db.pragma('table_info(files)');
    const columns = tableInfo.map(row => row.name);

    if (columns.length === 0) {
        createSchema();
        return;
    }

    // Migration: Add thumbnail dimension columns if they don't exist
    try {
        if (!columns.includes('thumb_width')) {
            console.log('[Migration] Adding thumb_width column to files table');
            db.prepare('ALTER TABLE files ADD COLUMN thumb_width INTEGER').run();
        }

        if (!columns.includes('thumb_height')) {
            console.log('[Migration] Adding thumb_height column to files table');
            db.prepare('ALTER TABLE files ADD COLUMN thumb_height INTEGER').run();
        }

        if (!columns.includes('thumb_aspect_ratio')) {
            console.log('[Migration] Adding thumb_aspect_ratio column to files table');
            db.prepare('ALTER TABLE files ADD COLUMN thumb_aspect_ratio REAL').run();
        }
    } catch (error) {
        console.error('[Migration] Failed to add thumbnail dimension columns:', error);
    }
}

async function migrateToFTS5() {
    console.log('[Migration] Checking FTS5 status...');

    // Check if FTS virtual table exists
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'").get();
    if (!tables) {
        console.log('[Migration] Creating FTS5 table as it is missing...');
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(name, folder_path, tokenize='unicode61');");
        db.exec(`
            CREATE TRIGGER IF NOT EXISTS files_fts_ai AFTER INSERT ON files BEGIN
                INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
            END;
            CREATE TRIGGER IF NOT EXISTS files_fts_ad AFTER DELETE ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
            END;
            CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
                INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
                INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
            END;
        `);
    }

    // Check if it is populated
    const count = db.prepare("SELECT COUNT(*) as count FROM files_fts").get();
    if (count.count > 0) {
        console.log('[Migration] FTS5 already indexed, skipping full table scan.');
        return;
    }

    console.log('[Migration] Starting FTS5 index building for existing files...');
    const BATCH_SIZE = 10000;
    let offset = 0;
    let total = 0;

    const insert = db.prepare("INSERT INTO files_fts(rowid, name, folder_path) VALUES (?, ?, ?)");
    const insertMany = db.transaction((items) => {
        for (const item of items) {
            insert.run(item.rowid, item.name, item.folder_path);
        }
    });

    while (true) {
        const rows = db.prepare("SELECT rowid, name, folder_path FROM files LIMIT ? OFFSET ?").all(BATCH_SIZE, offset);
        if (rows.length === 0) break;

        insertMany(rows);
        total += rows.length;
        offset += BATCH_SIZE;
        console.log(`[Migration] Indexed ${total} files...`);
    }

    console.log(`[Migration] FTS5 migration complete. Total: ${total} files indexed.`);
}

/**
 * Save database to disk (No-op for better-sqlite3 with WAL mode)
 */
function saveDatabase() {
    // No-op. Persistence is natively managed by SQLite / WAL
}

/**
 * Insert or update a file record
 */
function upsertFile(file) {
    const stmt = db.prepare(`
        INSERT INTO files (id, path, name, folder_path, size, type, media_type, last_modified, source_id, thumb_width, thumb_height, thumb_aspect_ratio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            size = excluded.size,
            last_modified = excluded.last_modified,
            thumb_width = excluded.thumb_width,
            thumb_height = excluded.thumb_height,
            thumb_aspect_ratio = excluded.thumb_aspect_ratio
    `);

    stmt.run(
        file.id,
        file.path,
        file.name,
        file.folderPath,
        file.size,
        file.type,
        file.mediaType,
        file.lastModified,
        file.sourceId,
        file.thumb_width || null,
        file.thumb_height || null,
        file.thumb_aspect_ratio || null
    );
}

/**
 * Insert files in batch (transaction)
 */
function insertFilesBatch(files) {
    try {
        const insertTx = db.transaction((filesList) => {
            for (const file of filesList) upsertFile(file);
        });
        insertTx(files);
        return true;
    } catch (error) {
        console.error('Batch insert failed:', error);
        return false;
    }
}

/**
 * Query files with pagination
 */
function queryFiles(options = {}) {
    const {
        offset = 0,
        limit = 500,
        folderPath = null,
        mediaType = null,
        sourceId = null,
        userId = null,
        random = false,
        excludeMediaType = null,
        allowedPaths = null,
        sortOption = 'dateDesc',
        search = null
    } = options;

    let query = 'SELECT f.*, fav.id as is_fav FROM files f';

    if (search) {
        query += ' JOIN files_fts fts ON f.rowid = fts.rowid';
    }

    if (userId) {
        query += ' LEFT JOIN favorites fav ON f.id = fav.item_id AND fav.user_id = ?';
    } else {
        query += ' LEFT JOIN favorites fav ON 1=0';
    }

    query += ' WHERE 1=1';
    const params = [];
    if (userId) params.push(userId);

    if (search) {
        query += ' AND fts.files_fts MATCH ?';
        params.push(search);
    }

    if (folderPath !== null) {
        if (options.recursive) {
            query += ' AND (f.folder_path = ? OR f.folder_path LIKE ?)';
            params.push(folderPath, folderPath + '/%');
        } else {
            query += ' AND f.folder_path = ?';
            params.push(folderPath);
        }
    }

    if (mediaType) {
        if (Array.isArray(mediaType)) {
            const placeholders = mediaType.map(() => '?').join(',');
            query += ` AND f.media_type IN (${placeholders})`;
            params.push(...mediaType);
        } else {
            query += ' AND f.media_type = ?';
            params.push(mediaType);
        }
    }

    if (excludeMediaType) {
        if (Array.isArray(excludeMediaType)) {
            const placeholders = excludeMediaType.map(() => '?').join(',');
            query += ` AND f.media_type NOT IN (${placeholders})`;
            params.push(...excludeMediaType);
        } else {
            query += ' AND f.media_type != ?';
            params.push(excludeMediaType);
        }
    }

    if (sourceId) {
        query += ' AND f.source_id = ?';
        params.push(sourceId);
    }

    if (allowedPaths !== null) {
        if (allowedPaths.length > 0) {
            const clauses = allowedPaths.map(() => '(f.path = ? OR f.path LIKE ? || "/%" OR f.folder_path = ? OR f.folder_path LIKE ? || "/%")').join(' OR ');
            query += ` AND (${clauses})`;
            allowedPaths.forEach(p => params.push(p, p, p, p));
        } else {
            query += ' AND 1=0';
        }
    }

    if (random) {
        query += ' ORDER BY RANDOM() LIMIT ? OFFSET ?';
    } else {
        switch (sortOption) {
            case 'dateAsc': query += ' ORDER BY f.last_modified ASC LIMIT ? OFFSET ?'; break;
            case 'nameAsc': query += ' ORDER BY f.name COLLATE NOCASE ASC LIMIT ? OFFSET ?'; break;
            case 'nameDesc': query += ' ORDER BY f.name COLLATE NOCASE DESC LIMIT ? OFFSET ?'; break;
            case 'dateDesc':
            default: query += ' ORDER BY f.last_modified DESC LIMIT ? OFFSET ?';
        }
    }

    params.push(limit, offset);

    const stmt = db.prepare(query);
    const results = stmt.all(...params);

    return results.map(row => ({
        id: row.id,
        path: row.path,
        name: row.name,
        folderPath: row.folder_path,
        size: row.size,
        type: row.type,
        mediaType: row.media_type,
        lastModified: row.last_modified,
        sourceId: row.source_id,
        isFavorite: !!row.is_fav,
        thumb_width: row.thumb_width,
        thumb_height: row.thumb_height,
        thumb_aspect_ratio: row.thumb_aspect_ratio
    }));
}

/**
 * Count total files
 */
function countFiles(options = {}) {
    const { folderPath = null, mediaType = null, recursive = false, allowedPaths = null, search = null } = options;

    let query = 'SELECT COUNT(*) as count FROM files f';
    if (search) {
        query += ' JOIN files_fts fts ON f.rowid = fts.rowid';
    }

    query += ' WHERE 1=1';
    const params = [];

    if (search) {
        query += ' AND fts.files_fts MATCH ?';
        params.push(search);
    }

    if (folderPath !== null) {
        if (recursive) {
            query += ' AND (f.folder_path = ? OR f.folder_path LIKE ?)';
            params.push(folderPath, folderPath + '/%');
        } else {
            query += ' AND f.folder_path = ?';
            params.push(folderPath);
        }
    }

    if (mediaType) {
        query += ' AND f.media_type = ?';
        params.push(mediaType);
    }

    if (allowedPaths !== null) {
        if (allowedPaths.length > 0) {
            const clauses = allowedPaths.map(() => '(f.path = ? OR f.path LIKE ? || "/%" OR f.folder_path = ? OR f.folder_path LIKE ? || "/%")').join(' OR ');
            query += ` AND (${clauses})`;
            allowedPaths.forEach(p => params.push(p, p, p, p));
        } else {
            query += ' AND 1=0';
        }
    }

    const stmt = db.prepare(query);
    const result = stmt.get(...params);
    return result.count || 0;
}

/**
 * Delete file by path or ID
 */
function deleteFile(filePath, id = null) {
    let query = 'DELETE FROM files WHERE path = ?';
    const params = [filePath];

    if (id) {
        query += ' OR id = ?';
        params.push(id);
    }

    db.prepare(query).run(...params);

    if (id) {
        db.prepare('DELETE FROM favorites WHERE item_id = ?').run(id);
    }
}

/**
 * Batch delete files
 */
function deleteFilesBatch(files) {
    try {
        const stmt = db.prepare('DELETE FROM files WHERE id = ?');
        const favStmt = db.prepare('DELETE FROM favorites WHERE item_id = ?');

        const tx = db.transaction((filesList) => {
            for (const file of filesList) {
                stmt.run(file.id);
                favStmt.run(file.id);
            }
        });
        tx(files);
        return true;
    } catch (e) {
        console.error('Batch delete failed:', e);
        return false;
    }
}

/**
 * Get all file paths and their last modified times for incremental scan
 */
function getAllFilesMtime() {
    const rows = db.prepare('SELECT path, last_modified FROM files').all();
    const mtimeMap = new Map();
    for (const row of rows) {
        mtimeMap.set(row.path, row.last_modified);
    }
    return mtimeMap;
}

function deleteFilesByFolder(folderPath) {
    db.prepare('DELETE FROM files WHERE folder_path = ? OR folder_path LIKE ?').run(folderPath, folderPath + '/%');
}

function deleteFilesBySourceId(sourceId) {
    db.prepare('DELETE FROM files WHERE source_id = ?').run(sourceId);
}

function getFileByPath(filePath) {
    const row = db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
    if (!row) return null;
    return {
        id: row.id,
        path: row.path,
        name: row.name,
        folderPath: row.folder_path,
        size: row.size,
        type: row.type,
        mediaType: row.media_type,
        lastModified: row.last_modified,
        sourceId: row.source_id,
        thumb_width: row.thumb_width,
        thumb_height: row.thumb_height,
        thumb_aspect_ratio: row.thumb_aspect_ratio
    };
}

function clearAllFiles() {
    db.prepare('DELETE FROM files').run();
}

function getStats(options = {}) {
    const { allowedPaths = null } = options;
    const totalFiles = countFiles({ allowedPaths });
    const totalImages = countFiles({ mediaType: 'image', allowedPaths });
    const totalVideos = countFiles({ mediaType: 'video', allowedPaths });
    const totalAudio = countFiles({ mediaType: 'audio', allowedPaths });

    return {
        totalFiles,
        totalImages,
        totalVideos,
        totalAudio,
        dbSize: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0
    };
}

function closeDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

function migrateFavorites() {
    try {
        console.log('[Migration] Checking for legacy path-based favorites...');
        db.exec(`
            UPDATE favorites 
            SET item_id = (SELECT id FROM files WHERE path = favorites.item_id) 
            WHERE item_type = 'file' 
            AND item_id NOT IN(SELECT id FROM files) 
            AND item_id IN(SELECT path FROM files);
            `);
    } catch (e) {
        console.error('[Migration] Error migrating favorites:', e);
    }
}

function toggleFavorite(userId, itemId, itemType) {
    const exists = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?').get(userId, itemId, itemType);

    if (exists) {
        db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?').run(userId, itemId, itemType);
        return false;
    } else {
        db.prepare('INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)').run(userId, itemId, itemType);
        return true;
    }
}

function getFavoriteIds(userId) {
    const rows = db.prepare('SELECT item_id, item_type FROM favorites WHERE user_id = ?').all(userId);
    const files = [];
    const folders = [];
    for (const row of rows) {
        if (row.item_type === 'file') files.push(row.item_id);
        else if (row.item_type === 'folder') folders.push(row.item_id);
    }
    return { files, folders };
}

function queryFavoriteFiles(userId, options = {}) {
    const { offset = 0, limit = 500 } = options;
    const query = `
        SELECT f.*
                FROM favorites fav
        JOIN files f ON(f.id = fav.item_id OR f.path = fav.item_id)
        WHERE fav.user_id = ? AND fav.item_type = 'file'
        ORDER BY f.last_modified DESC
            LIMIT ? OFFSET ?
                `;
    const rows = db.prepare(query).all(userId, limit, offset);

    return rows.map(row => ({
        id: row.id,
        path: row.path,
        name: row.name,
        folderPath: row.folder_path,
        size: row.size,
        type: row.type,
        mediaType: row.media_type,
        lastModified: row.last_modified,
        sourceId: row.source_id,
        thumb_width: row.thumb_width,
        thumb_height: row.thumb_height,
        thumb_aspect_ratio: row.thumb_aspect_ratio
    }));
}

function countFavoriteFiles(userId) {
    const query = `SELECT COUNT(*) as count FROM favorites fav JOIN files f ON(f.id = fav.item_id OR f.path = fav.item_id) WHERE fav.user_id = ? AND fav.item_type = 'file'`;
    const result = db.prepare(query).get(userId);
    return result.count || 0;
}

function renameFile(oldPath, newPath, newName) {
    const oldId = Buffer.from(oldPath).toString('base64');
    const newId = Buffer.from(newPath).toString('base64');
    const folderPath = path.dirname(newPath);

    try {
        const tx = db.transaction(() => {
            const row = db.prepare('SELECT * FROM files WHERE path = ?').get(oldPath);
            if (row) {
                db.prepare('DELETE FROM files WHERE id = ?').run(oldId);
                const stmt = db.prepare(`
                    INSERT INTO files(id, path, name, folder_path, size, type, media_type, last_modified, source_id)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
                stmt.run(newId, newPath, newName, folderPath, row.size, row.type, row.media_type, Date.now(), row.source_id);

                db.prepare('UPDATE favorites SET item_id = ? WHERE item_id = ?').run(newId, oldId);
                db.prepare('UPDATE thumbnails SET file_id = ? WHERE file_id = ?').run(newId, oldId);
            }
        });
        tx();
        return true;
    } catch (e) {
        console.error("Rename DB error:", e);
        return false;
    }
}

function clearThumbnails() {
    db.prepare('DELETE FROM thumbnails').run();
}

function getAllFilePaths() {
    const rows = db.prepare('SELECT path FROM files').all();
    return rows.map(r => r.path);
}

module.exports = {
    initDatabase,
    saveDatabase,
    upsertFile,
    insertFilesBatch,
    queryFiles,
    countFiles,
    deleteFile,
    deleteFilesByFolder,
    deleteFilesBySourceId,
    getFileByPath,
    clearAllFiles,
    getStats,
    closeDatabase,
    toggleFavorite,
    getFavoriteIds,
    queryFavoriteFiles,
    countFavoriteFiles,
    getAllFilePaths,
    deleteFilesBatch,
    getAllFilesMtime,
    renameFile,
    clearThumbnails,
    migrateFavorites
};
