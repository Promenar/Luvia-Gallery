
import * as SQLite from 'expo-sqlite';
import { MediaItem } from '../types';
import * as FileSystem from 'expo-file-system';

// @ts-ignore
const { Paths, File, Directory } = FileSystem;

const db = SQLite.openDatabaseSync('lumina.db');

export const initDatabase = () => {
    try {
        db.execSync(`
      CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        value TEXT
      );
    `);
    } catch (e) {
        console.error('[Database] Initialization failed:', e);
    }
};

// Initialize immediately
initDatabase();

export const saveMediaItem = (item: MediaItem) => {
    db.runSync('INSERT OR REPLACE INTO media_items (id, value) VALUES (?, ?)', [item.id, JSON.stringify(item)]);
};

export const saveMediaItems = (items: MediaItem[], limit?: number) => {
    db.withTransactionSync(() => {
        const toSave = limit ? items.slice(0, limit) : items;
        for (const item of toSave) {
            db.runSync('INSERT OR REPLACE INTO media_items (id, value) VALUES (?, ?)', [item.id, JSON.stringify(item)]);
        }
    });
};

export const getMediaItem = (id: string): MediaItem | null => {
    const result = db.getAllSync('SELECT value FROM media_items WHERE id = ?', [id]);
    if (result.length > 0) {
        // @ts-ignore
        return JSON.parse(result[0].value);
    }
    return null;
};

export const deleteMediaItem = (id: string) => {
    db.runSync('DELETE FROM media_items WHERE id = ?', [id]);
};

export const updateFavoriteStatus = (id: string, favorite: boolean) => {
    const item = getMediaItem(id);
    if (item) {
        item.favorite = favorite;
        saveMediaItem(item);
    }
};

// @ts-ignore
export const getCachedFiles = async ({ limit = 10, folderPath, favorite }: { limit?: number; folderPath?: string; favorite?: boolean } = {}): Promise<MediaItem[]> => {
    // Return items from SQLite
    try {
        let query = 'SELECT value FROM media_items';
        let params: any[] = [];
        let where: string[] = [];

        if (folderPath) {
            where.push('JSON_EXTRACT(value, "$.path") LIKE ?');
            params.push(`${folderPath}%`);
        }
        if (favorite !== undefined) {
            where.push('JSON_EXTRACT(value, "$.favorite") = ?');
            params.push(favorite ? 1 : 0);
        }

        if (where.length > 0) {
            query += ' WHERE ' + where.join(' AND ');
        }
        query += ' ORDER BY JSON_EXTRACT(value, "$.dateModified") DESC LIMIT ?';
        params.push(limit);

        const rows = db.getAllSync(query, params);
        // @ts-ignore
        return rows.map(row => JSON.parse(row.value));
    } catch (e) {
        return [];
    }
};

export const deleteFileFromCache = async (filename: string) => {
    try {
        if (!Paths || !File) return;
        const cacheDir = Paths.cache;
        const file = new File(cacheDir + '/' + filename);
        if (file.exists) {
            file.delete();
        }
    } catch (e) {
        console.error("Error deleting file from cache", e);
    }
};

export const deleteFolderFromCache = async (foldername: string) => {
    try {
        if (!Paths || !Directory) return;
        const cacheDir = Paths.cache;
        const dir = new Directory(cacheDir + '/' + foldername);
        if (dir.exists) {
            dir.delete();
        }
    } catch (e) {
        console.error("Error deleting folder from cache", e);
    }
};

export const clearStaticCache = async () => {
    db.runSync('DELETE FROM media_items');
};

// Recursive function to calculate size
const calculateFolderSize = async (uriOrObject: any, depth = 0): Promise<number> => {
    if (depth > 5) return 0; // Prevent infinite recursion
    let size = 0;
    try {
        if (!Directory || !File) return 0;

        let target;
        if (typeof uriOrObject === 'string') {
            // @ts-ignore
            const dir = new Directory(uriOrObject);
            // @ts-ignore
            target = dir.exists ? dir : new File(uriOrObject);
        } else {
            target = uriOrObject;
        }

        // @ts-ignore
        if (target instanceof Directory) {
            // @ts-ignore
            if (!target.exists) return 0;
            // @ts-ignore
            const items = target.list();
            for (const item of items) {
                size += await calculateFolderSize(item, depth + 1);
            }
            // @ts-ignore
        } else if (target instanceof File) {
            // @ts-ignore
            if (target.exists) {
                // @ts-ignore
                size += (target.size ?? 0);
            }
        }
    } catch (e) {
        // console.log("Error sizing", e);
    }
    return size;
};

export const getCacheSize = async (): Promise<number> => {
    let totalSize = 0;

    try {
        if (!Paths || !File) return 0;

        // 1. SQLite DB Size
        if (Paths.document) {
            // @ts-ignore
            const dbPath = Paths.document.uri + '/SQLite/lumina.db';
            // @ts-ignore
            const dbFile = new File(dbPath);
            // @ts-ignore
            if (dbFile.exists) {
                // @ts-ignore
                totalSize += (dbFile.size ?? 0);
            }
        }

        // 2. Image Cache Size
        if (Paths.cache) {
            totalSize += await calculateFolderSize(Paths.cache);
        }
    } catch (e) {
        console.error("Error getting cache size", e);
    }
    return totalSize;
};
