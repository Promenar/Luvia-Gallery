/**
 * 数据库完全重置脚本
 * 删除所有数据、FTS5表和触发器，然后重新初始化
 * 
 * 运行: node scripts/reset-database.js
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumina.db');

console.log('=== Database Reset Script ===');
console.log('Database path:', DB_PATH);

if (!fs.existsSync(DB_PATH)) {
    console.log('Database file not found. Nothing to reset.');
    process.exit(0);
}

const Database = require('better-sqlite3');
const db = new Database(DB_PATH);

try {
    console.log('\n--- Step 1: Drop FTS5 triggers ---');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ai');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ad');
    db.exec('DROP TRIGGER IF EXISTS files_fts_au');
    console.log('Triggers dropped');

    console.log('\n--- Step 2: Drop FTS5 table ---');
    db.exec('DROP TABLE IF EXISTS files_fts');
    console.log('FTS5 table dropped');

    console.log('\n--- Step 3: Clear all files data ---');
    db.exec('DELETE FROM files');
    const fileCount = db.prepare('SELECT COUNT(*) as cnt FROM files').get();
    console.log('Files cleared, remaining:', fileCount.cnt);

    console.log('\n--- Step 4: Recreate FTS5 table with correct schema ---');
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
            name, 
            folder_path, 
            tokenize='unicode61'
        )
    `);
    console.log('FTS5 table recreated');

    console.log('\n--- Step 5: Recreate triggers with correct syntax ---');
    db.exec(`
        CREATE TRIGGER files_fts_ai AFTER INSERT ON files BEGIN
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
        END;
        CREATE TRIGGER files_fts_ad AFTER DELETE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
        END;
        CREATE TRIGGER files_fts_au AFTER UPDATE ON files BEGIN
            INSERT INTO files_fts(files_fts, rowid, name, folder_path) VALUES('delete', old.rowid, old.name, old.folder_path);
            INSERT INTO files_fts(rowid, name, folder_path) VALUES (new.rowid, new.name, new.folder_path);
        END
    `);
    console.log('Triggers recreated with single quotes');

    console.log('\n--- Step 6: Verify ---');
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='files'").all();
    console.log('Triggers count:', triggers.length);
    triggers.forEach(t => console.log('  -', t.name));

    const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'").get();
    console.log('FTS5 table exists:', ftsExists ? 'YES' : 'NO');

    console.log('\n✅ Database reset complete!');
    console.log('Now trigger a full scan to rebuild the database.');

} catch (err) {
    console.error('Reset failed:', err.message);
    console.error(err.stack);
    process.exit(1);
} finally {
    db.close();
}