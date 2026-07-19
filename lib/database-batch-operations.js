function createDatabaseBatchOperations(db, logger = console) {
    function deleteFilesBatch(files) {
        try {
            const ftsStmt = db.prepare('DELETE FROM files_fts WHERE rowid IN (SELECT rowid FROM files WHERE id = ?)');
            const fileStmt = db.prepare('DELETE FROM files WHERE id = ?');
            const favoriteStmt = db.prepare('DELETE FROM favorites WHERE item_id = ?');
            const transaction = db.transaction((items) => {
                for (const file of items) {
                    ftsStmt.run(file.id);
                    fileStmt.run(file.id);
                    favoriteStmt.run(file.id);
                }
            });
            transaction(files);
            return true;
        } catch (error) {
            logger.error('Batch delete failed:', error);
            return false;
        }
    }

    function getFilesMtimeByPaths(paths) {
        const uniquePaths = [...new Set(paths)];
        const maxPaths = 512;
        if (uniquePaths.length > maxPaths) {
            throw new RangeError(`最多查询 ${maxPaths} 个路径的修改时间`);
        }
        if (uniquePaths.length === 0) return new Map();

        const placeholders = uniquePaths.map(() => '?').join(', ');
        const rows = db.prepare(
            `SELECT path, last_modified FROM files WHERE path IN (${placeholders})`
        ).all(...uniquePaths);
        return new Map(rows.map(row => [row.path, row.last_modified]));
    }

    function getFilesAfterRowid(afterRowid = 0, limit = 256) {
        const batchLimit = Math.min(1000, Math.max(1, Number(limit) || 256));
        return db.prepare(
            'SELECT rowid, id, path, last_modified FROM files WHERE rowid > ? ORDER BY rowid LIMIT ?'
        ).all(afterRowid, batchLimit);
    }

    return {
        deleteFilesBatch,
        getFilesAfterRowid,
        getFilesMtimeByPaths
    };
}

module.exports = { createDatabaseBatchOperations };
