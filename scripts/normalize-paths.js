#!/usr/bin/env node

/**
 * Migration script to normalize folder_path in the database
 * This script should be run once after updating to the new version
 * Integrated with hot update process via runner.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

// Configuration
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/gallery.db');
const MIGRATION_MARKER_FILE = path.join(path.dirname(DB_PATH), '.migration_normalization_completed');

// Helper: Log with timestamp
function log(msg, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[Migration ${timestamp}] [${level}] ${msg}`);
}

/**
 * Smart path normalization - same logic as server.js
 */
function smartNormalizePath(filePath) {
    if (!filePath) return filePath;

    // If path is already absolute and doesn't contain relative parts, keep it as-is
    if (path.isAbsolute(filePath) && !filePath.includes('..') && !filePath.includes('/.')) {
        return filePath;
    }

    // Otherwise, normalize it
    return path.resolve(filePath);
}

/**
 * Check if migration has already been completed
 */
function isMigrationCompleted() {
    if (fs.existsSync(MIGRATION_MARKER_FILE)) {
        try {
            const marker = JSON.parse(fs.readFileSync(MIGRATION_MARKER_FILE, 'utf8'));
            log(`Migration already completed at ${marker.timestamp}`, 'INFO');
            return true;
        } catch (e) {
            log('Invalid migration marker file, proceeding...', 'WARN');
        }
    }
    return false;
}

/**
 * Mark migration as completed
 */
function markMigrationCompleted() {
    const marker = {
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    };
    fs.writeFileSync(MIGRATION_MARKER_FILE, JSON.stringify(marker, null, 2));
    log('Migration marker created', 'INFO');
}

/**
 * Main migration function
 */
function performMigration() {
    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        log('Database file not found, skipping migration', 'INFO');
        return true;
    }

    log('Opening database...', 'INFO');
    const db = new Database(DB_PATH);

    try {
        // Check migration marker
        if (isMigrationCompleted()) {
            log('Migration already completed, skipping', 'INFO');
            return true;
        }

        log('Starting folder path normalization...', 'INFO');

        // Get all unique folder paths
        const rows = db.prepare('SELECT DISTINCT folder_path FROM files').all();
        log(`Found ${rows.length} unique folder paths`, 'INFO');

        let updated = 0;
        let unchanged = 0;
        const updates = [];

        // Analyze and prepare updates
        for (const row of rows) {
            const oldPath = row.folder_path;

            // Smart normalize - only normalize if needed
            const newPath = smartNormalizePath(oldPath);

            if (newPath !== oldPath) {
                updates.push({ oldPath, newPath });
                updated++;
            } else {
                unchanged++;
            }
        }

        // Apply updates if any
        if (updates.length > 0) {
            log(`Normalizing ${updates.length} folder paths...`, 'INFO');

            const updateStmt = db.prepare('UPDATE files SET folder_path = ? WHERE folder_path = ?');
            const updateMany = db.transaction((updates) => {
                for (const { oldPath, newPath } of updates) {
                    try {
                        updateStmt.run(newPath, oldPath);
                    } catch (e) {
                        log(`Failed to update ${oldPath}: ${e.message}`, 'WARN');
                    }
                }
            });

            updateMany(updates);
            log('✅ Normalization complete', 'INFO');
        } else {
            log('✅ No paths needed normalization', 'INFO');
        }

        log(`Summary: Updated ${updated}, Unchanged ${unchanged}`, 'INFO');

        // Cleanup orphaned FTS5 entries
        try {
            log('Cleaning up orphaned FTS5 entries...', 'INFO');
            const ftsCleanup = db.prepare('DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)');
            const deleted = ftsCleanup.run();
            log(`✅ FTS5 cleanup complete: ${deleted.changes} orphaned entries removed`, 'INFO');
        } catch (e) {
            log(`FTS5 cleanup warning: ${e.message}`, 'WARN');
        }

        // Optimize database
        try {
            log('Optimizing database...', 'INFO');
            db.exec('PRAGMA optimize');
            log('✅ Database optimization complete', 'INFO');
        } catch (e) {
            log(`Optimization warning: ${e.message}`, 'WARN');
        }

        // Mark migration as completed
        markMigrationCompleted();

        log('✅ Migration complete!', 'INFO');
        return true;

    } catch (error) {
        log(`❌ Migration failed: ${error.message}`, 'ERROR');
        log(error.stack, 'ERROR');
        return false;
    } finally {
        db.close();
    }
}

// Main entry point
if (require.main === module) {
    const success = performMigration();
    process.exit(success ? 0 : 1);
}

// Export for use in other scripts
module.exports = {
    performMigration,
    isMigrationCompleted,
    smartNormalizePath
};
