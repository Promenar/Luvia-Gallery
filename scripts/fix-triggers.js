/**
 * Fix FTS5 Triggers - Replace double quotes with single quotes
 * 
 * Problem: Triggers were created with "delete" instead of 'delete'
 * SQLite interprets double quotes as column names, causing SQL errors
 * 
 * Run: node scripts/fix-triggers.js
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumina.db');
const MARKER_FILE = path.join(__dirname, '..', 'data', '.triggers-fixed');

console.log('=== Fix FTS5 Triggers Script ===');
console.log('Database path:', DB_PATH);

// Check if already fixed
if (fs.existsSync(MARKER_FILE)) {
    console.log('Triggers already fixed. Marker file exists:', MARKER_FILE);
    console.log('To re-run, delete the marker file first.');
    process.exit(0);
}

const Database = require('better-sqlite3');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

try {
    console.log('\n--- Step 1: Checking current triggers ---');
    const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='files'").all();
    triggers.forEach(t => {
        console.log(`Trigger: ${t.name}`);
        if (t.sql.includes('"delete"')) {
            console.log('  ⚠️ Contains double quotes - needs fix');
        }
    });

    console.log('\n--- Step 2: Dropping old triggers ---');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ai');
    db.exec('DROP TRIGGER IF EXISTS files_fts_ad');
    db.exec('DROP TRIGGER IF EXISTS files_fts_au');
    console.log('Old triggers dropped');

    console.log('\n--- Step 3: Creating correct triggers with single quotes ---');
    // IMPORTANT: Use single quotes for 'delete' string literal
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
        END;
    `);
    console.log('New triggers created with single quotes');

    console.log('\n--- Step 4: Verifying triggers ---');
    const newTriggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name='files'").all();
    let allCorrect = true;
    newTriggers.forEach(t => {
        if (t.sql.includes('"delete"')) {
            console.log(`❌ ${t.name} still has double quotes`);
            allCorrect = false;
        } else if (t.sql.includes("'delete'")) {
            console.log(`✅ ${t.name} correct (single quotes)`);
        }
    });

    if (allCorrect) {
        // Create marker file
        fs.writeFileSync(MARKER_FILE, new Date().toISOString());
        console.log('\n✅ Triggers fixed successfully!');
        console.log('Marker file created:', MARKER_FILE);
    } else {
        console.log('\n❌ Some triggers still have issues');
        process.exit(1);
    }

} catch (err) {
    console.error('Fix failed:', err.message);
    console.error(err.stack);
    process.exit(1);
} finally {
    db.close();
}
