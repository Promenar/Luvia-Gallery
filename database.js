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

    // Migration
    migrateFavorites();
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
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            thumb_width INTEGER,
            thumb_height INTEGER,
            thumb_aspect_ratio REAL
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
        return;
    }

    // Migration: Add thumbnail dimension columns if they don't exist
    try {
        const tableInfo = db.exec("PRAGMA table_info(files)");
        const columns = tableInfo.length > 0 ? tableInfo[0].values.map(row => row[1]) : [];

        if (!columns.includes('thumb_width')) {
            console.log('[Migration] Adding thumb_width column to files table');
            db.run('ALTER TABLE files ADD COLUMN thumb_width INTEGER');
        }

        if (!columns.includes('thumb_height')) {
            console.log('[Migration] Adding thumb_height column to files table');
            db.run('ALTER TABLE files ADD COLUMN thumb_height INTEGER');
        }

        if (!columns.includes('thumb_aspect_ratio')) {
            console.log('[Migration] Adding thumb_aspect_ratio column to files table');
            db.run('ALTER TABLE files ADD COLUMN thumb_aspect_ratio REAL');
        }

        saveDatabase();
    } catch (error) {
        console.error('[Migration] Failed to add thumbnail dimension columns:', error);
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

    stmt.run([
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
    ]);

    stmt.free();
}

/**
 * Insert files in batch (transaction)
 */
function insertFilesBatch(files, shouldSave = true) {
    db.run('BEGIN TRANSACTION');

    try {
        for (const file of files) {
            upsertFile(file);
        }
        db.run('COMMIT');
        if (shouldSave) {
            saveDatabase();
        }
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
        mediaType = null, // Can be string or array
        sourceId = null,
        userId = null,
        random = false,
        excludeMediaType = null,
        allowedPaths = null // [NEW] Array of root paths the user is allowed to access
    } = options;

    let query = 'SELECT f.*, fav.id as is_fav FROM files f';

    if (userId) {
        query += ' LEFT JOIN favorites fav ON f.id = fav.item_id AND fav.user_id = ?';
    } else {
        query += ' LEFT JOIN favorites fav ON 1=0'; // Dummy join if no user
    }

    query += ' WHERE 1=1';
    const params = [];
    if (userId) params.push(userId);

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
            // Build OR clauses for each allowed root path (using standard SQL quotes for string building)
            const clauses = allowedPaths.map(() => '(f.path = ? OR f.path LIKE ? || "/%" OR f.folder_path = ? OR f.folder_path LIKE ? || "/%")').join(' OR ');
            query += ` AND (${clauses})`;
            allowedPaths.forEach(p => params.push(p, p, p, p));
        } else {
            // Explicitly allowed paths is empty -> Deny all
            query += ' AND 1=0';
        }
    }

    if (random) {
        query += ' ORDER BY RANDOM() LIMIT ? OFFSET ?';
    } else {
        query += ' ORDER BY f.last_modified DESC LIMIT ? OFFSET ?';
    }

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
            sourceId: row.source_id,
            isFavorite: !!row.is_fav,
            thumb_width: row.thumb_width,
            thumb_height: row.thumb_height,
            thumb_aspect_ratio: row.thumb_aspect_ratio
        });
    }
    stmt.free();

    return results;
}

/**
 * Count total files
 */
function countFiles(options = {}) {
    const { folderPath = null, mediaType = null, recursive = false, allowedPaths = null } = options;

    let query = 'SELECT COUNT(*) as count FROM files WHERE 1=1';
    const params = [];

    if (folderPath !== null) {
        if (recursive) {
            query += ' AND (folder_path = ? OR folder_path LIKE ?)';
            params.push(folderPath, folderPath + '/%');
        } else {
            query += ' AND folder_path = ?';
            params.push(folderPath);
        }
    }

    if (mediaType) {
        query += ' AND media_type = ?';
        params.push(mediaType);
    }

    if (allowedPaths !== null) {
        if (allowedPaths.length > 0) {
            const clauses = allowedPaths.map(() => '(path = ? OR path LIKE ? || "/%" OR folder_path = ? OR folder_path LIKE ? || "/%")').join(' OR ');
            query += ` AND (${clauses})`;
            allowedPaths.forEach(p => params.push(p, p, p, p));
        } else {
            query += ' AND 1=0';
        }
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
    // Note: Single file usage usually implies manual action, so saving immediately is tolerable,
    // but for bulk, use deleteFilesBatch. 
    // Ideally we shouldn't save on every delete even for single, but to keep existing behavior for now:
    // We will REMOVE saveDatabase() here and let caller handle it, or add a debounce?
    // User interaction "Delete" should save.
    // I will add a `shouldSave` param defaulting to true.
}

/**
 * Batch delete files
 */
function deleteFilesBatch(files, shouldSave = true) {
    db.run('BEGIN TRANSACTION');
    try {
        const stmt = db.prepare('DELETE FROM files WHERE id = ?');
        const favStmt = db.prepare('DELETE FROM favorites WHERE item_id = ?');

        for (const file of files) {
            stmt.run([file.id]);
            favStmt.run([file.id]);
        }

        stmt.free();
        favStmt.free();

        db.run('COMMIT');
        if (shouldSave) saveDatabase();
        return true;
    } catch (e) {
        db.run('ROLLBACK');
        console.error('Batch delete failed:', e);
        return false;
    }
}

/**
 * Get all file paths and their last modified times for incremental scan
 * Returns a Map<path, lastModified>
 */
function getAllFilesMtime() {
    const stmt = db.prepare('SELECT path, last_modified FROM files');
    const mtimeMap = new Map();

    while (stmt.step()) {
        const row = stmt.getAsObject();
        mtimeMap.set(row.path, row.last_modified);
    }
    stmt.free();
    return mtimeMap;
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
            sourceId: row.source_id,
            thumb_width: row.thumb_width,
            thumb_height: row.thumb_height,
            thumb_aspect_ratio: row.thumb_aspect_ratio
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
 * Migration: Convert legacy Path-based favorites to ID-based favorites
 */
function migrateFavorites() {
    try {
        console.log('[Migration] Checking for legacy path-based favorites...');
        // 1. Try to resolve favorites where item_id matches a file path
        db.exec(`
            UPDATE favorites 
            SET item_id = (SELECT id FROM files WHERE path = favorites.item_id) 
            WHERE item_type = 'file' 
            AND item_id NOT IN (SELECT id FROM files) 
            AND item_id IN (SELECT path FROM files);
        `);

        console.log('[Migration] Favorites migration complete.');
        saveDatabase();
    } catch (e) {
        console.error('[Migration] Error migrating favorites:', e);
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
        SELECT f.*
        FROM favorites fav
        JOIN files f ON (f.id = fav.item_id OR f.path = fav.item_id)
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
            sourceId: row.source_id,
            thumb_width: row.thumb_width,
            thumb_height: row.thumb_height,
            thumb_aspect_ratio: row.thumb_aspect_ratio
        });
    }
    stmt.free();

    return results;
}

/**
 * Count favorite files for a user
 */
function countFavoriteFiles(userId) {
    const query = `SELECT COUNT(*) as count FROM favorites fav JOIN files f ON (f.id = fav.item_id OR f.path = fav.item_id) WHERE fav.user_id = ? AND fav.item_type = 'file'`;
    const stmt = db.prepare(query);
    stmt.bind([userId]);
    stmt.step();
    const result = stmt.getAsObject();
    stmt.free();

    return result.count || 0;
}

/**
 * Rename file and update ID/references
 */
function renameFile(oldPath, newPath, newName) {
    const oldId = Buffer.from(oldPath).toString('base64');
    const newId = Buffer.from(newPath).toString('base64');
    const folderPath = path.dirname(newPath);

    db.run('BEGIN TRANSACTION');
    try {
        // 1. Files table
        // We delete old and insert new, OR update.
        // If we update, we must update ID.
        // SQLite allows updating PK if cascades are set, but here we do manually.
        const file = getFileByPath(oldPath);
        if (file) {
            // Delete old
            db.prepare('DELETE FROM files WHERE id = ?').run([oldId]);

            // Insert new (copy props)
            const stmt = db.prepare(`
                INSERT INTO files (id, path, name, folder_path, size, type, media_type, last_modified, source_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run([
                newId,
                newPath,
                newName,
                folderPath,
                file.size,
                file.type,
                file.mediaType,
                Date.now(), // Update modified time or keep old? Usually rename updates mtime on disk? 
                // fs.rename updates ctime, not mtime usually. Let's keep old or use Date.now().
                file.sourceId
            ]);
            stmt.free();

            // 2. Favorites
            db.prepare('UPDATE favorites SET item_id = ? WHERE item_id = ?').run([newId, oldId]);

            // 3. Thumbnails
            db.prepare('UPDATE thumbnails SET file_id = ? WHERE file_id = ?').run([newId, oldId]);
        }

        db.run('COMMIT');
        return true;
    } catch (e) {
        db.run('ROLLBACK');
        console.error("Rename DB error:", e);
        return false;
    }
}

/**
 * Clear thumbnails table
 */
function clearThumbnails() {
    db.run('DELETE FROM thumbnails');
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
    getAllFilePaths,
    deleteFilesBatch,
    getAllFilesMtime,
    renameFile,      // NEW
    clearThumbnails, // NEW
    migrateFavorites // NEW
};
