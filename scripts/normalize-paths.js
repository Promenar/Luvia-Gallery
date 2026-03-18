#!/usr/bin/env node

/**
 * Migration script to normalize folder_path in the database
 * This script should be run once after updating to the new version
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/gallery.db');

if (!fs.existsSync(DB_PATH)) {
    console.error('Database file not found:', DB_PATH);
    process.exit(1);
}

console.log('Opening database:', DB_PATH);
const db = new Database(DB_PATH);

try {
    console.log('Starting folder path normalization...');

    // Get all unique folder paths
    const rows = db.prepare('SELECT DISTINCT folder_path FROM files').all();
    console.log(`Found ${rows.length} unique folder paths`);

    let updated = 0;
    let unchanged = 0;

    const updateStmt = db.prepare('UPDATE files SET folder_path = ? WHERE folder_path = ?');
    const updateMany = db.transaction((updates) => {
        for (const { oldPath, newPath } of updates) {
            updateStmt.run(newPath, oldPath);
        }
    });

    const updates = [];

    for (const row of rows) {
        const oldPath = row.folder_path;

        // Smart normalize - only normalize if needed
        let newPath = oldPath;
        if (path.isAbsolute(oldPath) && !oldPath.includes('..') && !oldPath.includes('/.')) {
            // Already normalized, skip
            unchanged++;
            continue;
        }

        newPath = path.resolve(oldPath);

        if (newPath !== oldPath) {
            updates.push({ oldPath, newPath });
            updated++;
        } else {
            unchanged++;
        }
    }

    if (updates.length > 0) {
        console.log(`Normalizing ${updates.length} folder paths...`);
        updateMany(updates);
        console.log('✅ Normalization complete');
    } else {
        console.log('✅ No paths needed normalization');
    }

    console.log(`Updated: ${updated}, Unchanged: ${unchanged}`);

    // Cleanup orphaned FTS5 entries
    console.log('Cleaning up orphaned FTS5 entries...');
    db.exec('DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)');
    console.log('✅ FTS5 cleanup complete');

    console.log('✅ Migration complete!');

} catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
