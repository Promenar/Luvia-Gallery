import * as SQLite from 'expo-sqlite';
import { MediaItem } from '../types';

let db: SQLite.SQLiteDatabase | null = null;

export const initDatabase = async () => {
    if (db) return db;

    db = await SQLite.openDatabaseAsync('lumina_cache.db');

    // Create Table
    await db.execAsync(`
        CREATE TABLE IF NOT EXISTS media_items (
            id TEXT PRIMARY KEY,
            name TEXT,
            path TEXT,
            mediaType TEXT,
            size INTEGER,
            lastModified INTEGER,
            isFavorite INTEGER,
            parentPath TEXT,
            thumbnailUrl TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_parent ON media_items(parentPath);
        CREATE INDEX IF NOT EXISTS idx_favorite ON media_items(isFavorite);
    `);

    return db;
};

export const saveMediaItems = async (items: MediaItem[], parentPath: string | null) => {
    const database = await initDatabase();

    // Start transaction for speed
    await database.withTransactionAsync(async () => {
        for (const item of items) {
            await database.runAsync(
                `INSERT OR REPLACE INTO media_items (id, name, path, mediaType, size, lastModified, isFavorite, parentPath, thumbnailUrl) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    item.id,
                    item.name,
                    item.path,
                    item.mediaType,
                    item.size,
                    item.lastModified,
                    item.isFavorite ? 1 : 0,
                    parentPath || 'root',
                    item.thumbnailUrl || ''
                ]
            );
        }
    });
};

export const getCachedFiles = async (options: {
    folderPath?: string,
    favorite?: boolean,
    limit?: number,
    offset?: number
}) => {
    const database = await initDatabase();
    const { folderPath, favorite, limit = 50, offset = 0 } = options;

    let query = `SELECT * FROM media_items WHERE 1=1`;
    const params: any[] = [];

    if (folderPath) {
        query += ` AND parentPath = ?`;
        params.push(folderPath);
    }

    if (favorite) {
        query += ` AND isFavorite = 1`;
    }

    query += ` ORDER BY lastModified DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await database.getAllAsync<any>(query, params);

    return rows.map(row => ({
        ...row,
        isFavorite: row.isFavorite === 1
    })) as MediaItem[];
};

export const updateFavoriteStatus = async (id: string, isFavorite: boolean) => {
    const database = await initDatabase();
    await database.runAsync(
        `UPDATE media_items SET isFavorite = ? WHERE id = ?`,
        [isFavorite ? 1 : 0, id]
    );
};

export const deleteFileFromCache = async (id: string) => {
    const database = await initDatabase();
    const result = await database.runAsync(`DELETE FROM media_items WHERE id = ?`, [id]);
    console.log(`[Cache] Deleted file ${id}. Changes:`, result.changes);
};

export const deleteFolderFromCache = async (folderPath: string) => {
    const database = await initDatabase();
    // Delete the folder itself from logic (though usually folderFiles is what we care about)
    // and all files inside it
    await database.runAsync(`DELETE FROM media_items WHERE parentPath = ? OR parentPath LIKE ?`, [folderPath, `${folderPath}/%`]);
};

export const clearStaticCache = async () => {
    const database = await initDatabase();
    await database.runAsync(`DELETE FROM media_items`);
};
