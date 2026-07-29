const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { createDatabaseBatchOperations } = require('./lib/database-batch-operations');

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
    
    // Force-recreate FTS5 triggers to prevent stale/corrupted trigger definitions
    // from causing SQL logic errors on INSERT/UPDATE/DELETE
    recreateFTS5Triggers();

    // 清理历史遗留的孤立 FTS 条目（files_fts 中存在但 files 表中已删除的 rowid）
    repairOrphanedFTS();
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
            DELETE FROM files_fts WHERE rowid = old.rowid;
        END;
        CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
            DELETE FROM files_fts WHERE rowid = old.rowid;
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
                DELETE FROM files_fts WHERE rowid = old.rowid;
            END;
            CREATE TRIGGER IF NOT EXISTS files_fts_au AFTER UPDATE ON files BEGIN
                DELETE FROM files_fts WHERE rowid = old.rowid;
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
 * Force-recreate FTS5 triggers to ensure correct syntax (single-quoted 'delete')
 * This prevents SQL logic errors caused by corrupted trigger definitions
 * (e.g. double-quoted "delete" which SQLite interprets as a column name)
 */
function recreateFTS5Triggers() {
    console.log('[Init] Force-recreating FTS5 triggers...');
    try {
        db.exec('DROP TRIGGER IF EXISTS files_fts_ai');
        db.exec('DROP TRIGGER IF EXISTS files_fts_ad');
        db.exec('DROP TRIGGER IF EXISTS files_fts_au');
        db.exec(`
            CREATE TRIGGER files_fts_ai AFTER INSERT ON files BEGIN
                INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
            END;
            CREATE TRIGGER files_fts_ad AFTER DELETE ON files BEGIN
                DELETE FROM files_fts WHERE rowid = old.rowid;
            END;
            CREATE TRIGGER files_fts_au AFTER UPDATE ON files BEGIN
                DELETE FROM files_fts WHERE rowid = old.rowid;
                INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
            END;
        `);
        console.log('[Init] FTS5 triggers recreated successfully');
    } catch (err) {
        console.error('[Init] Failed to recreate FTS5 triggers:', err.message);
    }
}

/**
 * 清理孤立的 FTS5 条目（files_fts 中存在但 files 表中已删除的 rowid）
 * 修复因缺少 files_fts_ad 触发器或 FTS 清理失败导致的历史残留问题
 */
function repairOrphanedFTS() {
    console.log('[Repair] Checking for orphaned FTS entries...');
    try {
        const result = db.prepare(
            'DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)'
        ).run();
        if (result.changes > 0) {
            console.log(`[Repair] Cleaned ${result.changes} orphaned FTS entries`);
        } else {
            console.log('[Repair] No orphaned FTS entries found');
        }
    } catch (err) {
        console.error('[Repair] Failed to clean orphaned FTS entries:', err.message);
    }
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
            id = excluded.id,
            name = excluded.name,
            folder_path = excluded.folder_path,
            size = excluded.size,
            type = excluded.type,
            media_type = excluded.media_type,
            last_modified = excluded.last_modified,
            source_id = excluded.source_id,
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
function insertFilesBatch(files, shouldSave = false) {
    try {
        const insertTx = db.transaction((filesList) => {
            for (const file of filesList) upsertFile(file);
        });
        insertTx(files);
        if (shouldSave) saveDatabase();
        return true;
    } catch (error) {
        console.error('Batch insert failed:', error);
        return false;
    }
}

/**
 * Query files with pagination
 */
function buildFtsQuery(search) {
    if (search === null || search === undefined) return null;

    const terms = String(search).trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return null;

    return terms
        .map(term => `"${term.replace(/"/g, '""')}"`)
        .join(' ');
}

function escapeLikePattern(value) {
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}

function buildDescendantPattern(value) {
    const escaped = escapeLikePattern(value);
    const withoutTrailingSlash = escaped.replace(/\/+$/, '');
    return withoutTrailingSlash ? `${withoutTrailingSlash}/%` : '/%';
}

function mapFileRow(row) {
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
        isFavorite: !!row.is_fav,
        thumb_width: row.thumb_width,
        thumb_height: row.thumb_height,
        thumb_aspect_ratio: row.thumb_aspect_ratio
    };
}

function incrementLastCodeUnit(value) {
    const lastIndex = value.length - 1;
    return `${value.slice(0, lastIndex)}${String.fromCharCode(value.charCodeAt(lastIndex) + 1)}`;
}

function buildFileQueryParts(options = {}) {
    const {
        folderPath = null,
        recursive = false,
        alternativeFolderPath = null,
        allowedPaths = null,
        search = null,
        mediaType = null,
        excludeMediaType = null,
        favoritesOnly = false,
        userId = null,
        sourceId = null
    } = options;

    const joins = [];
    const conditions = [];
    const params = [];
    const ftsQuery = buildFtsQuery(search);

    if (ftsQuery) {
        joins.push('JOIN files_fts fts ON f.rowid = fts.rowid');
    }

    if (favoritesOnly) {
        joins.push("INNER JOIN favorites fav ON (fav.item_id = f.id OR fav.item_id = f.path) AND fav.user_id = ? AND fav.item_type = 'file'");
        params.push(userId);
    } else if (userId !== null && userId !== undefined) {
        joins.push("LEFT JOIN favorites fav ON (fav.item_id = f.id OR fav.item_id = f.path) AND fav.user_id = ? AND fav.item_type = 'file'");
        params.push(userId);
    } else {
        joins.push('LEFT JOIN favorites fav ON 1=0');
    }

    if (ftsQuery) {
        conditions.push('fts.files_fts MATCH ?');
        params.push(ftsQuery);
    }

    if (folderPath !== null) {
        const folderPaths = [folderPath];
        if (alternativeFolderPath !== null) {
            folderPaths.push(alternativeFolderPath);
        }

        if (recursive) {
            const clauses = folderPaths.map(() => "(f.folder_path = ? OR f.folder_path LIKE ? ESCAPE '\\')").join(' OR ');
            conditions.push(`(${clauses})`);
            folderPaths.forEach(folder => {
                params.push(folder, buildDescendantPattern(folder));
            });
        } else {
            const clauses = folderPaths.map(() => 'f.folder_path = ?').join(' OR ');
            conditions.push(`(${clauses})`);
            params.push(...folderPaths);
        }
    }

    if (mediaType !== null && mediaType !== undefined) {
        const mediaTypes = Array.isArray(mediaType) ? mediaType : [mediaType];
        if (mediaTypes.length === 0) {
            conditions.push('1=0');
        } else {
            const placeholders = mediaTypes.map(() => '?').join(',');
            conditions.push(`f.media_type IN (${placeholders})`);
            params.push(...mediaTypes);
        }
    }

    if (excludeMediaType !== null && excludeMediaType !== undefined) {
        const excludedMediaTypes = Array.isArray(excludeMediaType) ? excludeMediaType : [excludeMediaType];
        if (excludedMediaTypes.length > 0) {
            const placeholders = excludedMediaTypes.map(() => '?').join(',');
            conditions.push(`f.media_type NOT IN (${placeholders})`);
            params.push(...excludedMediaTypes);
        }
    }

    if (sourceId !== null && sourceId !== undefined) {
        conditions.push('f.source_id = ?');
        params.push(sourceId);
    }

    if (allowedPaths !== null) {
        if (allowedPaths.length === 0) {
            conditions.push('1=0');
        } else {
            const clauses = allowedPaths.map(() => (
                "(f.path = ? OR f.path LIKE ? ESCAPE '\\' OR f.folder_path = ? OR f.folder_path LIKE ? ESCAPE '\\')"
            )).join(' OR ');
            conditions.push(`(${clauses})`);
            allowedPaths.forEach(allowedPath => {
                const descendantPattern = buildDescendantPattern(allowedPath);
                params.push(allowedPath, descendantPattern, allowedPath, descendantPattern);
            });
        }
    }

    return {
        joins: joins.join(' '),
        where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
        params
    };
}

function queryFiles(options = {}) {
    const {
        offset = 0,
        limit = 500,
        random = false,
        sortOption = 'dateDesc'
    } = options;
    const queryParts = buildFileQueryParts(options);
    let query = `SELECT DISTINCT f.*, CASE WHEN fav.id IS NULL THEN 0 ELSE 1 END AS is_fav
        FROM files f ${queryParts.joins} ${queryParts.where}`;

    if (random) {
        query += ' ORDER BY RANDOM(), f.id ASC LIMIT ? OFFSET ?';
    } else {
        switch (sortOption) {
            case 'dateAsc': query += ' ORDER BY f.last_modified ASC, f.id ASC LIMIT ? OFFSET ?'; break;
            case 'nameAsc': query += ' ORDER BY f.name COLLATE NOCASE ASC, f.id ASC LIMIT ? OFFSET ?'; break;
            case 'nameDesc': query += ' ORDER BY f.name COLLATE NOCASE DESC, f.id ASC LIMIT ? OFFSET ?'; break;
            case 'dateDesc':
            default: query += ' ORDER BY f.last_modified DESC, f.id ASC LIMIT ? OFFSET ?';
        }
    }

    const params = [...queryParts.params, limit, offset];

    const stmt = db.prepare(query);
    const results = stmt.all(...params);

    return results.map(mapFileRow);
}

/**
 * 为目录列表批量获取封面媒体，每个目录只执行一次索引范围查询。
 */
function queryFolderCovers(folderPaths) {
    if (!Array.isArray(folderPaths) || folderPaths.length === 0) return new Map();

    const originalKeysByNormalizedPath = new Map();
    for (const folderPath of folderPaths) {
        if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) continue;

        const normalizedFolderPath = path.resolve(folderPath);
        if (!originalKeysByNormalizedPath.has(normalizedFolderPath)) {
            originalKeysByNormalizedPath.set(normalizedFolderPath, new Set());
        }
        originalKeysByNormalizedPath.get(normalizedFolderPath).add(folderPath);
    }
    if (originalKeysByNormalizedPath.size === 0) return new Map();

    const statement = db.prepare(`
        SELECT f.*
        FROM files f INDEXED BY idx_folder_path
        WHERE (
            f.folder_path = ?
            OR (f.folder_path >= ? AND f.folder_path < ?)
        )
        AND f.media_type IN ('image', 'video')
        ORDER BY f.last_modified DESC, f.id ASC
        LIMIT 1
    `);
    const covers = new Map();

    for (const [normalizedFolderPath, originalKeys] of originalKeysByNormalizedPath) {
        const descendantStart = normalizedFolderPath.endsWith(path.sep)
            ? normalizedFolderPath
            : `${normalizedFolderPath}${path.sep}`;
        const row = statement.get(
            normalizedFolderPath,
            descendantStart,
            incrementLastCodeUnit(descendantStart)
        );
        if (row) {
            const cover = mapFileRow(row);
            for (const originalKey of originalKeys) {
                covers.set(originalKey, cover);
            }
        }
    }

    return covers;
}

/**
 * 使用文件 FTS 索引查询目录路径，不依赖 folders 缓存表。
 */
function queryFolderPaths(options = {}) {
    const {
        parentPath = null,
        allowedPaths = null,
        search = null,
        limit = 100
    } = options;
    const ftsQuery = buildFtsQuery(search);
    if (!ftsQuery) return [];

    const boundedLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
    if (allowedPaths !== null && allowedPaths.length === 0) return [];

    const conditions = ['files_fts MATCH ?'];
    const params = [`{folder_path} : (${ftsQuery})`];
    const normalizedParent = parentPath === null ? null : path.resolve(parentPath);

    if (normalizedParent !== null) {
        conditions.push("(f.folder_path = ? OR f.folder_path LIKE ? ESCAPE '\\')");
        params.push(normalizedParent, buildDescendantPattern(normalizedParent));
    }

    if (allowedPaths !== null) {
        const clauses = allowedPaths.map(() => (
            "(f.folder_path = ? OR f.folder_path LIKE ? ESCAPE '\\')"
        )).join(' OR ');
        conditions.push(`(${clauses})`);
        allowedPaths.forEach(allowedPath => {
            const normalizedAllowedPath = path.resolve(allowedPath);
            params.push(normalizedAllowedPath, buildDescendantPattern(normalizedAllowedPath));
        });
    }

    const rows = db.prepare(`
        SELECT DISTINCT f.folder_path
        FROM files f
        JOIN files_fts ON f.rowid = files_fts.rowid
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.folder_path COLLATE NOCASE ASC
        LIMIT ?
    `).all(...params, boundedLimit);

    const queryTerms = String(search)
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const isWithin = (candidate, root) => {
        const relative = path.relative(path.resolve(root), path.resolve(candidate));
        return relative === '' ||
            (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
    };
    const isInScope = candidate => {
        if (normalizedParent !== null && (
            path.resolve(candidate) === normalizedParent ||
            !isWithin(candidate, normalizedParent)
        )) {
            return false;
        }
        return allowedPaths === null || allowedPaths.some(allowedPath => isWithin(candidate, allowedPath));
    };

    const matches = new Set();
    for (const row of rows) {
        let candidate = path.resolve(row.folder_path);
        const root = path.parse(candidate).root;

        while (candidate && candidate !== root) {
            const folderName = path.basename(candidate).toLocaleLowerCase();
            if (
                queryTerms.every(term => folderName.includes(term.toLocaleLowerCase())) &&
                isInScope(candidate)
            ) {
                matches.add(candidate);
                if (matches.size >= boundedLimit) break;
            }

            const parent = path.dirname(candidate);
            if (parent === candidate) break;
            candidate = parent;
        }

        if (matches.size >= boundedLimit) break;
    }

    return Array.from(matches)
        .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }))
        .slice(0, boundedLimit);
}

/**
 * Count total files
 */
function countFiles(options = {}) {
    const queryParts = buildFileQueryParts(options);
    const query = `SELECT COUNT(DISTINCT f.id) as count
        FROM files f ${queryParts.joins} ${queryParts.where}`;
    const stmt = db.prepare(query);
    const result = stmt.get(...queryParts.params);
    return result.count || 0;
}

/**
 * Delete file by path or ID
 */
function deleteFile(filePath, id = null) {
    // Sync FTS
    try {
        if (id) {
            db.prepare('DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE id = ?)').run(id);
        } else {
            db.prepare('DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE path = ?)').run(filePath);
        }
    } catch (e) {
        console.error('FTS sync delete failed in deleteFile:', e);
    }

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
    return createDatabaseBatchOperations(db).deleteFilesBatch(files);
}

function getFilesMtimeByPaths(paths) {
    return createDatabaseBatchOperations(db).getFilesMtimeByPaths(paths);
}

function getFilesAfterRowid(afterRowid = 0, limit = 256) {
    return createDatabaseBatchOperations(db).getFilesAfterRowid(afterRowid, limit);
}

function deleteFilesByFolder(folderPath) {
    try {
        db.prepare('DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE folder_path = ? OR folder_path LIKE ?)').run(folderPath, folderPath + '/%');
    } catch (e) { }
    db.prepare('DELETE FROM files WHERE folder_path = ? OR folder_path LIKE ?').run(folderPath, folderPath + '/%');
}

function deleteFilesBySourceId(sourceId) {
    try {
        db.prepare('DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE source_id = ?)').run(sourceId);
    } catch (e) { }
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
    try {
        db.prepare('DELETE FROM files_fts').run();
    } catch (e) { }
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
    queryFolderCovers,
    queryFolderPaths,
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
    deleteFilesBatch,
    getFilesAfterRowid,
    getFilesMtimeByPaths,
    renameFile,
    clearThumbnails,
    migrateFavorites,
    repairOrphanedFTS
};
