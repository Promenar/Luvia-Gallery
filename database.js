const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'lumina.db');

let db = null;
let SQL = null;

/**
 * Initialize the database connection and schema
 */
async function initDatabase() {
    // Ensure data directory exists
    if (!fs.existsSync(DB_DIR)) {
        fs.mkdirSync(DB_DIR, { recursive: true });
    }

    // Initialize sql.js
    SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(DB_FILE)) {
        const buffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(buffer);
        console.log('Database loaded from', DB_FILE);
    } else {
        db = new SQL.Database();
        console.log('Created new database');
        createSchema();
    }

    // Verify schema exists (for upgrades)
    ensureSchema();
}

/**
 * Create database schema
 */
function createSchema() {
    console.log('Creating database schema...');

    // Files table
    db.run(`
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
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    `);

    // Indexes for performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_folder_path ON files(folder_path)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_media_type ON files(media_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_source_id ON files(source_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_last_modified ON files(last_modified DESC)`);

    // Thumbnails table
    db.run(`
        CREATE TABLE IF NOT EXISTS thumbnails (
            file_id TEXT PRIMARY KEY,
            thumbnail_path TEXT NOT NULL,
            generated_at INTEGER NOT NULL
        )
    `);

    // Favorites table
    db.run(`
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
    db.run(`
        CREATE TABLE IF NOT EXISTS folders (
            path TEXT PRIMARY KEY,
            media_count INTEGER DEFAULT 0,
            cover_file_id TEXT,
            last_updated INTEGER NOT NULL
        )
    `);

    console.log('Schema created successfully');
    saveDatabase();
}

/**
 * Ensure schema exists (for database upgrades)
 */
function ensureSchema() {
    // Check if tables exist
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.length > 0 ? tables[0].values.map(row => row[0]) : [];

    if (!tableNames.includes('files')) {
        createSchema();
    }
}

/**
 * Save database to disk
 */
function saveDatabase() {
    if (!db) {
        console.log('[DB] saveDatabase: db is null, skipping save');
        return;
    }
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_FILE, buffer);
        console.log('[DB] Database saved to', DB_FILE, '- Size:', buffer.length, 'bytes');
    } catch (error) {
        console.error('[DB] Failed to save database:', error);
    }
}

/**
 * Insert or update a file record
 */
function upsertFile(file) {
    const stmt = db.prepare(`
        INSERT INTO files (id, path, name, folder_path, size, type, media_type, last_modified, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            name = excluded.name,
            size = excluded.size,
            last_modified = excluded.last_modified
    `);

    stmt.run([
        file.id,
        file.path,
        file.name,
        file.folderPath,
        file.size,
        file.type,
        file.mediaType,
        file.lastModified,
        file.sourceId
    ]);

    stmt.free();
}

/**
 * Insert files in batch (transaction)
 */
function insertFilesBatch(files) {
    db.run('BEGIN TRANSACTION');

    try {
        for (const file of files) {
            upsertFile(file);
        }
        db.run('COMMIT');
        saveDatabase();
        return true;
    } catch (error) {
        db.run('ROLLBACK');
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
        sourceId = null
    } = options;

    let query = 'SELECT * FROM files WHERE 1=1';
    const params = [];

    if (folderPath !== null) {
        query += ' AND folder_path = ?';
        params.push(folderPath);
    }

    if (mediaType) {
        query += ' AND media_type = ?';
        params.push(mediaType);
    }

    if (sourceId) {
        query += ' AND source_id = ?';
        params.push(sourceId);
    }

    query += ' ORDER BY last_modified DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = db.prepare(query);
    stmt.bind(params);

    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: row.id,
            path: row.path,
            name: row.name,
            folderPath: row.folder_path,
            size: row.size,
            type: row.type,
            mediaType: row.media_type,
            lastModified: row.last_modified,
            sourceId: row.source_id
        });
    }
    stmt.free();

    return results;
}

/**
 * Count total files
 */
function countFiles(options = {}) {
    const { folderPath = null, mediaType = null } = options;

    let query = 'SELECT COUNT(*) as count FROM files WHERE 1=1';
    const params = [];

    if (folderPath !== null) {
        query += ' AND folder_path = ?';
        params.push(folderPath);
    }

    if (mediaType) {
        query += ' AND media_type = ?';
        params.push(mediaType);
    }

    const stmt = db.prepare(query);
    stmt.bind(params);
    stmt.step();
    const result = stmt.getAsObject();
    stmt.free();

    return result.count || 0;
}

/**
 * Delete file by path
 */
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

    const stmt = db.prepare(query);
    stmt.run(params);
    stmt.free();

    // Also delete from favorites
    if (id) {
        const favStmt = db.prepare('DELETE FROM favorites WHERE item_id = ?');
        favStmt.run([id]);
        favStmt.free();
    }

    saveDatabase();
}

/**
 * Delete files by folder path
 */
function deleteFilesByFolder(folderPath) {
    const stmt = db.prepare('DELETE FROM files WHERE folder_path = ? OR folder_path LIKE ?');
    stmt.run([folderPath, folderPath + '/%']);
    stmt.free();
    saveDatabase();
}

/**
 * Get file by path
 */
function getFileByPath(filePath) {
    const stmt = db.prepare('SELECT * FROM files WHERE path = ?');
    stmt.bind([filePath]);

    let result = null;
    if (stmt.step()) {
        const row = stmt.getAsObject();
        result = {
            id: row.id,
            path: row.path,
            name: row.name,
            folderPath: row.folder_path,
            size: row.size,
            type: row.type,
            mediaType: row.media_type,
            lastModified: row.last_modified,
            sourceId: row.source_id
        };
    }
    stmt.free();

    return result;
}

/**
 * Clear all files (for rescan)
 */
function clearAllFiles() {
    db.run('DELETE FROM files');
    saveDatabase();
}

/**
 * Get database statistics
 */
function getStats() {
    const totalFiles = countFiles();
    const totalImages = countFiles({ mediaType: 'image' });
    const totalVideos = countFiles({ mediaType: 'video' });
    const totalAudio = countFiles({ mediaType: 'audio' });

    return {
        totalFiles,
        totalImages,
        totalVideos,
        totalAudio,
        dbSize: fs.existsSync(DB_FILE) ? fs.statSync(DB_FILE).size : 0
    };
}

/**
 * Close database connection
 */
function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}

/**
 * Toggle favorite status
 */
function toggleFavorite(userId, itemId, itemType) {
    console.log('[DB] toggleFavorite called:', { userId, itemId, itemType });

    // Check if already favorited
    const checkStmt = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?');
    checkStmt.bind([userId, itemId, itemType]);

    const exists = checkStmt.step();
    checkStmt.free();

    console.log('[DB] Favorite exists:', exists);

    if (exists) {
        // Remove favorite
        const deleteStmt = db.prepare('DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?');
        deleteStmt.run([userId, itemId, itemType]);
        deleteStmt.free();
        console.log('[DB] Removed favorite, saving database...');
        saveDatabase();
        return false; // Not favorited anymore
    } else {
        // Add favorite
        const insertStmt = db.prepare('INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)');
        insertStmt.run([userId, itemId, itemType]);
        insertStmt.free();
        console.log('[DB] Added favorite, saving database...');
        saveDatabase();
        return true; // Now favorited
    }
}

/**
 * Get favorite IDs for a user
 */
function getFavoriteIds(userId) {
    const stmt = db.prepare('SELECT item_id, item_type FROM favorites WHERE user_id = ?');
    stmt.bind([userId]);

    const files = [];
    const folders = [];

    while (stmt.step()) {
        const row = stmt.getAsObject();
        if (row.item_type === 'file') {
            files.push(row.item_id);
        } else if (row.item_type === 'folder') {
            folders.push(row.item_id);
        }
    }
    stmt.free();

    return { files, folders };
}

/**
 * Query favorite files for a user
 */
function queryFavoriteFiles(userId, options = {}) {
    const { offset = 0, limit = 500 } = options;

    const query = `
        SELECT f.* FROM files f
        INNER JOIN favorites fav ON f.path = fav.item_id
        WHERE fav.user_id = ? AND fav.item_type = 'file'
        ORDER BY f.last_modified DESC
        LIMIT ? OFFSET ?
    `;

    const stmt = db.prepare(query);
    stmt.bind([userId, limit, offset]);

    const results = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: row.id,
            path: row.path,
            name: row.name,
            folderPath: row.folder_path,
            size: row.size,
            type: row.type,
            mediaType: row.media_type,
            lastModified: row.last_modified,
            sourceId: row.source_id
        });
    }
    stmt.free();

    return results;
}

/**
 * Count favorite files for a user
 */
function countFavoriteFiles(userId) {
    const stmt = db.prepare(`
        SELECT COUNT(*) as count FROM favorites
        WHERE user_id = ? AND item_type = 'file'
    `);
    stmt.bind([userId]);
    stmt.step();
    const result = stmt.getAsObject();
    stmt.free();

    return result.count || 0;
}


/**
 * Get all file paths (for sync)
 */
function getAllFilePaths() {
    const stmt = db.prepare('SELECT path FROM files');
    const paths = [];
    while (stmt.step()) {
        paths.push(stmt.getAsObject().path);
    }
    stmt.free();
    return paths;
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
    getFileByPath,
    clearAllFiles,
    getStats,
    closeDatabase,
    toggleFavorite,
    getFavoriteIds,
    queryFavoriteFiles,
    countFavoriteFiles,
    getAllFilePaths
};
