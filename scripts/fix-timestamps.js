/**
 * Database Migration Script: Fix last_modified Timestamp Format
 *
 * Problem: Records have millisecond timestamps instead of seconds
 * This script converts abnormal timestamps (> 2000000000) to seconds
 *
 * Run: node scripts/fix-timestamps.js
 */

const path = require('path');

// Determine database path
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumina.db');
const MIGRATION_MARKER = path.join(__dirname, '..', 'data', '.timestamp-fix-done');

console.log('=== Timestamp Fix Migration Script ===');
console.log('Database path:', DB_PATH);

// Check if migration already done
const fs = require('fs');
if (fs.existsSync(MIGRATION_MARKER)) {
    console.log('Migration already completed. Marker file exists:', MIGRATION_MARKER);
    console.log('To re-run, delete the marker file first.');
    process.exit(0);
}

// Load database
let db;
try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
} catch (err) {
    console.error('Failed to load database:', err.message);
    process.exit(1);
}

try {
    // 1. Check for abnormal timestamps
    console.log('\n--- Step 1: Analyzing timestamps ---');

    const abnormalCount = db.prepare(`
        SELECT COUNT(*) as count FROM files
        WHERE last_modified > 2000000000
    `).get();

    console.log('Records with millisecond timestamps:', abnormalCount.count);

    if (abnormalCount.count === 0) {
        console.log('No abnormal timestamps found. Nothing to fix.');
        fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString());
        process.exit(0);
    }

    // 2. Show sample of abnormal records
    console.log('\n--- Step 2: Sample of abnormal records ---');
    const samples = db.prepare(`
        SELECT path, last_modified FROM files
        WHERE last_modified > 2000000000
        LIMIT 5
    `).all();

    samples.forEach((s, i) => {
        const corrected = Math.floor(s.last_modified / 1000);
        const date = new Date(corrected * 1000);
        console.log(`${i + 1}. ${s.path.split('/').pop()}`);
        console.log(`   Original: ${s.last_modified}`);
        console.log(`   Corrected: ${corrected} (${date.toISOString().slice(0, 19)})`);
    });

    // 3. Temporarily disable FTS5 triggers to avoid SQL logic errors
    console.log('\n--- Step 3: Disabling FTS5 triggers ---');
    db.exec('DROP TRIGGER IF EXISTS files_fts_au');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ad');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ai');
    console.log('FTS5 triggers disabled');

    // 4. Fix timestamps using direct SQL with ROUND
    console.log('\n--- Step 4: Fixing timestamps ---');

    const transaction = db.transaction(() => {
        // Use ROUND to convert float to integer safely
        const result = db.prepare(`
            UPDATE files
            SET last_modified = CAST(ROUND(last_modified / 1000) AS INTEGER)
            WHERE last_modified > 2000000000
        `).run();
        console.log(`Fixed ${result.changes} records`);
        return result.changes;
    });

    const fixedCount = transaction();

    // 5. Recreate FTS5 triggers
    console.log('\n--- Step 5: Recreating FTS5 triggers ---');
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
    console.log('FTS5 triggers recreated');

    // 6. Rebuild FTS5 index
    console.log('\n--- Step 6: Rebuilding FTS5 index ---');
    db.exec("INSERT INTO files_fts(files_fts) VALUES('rebuild')");
    console.log('FTS5 index rebuilt');

    // 7. Verify fix
    console.log('\n--- Step 7: Verification ---');

    const remainingAbnormal = db.prepare(`
        SELECT COUNT(*) as count FROM files
        WHERE last_modified > 2000000000
    `).get();

    console.log('Remaining abnormal timestamps:', remainingAbnormal.count);

    // Check normal range
    const normal = db.prepare(`
        SELECT MAX(last_modified) as max, MIN(last_modified) as min
        FROM files
        WHERE last_modified BETWEEN 1000000000 AND 2000000000
    `).get();
    if (normal.max && normal.min) {
        console.log('Normal range: min=', normal.min, `(${new Date(normal.min * 1000).toISOString().slice(0, 19)})`);
        console.log('Normal range: max=', normal.max, `(${new Date(normal.max * 1000).toISOString().slice(0, 19)})`);
    }

    // 8. Check integrity
    const integrity = db.pragma('integrity_check');
    console.log('Database integrity:', integrity[0].integrity_check);

    // 9. Create marker file
    fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString());
    console.log('\nMigration completed successfully!');
    console.log('Marker file created:', MIGRATION_MARKER);

} catch (err) {
    console.error('Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
} finally {
    db.close();
}
