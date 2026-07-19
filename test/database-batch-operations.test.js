const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createDatabaseBatchOperations } = require('../lib/database-batch-operations');
const { reconcileScannedFiles } = require('../lib/background-file-walker');

function createTestDatabase() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE files (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            last_modified INTEGER NOT NULL
        );
        CREATE VIRTUAL TABLE files_fts USING fts5(name);
        CREATE TABLE favorites (
            item_id TEXT NOT NULL
        );
    `);
    const insertFile = db.prepare('INSERT INTO files(id, path, last_modified) VALUES (?, ?, ?)');
    const insertFts = db.prepare('INSERT INTO files_fts(rowid, name) VALUES ((SELECT rowid FROM files WHERE id = ?), ?)');
    const insertFavorite = db.prepare('INSERT INTO favorites(item_id) VALUES (?)');
    for (let index = 1; index <= 5; index++) {
        const id = `id-${index}`;
        insertFile.run(id, `/media/${index}.jpg`, index);
        insertFts.run(id, `${index}.jpg`);
        insertFavorite.run(id);
    }
    return db;
}

test('rowid 游标在批次删除后继续前进，不漏读后续记录', () => {
    const db = createTestDatabase();
    try {
        const operations = createDatabaseBatchOperations(db);
        const first = operations.getFilesAfterRowid(0, 2);
        assert.deepEqual(first.map(row => row.id), ['id-1', 'id-2']);
        assert.equal(operations.deleteFilesBatch([first[0]]), true);

        const second = operations.getFilesAfterRowid(first[1].rowid, 2);
        assert.deepEqual(second.map(row => row.id), ['id-3', 'id-4']);
    } finally {
        db.close();
    }
});

test('真实清理流程只删除未扫描记录及其收藏', async () => {
    const db = createTestDatabase();
    try {
        const operations = createDatabaseBatchOperations(db);
        const result = await reconcileScannedFiles({
            database: operations,
            scannedPaths: new Set(['/media/1.jpg', '/media/3.jpg', '/media/5.jpg']),
            scanIncomplete: false,
            shouldStop: () => false,
            batchSize: 2
        });

        assert.equal(result.deletedCount, 2);
        assert.deepEqual(
            db.prepare('SELECT id FROM files ORDER BY id').all().map(row => row.id),
            ['id-1', 'id-3', 'id-5']
        );
        assert.deepEqual(
            db.prepare('SELECT item_id FROM favorites ORDER BY item_id').all().map(row => row.item_id),
            ['id-1', 'id-3', 'id-5']
        );
    } finally {
        db.close();
    }
});

test('FTS 删除失败会回滚文件和收藏删除，并向清理流程返回失败', async () => {
    const db = createTestDatabase();
    try {
        const operations = createDatabaseBatchOperations(db);
        db.exec('DROP TABLE files_fts');

        const result = await reconcileScannedFiles({
            database: operations,
            scannedPaths: new Set(['/media/2.jpg', '/media/3.jpg', '/media/4.jpg', '/media/5.jpg']),
            scanIncomplete: false,
            shouldStop: () => false,
            batchSize: 2
        });

        assert.equal(result.incomplete, true);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM files WHERE id = 'id-1'").get().count, 1);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM favorites WHERE item_id = 'id-1'").get().count, 1);
    } finally {
        db.close();
    }
});
