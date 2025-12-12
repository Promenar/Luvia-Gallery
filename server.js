const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const database = require('./database');

const app = express();
const port = 3001;

// Constants
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'lumina-config.json');
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, 'media');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(MEDIA_ROOT)) {
    fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

// Initialize database
let dbReady = false;
database.initDatabase().then(() => {
    console.log('Database initialized successfully');
    dbReady = true;
}).catch(err => {
    console.error('Database initialization failed:', err);
    process.exit(1);
});
// db.pragma('journal_mode = WAL');
// db.prepare(`...`).run();

app.use(cors());
app.use(express.json());

// Serve static files from the 'dist' directory (Vite build output)
app.use(express.static(path.join(__dirname, 'dist')));

// Watcher State
let isWatcherActive = false;
let watcher = null;
let watcherLogs = [];
const MAX_LOGS = 50;

// Debounce state for file changes
let pendingChanges = new Map(); // path -> timeout
const DEBOUNCE_DELAY = 500; // ms

// --- Helper Functions ---
function addWatcherLog(type, path, message) {
    const log = {
        timestamp: Date.now(),
        type, // 'add', 'change', 'unlink', 'error'
        path,
        message
    };
    watcherLogs.unshift(log);
    if (watcherLogs.length > MAX_LOGS) {
        watcherLogs = watcherLogs.slice(0, MAX_LOGS);
    }
    console.log(`[Watcher] ${type.toUpperCase()}: ${path} - ${message}`);
}

function rebuildFolderStats() {
    console.log("Rebuilding folder stats...");
}

// Process a single file for database insertion
async function processFileForDB(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }

        const stats = fs.statSync(filePath);
        if (!stats.isFile()) {
            return null;
        }

        const ext = path.extname(filePath).toLowerCase();
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        const videoExts = ['.mp4', '.webm', '.mov'];
        const audioExts = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma'];
        const supportedExts = [...imageExts, ...videoExts, ...audioExts];

        if (!supportedExts.includes(ext)) {
            return null;
        }

        let type = 'image/jpeg';
        let mediaType = 'image';

        // Video detection
        if (ext === '.mp4') type = 'video/mp4';
        else if (ext === '.webm') type = 'video/webm';
        else if (ext === '.mov') type = 'video/quicktime';

        if (videoExts.includes(ext)) {
            mediaType = 'video';
        }

        // Audio detection
        if (ext === '.mp3') type = 'audio/mpeg';
        else if (ext === '.wav') type = 'audio/wav';
        else if (ext === '.flac') type = 'audio/flac';
        else if (ext === '.m4a') type = 'audio/mp4';
        else if (ext === '.aac') type = 'audio/aac';
        else if (ext === '.ogg') type = 'audio/ogg';
        else if (ext === '.wma') type = 'audio/x-ms-wma';

        if (audioExts.includes(ext)) {
            mediaType = 'audio';
            console.log('[AUDIO] Detected audio file:', filePath, 'type:', type);
        }

        return {
            id: Buffer.from(filePath).toString('base64'),
            path: filePath,
            name: path.basename(filePath),
            folderPath: path.dirname(filePath),
            size: stats.size,
            type: type,
            mediaType: mediaType,
            lastModified: stats.mtimeMs,
            sourceId: 'local'
        };
    } catch (error) {
        console.error(`Error processing file ${filePath}:`, error);
        return null;
    }
}

function startWatcher(paths) {
    if (watcher) {
        console.log("Watcher already running");
        return;
    }

    console.log("Starting watcher on paths:", paths);
    isWatcherActive = true;

    watcher = chokidar.watch(paths, {
        ignored: /(^|[\/\\])\../, // Ignore dotfiles
        persistent: true,
        ignoreInitial: true, // Don't trigger events for existing files
        awaitWriteFinish: {
            stabilityThreshold: 1000,
            pollInterval: 100
        }
    });

    // Event: File added
    watcher.on('add', (filePath) => {
        if (!dbReady) return;

        // Debounce
        if (pendingChanges.has(filePath)) {
            clearTimeout(pendingChanges.get(filePath));
        }

        const timeout = setTimeout(async () => {
            pendingChanges.delete(filePath);

            const fileData = await processFileForDB(filePath);
            if (fileData) {
                database.upsertFile(fileData);
                database.saveDatabase();
                addWatcherLog('add', filePath, 'File added to database');
            }
        }, DEBOUNCE_DELAY);

        pendingChanges.set(filePath, timeout);
    });

    // Event: File changed
    watcher.on('change', (filePath) => {
        if (!dbReady) return;

        // Debounce
        if (pendingChanges.has(filePath)) {
            clearTimeout(pendingChanges.get(filePath));
        }

        const timeout = setTimeout(async () => {
            pendingChanges.delete(filePath);

            const fileData = await processFileForDB(filePath);
            if (fileData) {
                database.upsertFile(fileData);
                database.saveDatabase();
                addWatcherLog('change', filePath, 'File updated in database');
            }
        }, DEBOUNCE_DELAY);

        pendingChanges.set(filePath, timeout);
    });

    // Event: File removed
    watcher.on('unlink', (filePath) => {
        if (!dbReady) return;

        // Debounce
        if (pendingChanges.has(filePath)) {
            clearTimeout(pendingChanges.get(filePath));
        }

        const timeout = setTimeout(() => {
            pendingChanges.delete(filePath);

            // Normalize path and generate ID for robust deletion
            const normalizedPath = path.resolve(filePath);
            const id = Buffer.from(normalizedPath).toString('base64');

            console.log(`[Watcher] Deleting file: ${normalizedPath} (ID: ${id})`);

            database.deleteFile(normalizedPath, id);
            addWatcherLog('unlink', normalizedPath, 'File removed from database');
        }, DEBOUNCE_DELAY);

        pendingChanges.set(filePath, timeout);
    });

    // Event: Error
    watcher.on('error', (error) => {
        console.error('Watcher error:', error);
        addWatcherLog('error', '', error.message);
    });

    // Event: Ready
    watcher.on('ready', () => {
        console.log('Watcher is ready and monitoring for changes');
        addWatcherLog('info', '', 'Watcher initialized and monitoring');
    });
}

function stopWatcher() {
    if (watcher) {
        watcher.close();
        watcher = null;
        isWatcherActive = false;

        // Clear pending debounced changes
        for (const timeout of pendingChanges.values()) {
            clearTimeout(timeout);
        }
        pendingChanges.clear();

        console.log('Watcher stopped');
        addWatcherLog('info', '', 'Watcher stopped');
    }
}

// --- API Endpoints ---

// Config API
app.get('/api/config', (req, res) => {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const fileContent = fs.readFileSync(CONFIG_FILE, 'utf8');
            if (!fileContent.trim()) {
                res.json({ configured: false });
                return;
            }
            try {
                const config = JSON.parse(fileContent);
                res.json(config);
            } catch (parseError) {
                // If parse fails (e.g. invalid JSON), treat as not configured
                console.error("Config parse error", parseError);
                res.json({ configured: false });
            }
        } else {
            res.json({ configured: false });
        }
    } catch (e) {
        console.error("Config read error", e);
        res.status(500).json({ error: "Failed to read config" });
    }
});

app.post('/api/config', (req, res) => {
    let currentConfig = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const fileContent = fs.readFileSync(CONFIG_FILE, 'utf8');
            if (fileContent.trim()) {
                currentConfig = JSON.parse(fileContent);
            }
        }
    } catch (e) { }

    const oldPaths = currentConfig.libraryPaths || [];
    const newPaths = req.body.libraryPaths || [];

    const newConfig = {
        ...req.body,
        watcherEnabled: currentConfig.watcherEnabled
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));

    // Detect and cleanup removed paths
    const removedPaths = oldPaths.filter(p => !newPaths.includes(p));
    if (removedPaths.length > 0) {
        console.log("Removing data for deleted paths:", removedPaths);
        try {
            const deleteStmt = db.prepare("DELETE FROM files WHERE source_id = ?");
            const txn = db.transaction((paths) => {
                for (const p of paths) {
                    // Normalize path string to match how it was stored (see startServerScan)
                    let cleanSource = p.trim();
                    if (cleanSource.length > 1 && cleanSource.endsWith('/')) cleanSource = cleanSource.slice(0, -1);
                    if (cleanSource.length > 1 && cleanSource.endsWith('\\')) cleanSource = cleanSource.slice(0, -1);

                    const sourceId = `nas-${Buffer.from(cleanSource).toString('base64')}`;
                    deleteStmt.run(sourceId);
                }
            });
            txn(removedPaths);

            // Rebuild folder structure to remove empty folders left behind
            rebuildFolderStats();
        } catch (e) {
            console.error("Failed to cleanup DB:", e);
        }
    }

    if (isWatcherActive) {
        startWatcher(newConfig.libraryPaths || [MEDIA_ROOT]);
    }

    res.json({ success: true });
});

// --- API Endpoints ---

// ... Config API (unchanged) ...

// --- Helper Functions ---
// Helper to recursively find cover media
function findCoverMedia(dirPath, depth = 0, maxDepth = 3) {
    try {
        if (depth > maxDepth || !fs.existsSync(dirPath)) return null;

        const items = fs.readdirSync(dirPath, { withFileTypes: true });

        // 1. Look for Images in current folder
        const img = items.find(i => i.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(i.name));
        if (img) {
            return {
                name: img.name,
                path: path.join(dirPath, img.name),
                type: 'image'
            };
        }

        // 2. Look for Videos in current folder
        const video = items.find(i => i.isFile() && /\.(mp4|mov|webm)$/i.test(i.name));
        if (video) {
            return {
                name: video.name,
                path: path.join(dirPath, video.name),
                type: 'video'
            };
        }

        // 3. Recurse into subfolders
        const subfolders = items.filter(i => i.isDirectory() && !i.name.startsWith('.'));
        for (const sub of subfolders) {
            const found = findCoverMedia(path.join(dirPath, sub.name), depth + 1, maxDepth);
            if (found) return found;
        }

        return null;
    } catch (e) {
        return null; // Ignore errors (permissions, etc)
    }
}

function getSubfolders(dirPath) {
    try {
        // Resolve parent path safely
        if (!fs.existsSync(dirPath)) return [];
        return fs.readdirSync(dirPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
            .map(dirent => path.join(dirPath, dirent.name));
    } catch (e) {
        console.error(`Error reading directory ${dirPath}:`, e);
        return [];
    }
}

function getAllFiles(dirPath, files = []) {
    // This synchronous version is OK for small tests but blocking for control.
    // We'll use an async approach in the scan loop instead.
    return files;
}

// Scan State
let scanState = {
    status: 'idle', // idle, scanning, paused
    count: 0,
    currentPath: '',
    shouldStop: false,
    shouldPause: false
};
const PAUSE_CHECK_INTERVAL = 100; // Check every 100ms if paused

app.get('/api/library/folders', (req, res) => {
    const favoritesOnly = req.query.favorites === 'true';

    if (favoritesOnly) {
        // Return favorite folders
        if (!dbReady) {
            return res.status(503).json({ error: 'Database not ready' });
        }

        const userId = 'admin'; // Default user ID
        const favoriteIds = database.getFavoriteIds(userId);

        // Get folder details for each favorite folder path
        const folders = favoriteIds.folders.map(folderPath => {
            let coverMedia = null;
            let mediaCount = 0;

            try {
                if (fs.existsSync(folderPath)) {
                    // Count media files (non-recursive for now, or could use DB stats)
                    const items = fs.readdirSync(folderPath, { withFileTypes: true });
                    mediaCount = items.filter(i => i.isFile() && /\.(jpg|jpeg|png|webp|mp4|mov|webm)$/i.test(i.name)).length;

                    // Find smart cover
                    const found = findCoverMedia(folderPath);
                    if (found) {
                        coverMedia = {
                            url: `/api/thumb/${Buffer.from(found.path).toString('base64')}`,
                            mediaType: found.type,
                            name: found.name
                        };
                    }
                }
            } catch (e) { }

            return {
                name: path.basename(folderPath),
                path: folderPath,
                mediaCount: mediaCount,
                coverMedia: coverMedia
            };
        });

        return res.json({ folders });
    }

    // Normal folder browsing (non-favorites)
    // Decode if it came from encoded param
    let parentPath = req.query.parentPath || req.query.parent;

    // If client passes "root" or "/", treat as root request
    const isRootRequest = !parentPath || parentPath === 'root' || parentPath === '/';

    // If it's a root request, we need to decide what to show
    let subs = [];

    if (isRootRequest) {
        // 1. Try to read config for library paths
        let libraryPaths = [];
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                if (config.libraryPaths && config.libraryPaths.length > 0) {
                    // Filter out paths that don't exist
                    libraryPaths = config.libraryPaths.filter(p => fs.existsSync(p));
                }
            } catch (e) { }
        }

        if (libraryPaths.length > 0) {
            // If we have specific library paths configured, ONLY show those
            subs = libraryPaths;
            console.log(`[DEBUG] Root request: Showing configured library paths: ${subs.join(', ')}`);
        } else {
            // Fallback to MEDIA_ROOT if no config
            subs = getSubfolders(MEDIA_ROOT);
            console.log(`[DEBUG] Root request: No config, showing MEDIA_ROOT subfolders: ${subs.join(', ')}`);
        }
    } else {
        // Not root, just get subfolders of the requested parent
        console.log(`[DEBUG] /api/library/folders request. mappedPath: ${parentPath}`);
        let rawSubs = getSubfolders(parentPath);

        // Security/Scope Check:
        // Ensure that the requested folder and its returned subfolders are visually valid
        // based on the libraryPaths config.
        let libraryPaths = [];
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                if (config.libraryPaths && config.libraryPaths.length > 0) {
                    libraryPaths = config.libraryPaths.filter(p => fs.existsSync(p));
                }
            } catch (e) { }
        }

        if (libraryPaths.length > 0) {
            // Filter rawSubs
            // A folder is valid to show IF:
            // 1. It is a descendant of a libraryPath (i.e. we are deep in the allowed tree)
            // 2. It is an ancestor of a libraryPath (i.e. we are navigating down to an allowed tree)
            subs = rawSubs.filter(subPath => {
                // Check 1: Is subPath inside any libraryPath?
                const isDescendant = libraryPaths.some(lp => subPath.startsWith(lp));
                if (isDescendant) return true;

                // Check 2: Is subPath on the way to any libraryPath?
                // i.e. does some libraryPath start with subPath?
                const isAncestor = libraryPaths.some(lp => lp.startsWith(subPath));
                if (isAncestor) return true;

                return false;
            });
        } else {
            subs = rawSubs;
        }
    }

    const folders = subs.map(f => {
        let coverMedia = null;
        try {
            const found = findCoverMedia(f);
            if (found) {
                coverMedia = {
                    url: `/api/thumb/${Buffer.from(found.path).toString('base64')}`,
                    mediaType: found.type,
                    name: found.name
                };
            }
        } catch (e) { }

        return {
            name: path.basename(f),
            path: f,
            mediaCount: 0, // Stub
            coverMedia: coverMedia
        };
    });
    res.json({ folders });
});

// Autocomplete API (matches PathAutocomplete.tsx)
app.get('/api/fs/list', (req, res) => {
    let queryPath = req.query.path || '/'; // Changed const to let
    // If client passes "root" or "/", map to MEDIA_ROOT
    if (queryPath === 'root' || queryPath === '/') queryPath = MEDIA_ROOT;
    const dirs = getSubfolders(queryPath).map(p => path.basename(p));
    res.json({ dirs });
});

// --- Media Serving ---

app.get('/api/file/:id', (req, res) => {
    try {
        const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).send('File not found');
        }
    } catch (e) {
        res.status(500).send('Error');
    }
});

// Old thumb endpoint removed - handled below


// --- Scanning Logic ---

async function processScan() {
    console.log('Starting processScan...');
    scanState.status = 'scanning';
    scanState.shouldStop = false;

    let libraryPaths = [MEDIA_ROOT];
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (config.libraryPaths && config.libraryPaths.length > 0) {
                libraryPaths = config.libraryPaths;
            }
        } catch (e) { console.error("Error reading config", e); }
    }
    console.log('Scanning paths:', libraryPaths);

    // Helper to sleep for pause
    const waitIfPaused = async () => {
        while (scanState.shouldPause) {
            if (scanState.shouldStop) return;
            scanState.status = 'paused';
            await new Promise(r => setTimeout(r, 500));
        }
        scanState.status = 'scanning';
    };

    let totalFiles = [];
    const queue = [...libraryPaths];

    while (queue.length > 0) {
        if (scanState.shouldStop) break;
        await waitIfPaused();

        const currentDir = queue.shift();
        scanState.currentPath = currentDir;

        try {
            if (fs.existsSync(currentDir)) {
                const items = fs.readdirSync(currentDir, { withFileTypes: true });

                for (const item of items) {
                    if (scanState.shouldStop) break;
                    await waitIfPaused();

                    if (item.name.startsWith('.')) continue;
                    const fullPath = path.join(currentDir, item.name);

                    if (item.isDirectory()) {
                        queue.push(fullPath);
                    } else if (item.isFile()) {
                        const ext = path.extname(item.name).toLowerCase();
                        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
                        const videoExts = ['.mp4', '.webm', '.mov'];
                        const audioExts = ['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma'];
                        const allSupportedExts = [...imageExts, ...videoExts, ...audioExts];

                        if (allSupportedExts.includes(ext)) {
                            let fileType = 'image/jpeg';
                            if (videoExts.includes(ext)) {
                                fileType = ext === '.mp4' ? 'video/mp4' : ext === '.webm' ? 'video/webm' : 'video/quicktime';
                            } else if (audioExts.includes(ext)) {
                                if (ext === '.mp3') fileType = 'audio/mpeg';
                                else if (ext === '.wav') fileType = 'audio/wav';
                                else if (ext === '.flac') fileType = 'audio/flac';
                                else if (ext === '.m4a') fileType = 'audio/mp4';
                                else if (ext === '.aac') fileType = 'audio/aac';
                                else if (ext === '.ogg') fileType = 'audio/ogg';
                                else if (ext === '.wma') fileType = 'audio/x-ms-wma';
                            }

                            totalFiles.push({
                                name: item.name,
                                path: fullPath,
                                size: fs.statSync(fullPath).size,
                                lastModified: fs.statSync(fullPath).mtimeMs,
                                type: fileType
                            });
                            scanState.count = totalFiles.length;

                            // Delay data removed for speed
                            // await new Promise(r => setTimeout(r, 50));
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error scanning dir:", currentDir, e);
        }
    }

    // Save Results to Database
    if (!scanState.shouldStop) {
        // SYNC: Remove files that are no longer on disk
        console.log('Syncing database with scan results...');
        try {
            const allDbPaths = database.getAllFilePaths();
            const foundPaths = new Set(totalFiles.map(f => f.path));
            const pathsToDelete = allDbPaths.filter(p => !foundPaths.has(p));

            // Delete files that are no longer in the library roots or have been removed
            const pathsReallyToDelete = pathsToDelete;

            if (pathsReallyToDelete.length > 0) {
                console.log(`Found ${pathsReallyToDelete.length} missing/out-of-scope files to delete.`);
                for (const p of pathsReallyToDelete) {
                    // ID generation must match what was used to insert
                    const id = Buffer.from(p).toString('base64');
                    database.deleteFile(p, id);
                }
                console.log('Cleanup complete.');
            } else {
                console.log('No missing files found.');
            }
        } catch (err) {
            console.error('Error during database sync/cleanup:', err);
        }

        console.log(`Saving ${totalFiles.length} files to database...`);
        const filesToInsert = totalFiles.map(f => ({
            id: Buffer.from(f.path).toString('base64'),
            path: f.path,
            name: f.name,
            folderPath: path.dirname(f.path),
            size: f.size,
            type: f.type,
            mediaType: f.type.startsWith('video') ? 'video' : (f.type.startsWith('audio') ? 'audio' : 'image'),
            lastModified: f.lastModified,
            sourceId: 'local'
        }));

        // Insert in batches of 1000
        const batchSize = 1000;
        for (let i = 0; i < filesToInsert.length; i += batchSize) {
            const batch = filesToInsert.slice(i, i + batchSize);
            database.insertFilesBatch(batch);
        }

        console.log('Database save complete');
        scanState.status = 'idle';
    } else {
        scanState.status = 'cancelled';
    }
}

app.get('/api/scan/status', (req, res) => {
    res.json({
        status: scanState.status,
        count: scanState.count,
        currentPath: scanState.currentPath
    });
});

app.post('/api/scan/start', (req, res) => {
    if (scanState.status === 'scanning' || scanState.status === 'paused') {
        return res.json({ success: true, message: 'Already running' });
    }

    // Reset control flags
    scanState.shouldPause = false;
    scanState.shouldStop = false;
    scanState.count = 0;

    // Start Async
    processScan();

    res.json({ success: true });
});

app.post('/api/scan/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause') {
        scanState.shouldPause = true;
    } else if (action === 'resume') {
        scanState.shouldPause = false;
    } else if (action === 'stop') {
        scanState.shouldStop = true;
        scanState.shouldPause = false; // Break out of pause loop
    }
    res.json({ success: true, status: scanState.status });
});

app.get('/api/scan/results', (req, res) => {
    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready' });
    }

    // Determine offset/limit for pagination
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 100;
    const favoritesOnly = req.query.favorites === 'true';
    let folderPath = req.query.folder;

    // Handle root path mapping for folder filter
    if (req.query.folder !== undefined) {
        if (!folderPath || folderPath === 'root' || folderPath === '/') {
            folderPath = MEDIA_ROOT;
        }
    }

    let files, total;

    if (favoritesOnly) {
        // Query favorites - use 'admin' as default user ID
        const userId = 'admin';
        files = database.queryFavoriteFiles(userId, { offset, limit });
        total = database.countFavoriteFiles(userId);
    } else {
        // Security Check: Restrict files based on libraryPaths
        let libraryPaths = [];
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                if (config.libraryPaths && config.libraryPaths.length > 0) {
                    libraryPaths = config.libraryPaths.filter(p => fs.existsSync(p));
                }
            } catch (e) { }
        }

        let isBasePathValid = true;

        // If specific library paths are configured, and a folderPath is requested
        if (libraryPaths.length > 0 && folderPath) {
            const resolvedPath = path.resolve(folderPath);
            // We only show files if the requested folder is:
            // 1. One of the library paths (Exact)
            // 2. A subdirectory of a library path (Descendant)
            // We do NOT show files if the folder is an Ancestor (e.g. /media containing /media/Photos).

            const isDescendantOrEqual = libraryPaths.some(lp => {
                const resolvedLp = path.resolve(lp);
                return resolvedPath === resolvedLp || resolvedPath.startsWith(resolvedLp + path.sep) || resolvedPath.startsWith(resolvedLp + '/');
            });

            if (!isDescendantOrEqual) {
                isBasePathValid = false;
                console.log(`[Security] Blocking file listing for ancestor/unrelated path: ${resolvedPath}`);
            }
        }

        if (!isBasePathValid) {
            files = [];
            total = 0;
        } else {
            // Query database normally
            const queryOptions = { offset, limit };
            if (folderPath) {
                queryOptions.folderPath = path.resolve(folderPath);
            }
            files = database.queryFiles(queryOptions);
            total = database.countFiles(folderPath ? { folderPath: path.resolve(folderPath) } : {});
        }
    }

    // Transform to API format
    const transformedFiles = files.map(f => ({
        id: f.id,
        url: `/api/file/${f.id}`,
        thumbnailUrl: `/api/thumb/${f.id}`,
        name: f.name,
        path: f.path,
        folderPath: f.folderPath,
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
        mediaType: f.mediaType,
        sourceId: f.sourceId
    }));

    res.json({
        files: transformedFiles,
        total: total,
        hasMore: offset + limit < total,
        sources: [{ id: 'local', name: 'Local Storage', count: total }]
    });
});

const { exec } = require('child_process');
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Thumbnail State
let thumbState = {
    status: 'idle',
    count: 0,
    total: 0,
    currentPath: '',
    shouldStop: false,
    shouldPause: false
};

// Hardware Acceleration State
let hwAccel = {
    type: 'none', // 'cuda', 'vaapi', 'none'
    device: null, // e.g., '/dev/dri/renderD128'
    flags: []     // Base ffmpeg flags for input
};

// Check for Hardware Acceleration Capabilities
async function detectHardwareAcceleration() {
    console.log('Detecting hardware acceleration...');
    return new Promise((resolve) => {
        exec('ffmpeg -hwaccels', (err, stdout) => {
            if (err) {
                console.error('Failed to check ffmpeg hwaccels:', err);
                resolve();
                return;
            }

            const output = stdout.toString();
            console.log('FFmpeg hwaccels:', output.split('\n').filter(Boolean).join(', '));

            // 1. Check for NVIDIA CUDA
            if (output.includes('cuda')) {
                // Try a simple test to verify it actually works
                exec('ffmpeg -init_hw_device cuda=cuda:0 -f null -', (testErr) => {
                    if (!testErr) {
                        console.log('Hardware Acceleration: NVIDIA CUDA detected and verified.');
                        hwAccel.type = 'cuda';
                        hwAccel.flags = ['-hwaccel', 'cuda'];
                    } else {
                        console.warn('Hardware Acceleration: NVIDIA CUDA supported but initialization failed (drivers might be missing or container not privileged).');
                    }
                    resolve();
                });
            }
            // 2. Check for VAAPI (Intel/AMD)
            else if (output.includes('vaapi')) {
                // Check if render device exists
                const renderDevice = '/dev/dri/renderD128';
                if (fs.existsSync(renderDevice)) {
                    // Try verification
                    exec(`ffmpeg -init_hw_device vaapi=va:${renderDevice} -f null -`, (testErr) => {
                        if (!testErr) {
                            console.log('Hardware Acceleration: VAAPI detected and verified.');
                            hwAccel.type = 'vaapi';
                            hwAccel.device = renderDevice;
                            // For VAAPI we usually need to specify device and output format
                            hwAccel.flags = ['-hwaccel', 'vaapi', '-hwaccel_output_format', 'format=nv12', '-vaapi_device', renderDevice];
                        } else {
                            console.warn('Hardware Acceleration: VAAPI supported but failed to initialize device.');
                        }
                        resolve();
                    });
                } else {
                    console.log('Hardware Acceleration: VAAPI supported but /dev/dri/renderD128 not found.');
                    resolve();
                }
            } else {
                console.log('Hardware Acceleration: None detected (Software mode).');
                resolve();
            }
        });
    });
}

// Initialize HW Check on startup
detectHardwareAcceleration();


async function generateThumbnail(file) {
    // Switch to WebP
    const thumbName = `${Buffer.from(file.path).toString('base64')}.webp`;
    const thumbPath = path.join(CACHE_DIR, thumbName);

    if (fs.existsSync(thumbPath)) return true;

    return new Promise((resolve) => {
        // Build FFmpeg command with HW acceleration if available
        let inputFlags = [];
        let filterChain = 'scale=300:-1';

        // Apply HW Acceleration Flags
        if (hwAccel.type === 'cuda') {
            inputFlags = [...hwAccel.flags];
            // CUDA filter chain
            // scale_npp is for CUDA scaling, but simple scale usually works if we decode on GPU
            // For robustness, if using -hwaccel cuda, better to rely on software scaling after decode 
            // or keep it simple to assume CPU scaling unless performance is critical.
            // Using software scaling for thumbnails is safer and usually fast enough.
            // But let's try to use GPU decoding at least.
        } else if (hwAccel.type === 'vaapi') {
            inputFlags = [...hwAccel.flags];
            // VAAPI requires specific scaling filters if we want endpoints purely in GPU
            // -vf 'scale_vaapi=w=300:h=-2,hwdownload,format=nv12' example
            // For simplicity and compatibility, we often let ffmpeg auto-convert for software filter if needed
            // But strict vaapi pipeline is: decode(gpu) -> scale(gpu) -> download -> encode(cpu/gpu)

            // For thumbnails (webp), we usually encode on CPU (libwebp).
            // So: Decode (GPU) -> Scale (GPU or CPU) -> Encode (CPU).

            // Robust VAAPI Scale:
            filterChain = 'scale_vaapi=w=300:h=-2,hwdownload,format=nv12';
        }

        // Construct command
        // Note: For VAAPI, input flags must be BEFORE -i
        const flagsStr = inputFlags.join(' ');

        // Base command
        let cmd = `ffmpeg -y ${flagsStr} -i "${file.path}" -vf "${filterChain}" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;

        exec(cmd, { timeout: 15000 }, (err) => {
            if (err) {
                // If HW accel failed, retry with software only
                if (hwAccel.type !== 'none') {
                    console.warn(`HW Thumbnail failed for ${file.path}, retrying with software...`);
                    const swCmd = `ffmpeg -y -i "${file.path}" -vf "scale=300:-1" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;
                    exec(swCmd, { timeout: 20000 }, (retryErr) => {
                        if (retryErr) {
                            console.error(`Software fallback failed for ${file.path}:`, retryErr);
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    });
                } else {
                    console.error(`Error generating thumb for ${file.path}:`, err);
                    resolve(false);
                }
            } else {
                resolve(true);
            }
        });
    });
}

async function processThumbnails() {
    console.log('Starting processThumbnails...');
    thumbState.status = 'scanning'; // Use 'scanning' to match client polling expectation
    thumbState.shouldStop = false;
    thumbState.shouldPause = false; // Ensure pause is reset
    thumbState.count = 0;

    try {
        // Create work queue from database
        const allFiles = database.queryFiles({ offset: 0, limit: 999999 });
        const queue = allFiles.map(f => ({
            path: f.path,
            id: f.id
        }));
        thumbState.total = queue.length;

        for (const file of queue) {
            // Enhanced active check
            if (thumbState.shouldStop) {
                console.log('Thumbnail generation stopped by user');
                break;
            }

            // Enhanced pause loop
            while (thumbState.shouldPause) {
                if (thumbState.shouldStop) break;
                thumbState.status = 'paused';
                await new Promise(r => setTimeout(r, 200)); // Check more frequently
            }
            if (thumbState.shouldStop) break; // Double check after pause

            thumbState.status = 'scanning';
            thumbState.currentPath = file.path;

            await generateThumbnail(file);
            thumbState.count++;

            // Brief delay to allow event loop to process control signals
            await new Promise(r => setTimeout(r, 0));
        }
    } catch (e) {
        console.error("Thumb gen error:", e);
    } finally {
        thumbState.status = 'idle';
        console.log('Thumbnail generation finished/stopped');
    }
}

// Thumb Gen API
app.get('/api/thumb-gen/status', (req, res) => {
    res.json({
        status: thumbState.status,
        count: thumbState.count,
        total: thumbState.total,
        currentPath: thumbState.currentPath
    });
});

app.post('/api/thumb-gen/start', (req, res) => {
    if (thumbState.status === 'scanning' || thumbState.status === 'paused') {
        return res.json({ success: true, message: 'Already running' });
    }
    // Only reset if trying to start from idle
    thumbState = { ...thumbState, count: 0, total: 0, shouldStop: false, shouldPause: false };
    processThumbnails();
    res.json({ success: true });
});

app.post('/api/thumb-gen/control', (req, res) => {
    const { action } = req.body;
    console.log(`[ThumbControl] Action received: ${action}`);

    if (action === 'pause') {
        thumbState.shouldPause = true;
    } else if (action === 'resume') {
        thumbState.shouldPause = false;
    } else if (action === 'stop') {
        thumbState.shouldStop = true;
        thumbState.shouldPause = false; // Break the pause loop so it can see the stop signal
    } else if (action === 'close') {
        // Reset state on close
        if (thumbState.status !== 'scanning' && thumbState.status !== 'paused') {
            thumbState.status = 'idle';
        }
    }
    res.json({ success: true, status: thumbState.status });
});

// Serve Thumbs (WebP)
// Serve Thumbs (WebP)
app.get('/api/thumb/:id', async (req, res) => {
    const thumbPath = path.join(CACHE_DIR, `${req.params.id}.webp`);

    if (fs.existsSync(thumbPath)) {
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        res.sendFile(thumbPath);
    } else {
        // Attempt on-the-fly generation for video covers or missing thumbs
        try {
            const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');
            if (fs.existsSync(filePath)) {
                // Check if it's a supported media type before trying to generate
                // (Optional optimization, but generateThumbnail handles generic file object)
                const success = await generateThumbnail({ path: filePath });
                if (success && fs.existsSync(thumbPath)) {
                    res.setHeader('Content-Type', 'image/webp');
                    res.setHeader('Cache-Control', 'public, max-age=31536000');
                    res.sendFile(thumbPath);
                    return;
                }
            }
        } catch (e) {
            console.error("Error generating thumbnail on fly:", e);
        }

        // Return 404 if thumbnail doesn't exist and couldn't be generated
        res.status(404).send('Thumbnail not found');
    }
});

// Serve Media Files (with range request support for video streaming)
app.get('/api/file/:id', (req, res) => {
    try {
        const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');

        if (!fs.existsSync(filePath)) {
            return res.status(404).send('File not found');
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        // Determine MIME type based on file extension
        const ext = path.extname(filePath).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.mp4') {
            contentType = 'video/mp4';
        } else if (ext === '.webm') {
            contentType = 'video/webm';
        } else if (ext === '.mov') {
            contentType = 'video/quicktime';
        } else if (['.jpg', '.jpeg'].includes(ext)) {
            contentType = 'image/jpeg';
        } else if (ext === '.png') {
            contentType = 'image/png';
        } else if (ext === '.webp') {
            contentType = 'image/webp';
        } else if (ext === '.gif') {
            contentType = 'image/gif';
        }

        // Handle range requests for video streaming
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            const file = fs.createReadStream(filePath, { start, end });
            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            };
            res.writeHead(206, head);
            file.pipe(res);
        } else {
            // Serve entire file
            const head = {
                'Content-Length': fileSize,
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=300', // 5 minutes cache
            };
            res.writeHead(200, head);
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (error) {
        console.error('Error serving file:', error);
        res.status(500).send('Error serving file');
    }
});

// System Status API Stub
app.get('/api/system/status', (req, res) => {
    // Get Cache Stats
    let cacheCount = 0;
    let cacheSize = 0;
    try {
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            cacheCount = files.length;
            // Approximate size (stats on every file is slow, so just do mock or sample?)
            // Or just do real stats if count < 1000
            if (cacheCount < 5000) {
                cacheSize = files.reduce((acc, file) => {
                    try { return acc + fs.statSync(path.join(CACHE_DIR, file)).size; } catch { return acc; }
                }, 0);
            }
        }
    } catch (e) { }

    const dbStats = dbReady ? database.getStats() : { totalFiles: 0, totalImages: 0, totalVideos: 0, totalAudio: 0 };

    res.json({
        cpu: 0,
        memory: 0,
        storage: cacheSize,
        watcherActive: isWatcherActive,
        ffmpeg: true,
        sharp: false,
        imageProcessor: 'ffmpeg',
        platform: process.platform,
        ffmpegHwAccels: [],
        cacheCount: cacheCount,
        totalItems: dbStats.totalFiles,
        dbStatus: dbReady ? 'connected' : 'initializing',
        mediaStats: {
            totalFiles: dbStats.totalFiles || 0,
            images: dbStats.totalImages || 0,
            videos: dbStats.totalVideos || 0,
            audio: dbStats.totalAudio || 0
        }
    });
});

// Watcher control endpoint
app.get('/api/watcher/toggle', (req, res) => {
    try {
        let currentConfig = {};
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const content = fs.readFileSync(CONFIG_FILE, 'utf8');
                if (content.trim()) currentConfig = JSON.parse(content);
            } catch (e) { }
        }

        if (isWatcherActive) {
            // Turn off
            stopWatcher();
            currentConfig.watcherEnabled = false;
        } else {
            // Turn on
            let libraryPaths = [MEDIA_ROOT];
            if (currentConfig.libraryPaths && currentConfig.libraryPaths.length > 0) {
                libraryPaths = currentConfig.libraryPaths;
            }
            startWatcher(libraryPaths);
            currentConfig.watcherEnabled = true;
        }

        // Persist setting
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
        } catch (e) {
            console.error("Failed to save watcher config:", e);
        }

        res.json({ active: isWatcherActive });
    } catch (error) {
        console.error('Watcher toggle error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get watcher logs
app.get('/api/watcher/logs', (req, res) => {
    res.json({ logs: watcherLogs });
});

// Favorites API
app.get('/api/favorites/ids', (req, res) => {
    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready' });
    }

    const userId = 'admin'; // Default user ID
    const favoriteIds = database.getFavoriteIds(userId);
    res.json(favoriteIds);
});

app.post('/api/favorites/toggle', (req, res) => {
    console.log('[API] /api/favorites/toggle called, body:', req.body);

    if (!dbReady) {
        console.log('[API] Database not ready');
        return res.status(503).json({ error: 'Database not ready' });
    }

    const { type, id } = req.body;
    const userId = 'admin'; // Default user ID

    console.log('[API] Parsed params:', { type, id, userId });

    if (!type || !id) {
        console.log('[API] Missing type or id');
        return res.status(400).json({ success: false, error: 'Missing type or id' });
    }

    console.log('[API] Calling database.toggleFavorite...');
    const isFavorite = database.toggleFavorite(userId, id, type);
    console.log('[API] toggleFavorite returned:', isFavorite);

    res.json({ success: true, isFavorite });
});

app.post('/api/cache/clear', (req, res) => {
    try {
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            for (const file of files) {
                fs.unlinkSync(path.join(CACHE_DIR, file));
            }
        }
        res.json({ success: true });
    } catch (e) {
        console.error("Clear cache failed", e);
        res.status(500).json({ success: false });
    }
});

app.post('/api/cache/prune', (req, res) => {
    if (!dbReady) {
        return res.status(503).json({ error: 'Database not ready' });
    }

    try {
        let count = 0;
        if (fs.existsSync(CACHE_DIR)) {
            const files = fs.readdirSync(CACHE_DIR);
            // Valid IDs from database
            const allFiles = database.queryFiles({ offset: 0, limit: 999999 });
            const validIds = new Set(allFiles.map(f => f.id));

            for (const file of files) {
                // file is like "base64id.webp"
                const id = path.parse(file).name;
                if (!validIds.has(id)) {
                    fs.unlinkSync(path.join(CACHE_DIR, file));
                    count++;
                }
            }
        }
        res.json({ success: true, count });
    } catch (e) {
        console.error("Prune cache error", e);
        res.status(500).json({ success: false });
    }
});

// Catch-all route to serve index.html for client-side routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);

    // Check config for watcher auto-start
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const content = fs.readFileSync(CONFIG_FILE, 'utf8');
            if (content.trim()) {
                const config = JSON.parse(content);
                if (config.watcherEnabled) {
                    console.log('Watcher enabled in config, starting...');
                    const libraryPaths = (config.libraryPaths && config.libraryPaths.length > 0)
                        ? config.libraryPaths
                        : [MEDIA_ROOT];
                    startWatcher(libraryPaths);
                }
            }
        }
    } catch (e) {
        console.error("Failed to auto-start watcher:", e);
    }
});