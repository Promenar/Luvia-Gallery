const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const jwt = require('jsonwebtoken'); // Added for Auth
// const chokidar = require('chokidar'); // REMOVED: Realtime watcher deprecated for performance
const database = require('./database');
const exifr = require('exifr');

const app = express();
const port = 3001;

// --- Constants ---
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, 'media');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(DATA_DIR, 'lumina-config.json');
const SECRET_FILE = path.join(DATA_DIR, 'jwt_secret.key');
let JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    if (fs.existsSync(SECRET_FILE)) {
        try {
            JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
        } catch (e) {
            console.error('Failed to read JWT secret file, generating temporary one:', e);
        }
    }

    if (!JWT_SECRET) {
        JWT_SECRET = crypto.randomBytes(64).toString('hex');
        try {
            if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
            fs.writeFileSync(SECRET_FILE, JWT_SECRET);
            console.log('Generated new unique JWT secret and saved to:', SECRET_FILE);
        } catch (e) {
            console.error('Failed to write JWT secret file, using temporary secret:', e);
        }
    }
}

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Cache Sharding Helper ---
function getCachedPath(filename, ensureDir = false) {
    // filename example: "abcdef123.webp"
    // Shard by first 2 chars -> "ab/cd" (2 levels)
    // Structure: CACHE_DIR/ab/cd/abcdef123.webp
    if (!filename || filename.length < 4) return path.join(CACHE_DIR, filename);

    const l1 = filename.substring(0, 2);
    const l2 = filename.substring(2, 4);
    const dir = path.join(CACHE_DIR, l1, l2);

    if (ensureDir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    return path.join(dir, filename);
}

// --- Migration Logic ---
function migrateCacheStructure() {
    console.log('[Cache] Checking for legacy flat cache structure...');
    try {
        const files = fs.readdirSync(CACHE_DIR);
        let movedCount = 0;

        for (const file of files) {
            // Skip directories (already migrated or system folders)
            const oldPath = path.join(CACHE_DIR, file);
            if (fs.statSync(oldPath).isDirectory()) continue;

            // Only move webp files (thumbnails)
            if (!file.endsWith('.webp')) continue;

            const newPath = getCachedPath(file, true);
            if (oldPath !== newPath) {
                fs.renameSync(oldPath, newPath);
                movedCount++;
            }
        }

        if (movedCount > 0) {
            console.log(`[Cache] Migrated ${movedCount} thumbnails to sharded structure.`);
        } else {
            console.log('[Cache] Cache structure is up to date.');
        }
    } catch (e) {
        console.error('[Cache] Migration failed:', e);
    }
}

// Run migration on startup
migrateCacheStructure();

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

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Fallback: Check query parameter (for img/video src)
    if (!token && req.query.token) {
        token = req.query.token;
    }

    if (!token) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Forbidden
        req.user = user;
        next();
    });
}

// --- Auth Endpoints ---
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    // Read config to find user
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            if (config.users) {
                const user = config.users.find(u => u.username === username);
                // Note: Storing plaintext passwords in config is still not ideal, but this is a step up.
                // Ideally, we should hash them. But for now, we match existing structure.
                if (user && user.password === password) {
                    const token = jwt.sign({ username: user.username, role: user.isAdmin ? 'admin' : 'user' }, JWT_SECRET, { expiresIn: '7d' });
                    // Return user info sans password
                    const { password: _, ...userInfo } = user;
                    res.json({ token, user: userInfo });
                    return;
                }
            }
        } catch (e) { console.error("Login config error", e); }
    }

    // Default/Fallback Admin logic (if no config exists yet, maybe allow setup?)
    // But here we just reject.
    res.status(401).json({ error: 'Invalid credentials' });
});

// Watcher State
let monitorMode = 'manual'; // 'manual' | 'periodic'
let scanInterval = 60; // Minutes
let periodicIntervalId = null;
// Watcher state variables removed.
// let isWatcherActive = false;
// let watcher = null;
// let watcherLogs = [];
// const MAX_LOGS = 50;

// Debounce state for file changes (No longer used without watcher)
let pendingChanges = new Map(); // path -> timeout
const DEBOUNCE_DELAY = 500; // ms

// --- Helper Functions ---
// addWatcherLog function removed.
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

// --- Monitoring Helpers ---
function stopAllMonitoring() {
    stopWatcher(); // This will now be a no-op
    stopPeriodicScanner();
    monitorMode = 'manual';
}

function stopPeriodicScanner() {
    if (periodicIntervalId) {
        clearInterval(periodicIntervalId);
        periodicIntervalId = null;
        console.log('Periodic scanner stopped');
    }
}

function startPeriodicScanner(paths, intervalMinutes) {
    stopPeriodicScanner();
    const ms = (intervalMinutes || 60) * 60 * 1000;
    console.log(`Periodic scanner scheduled every ${intervalMinutes} minutes`);

    periodicIntervalId = setInterval(() => {
        if (scanState.status === 'idle') {
            console.log('[Periodic] Starting scheduled scan...');
            processScan();
        } else {
            console.log('[Periodic] Skipping scan, system busy.');
        }
    }, ms);

    monitorMode = 'periodic';
}

// --- Watcher State (Deprecated) ---
let isWatcherActive = false;
let watcherInstance = null;
// Watcher functions removed.
function startWatcher(paths) {
    console.log('[Watcher] Realtime monitoring is deprecated and disabled.');
}
function stopWatcher() {
    if (isWatcherActive) {
        console.log('[Watcher] Stopping (noop)...');
        isWatcherActive = false;
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
                // Security: Sanitize passwords before sending to client
                if (config.users) {
                    config.users = config.users.map(u => {
                        const { password, ...safeUser } = u;
                        return safeUser;
                    });
                }
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
        // watcherEnabled: currentConfig.watcherEnabled // Removed as watcher is deprecated
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));

    // Detect and cleanup removed paths
    const removedPaths = oldPaths.filter(p => !newPaths.includes(p));
    if (removedPaths.length > 0) {
        console.log("Removing data for deleted paths:", removedPaths);
        try {
            const deleteStmt = database.db.prepare("DELETE FROM files WHERE source_id = ?");
            const txn = database.db.transaction((paths) => {
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

    // if (isWatcherActive) { // Removed as watcher is deprecated
    //     startWatcher(newConfig.libraryPaths || [MEDIA_ROOT]);
    // }

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

// --- Security Barrier ---
app.use((req, res, next) => {
    // Only protect /api routes
    if (!req.path.startsWith('/api')) return next();

    // Whitelist
    const whitelist = [
        '/api/auth',
        '/api/config',  // Needed for setup/login
        '/api/thumb',   // Allow thumbnails (low-res) to be public for UI performance
        '/api/video/stream', // Allow streaming if separate? (Check paths later)
        '/api/system/status' // Allow status for now? No, protect it to force auth.
    ];

    // Check if path starts with any whitelist item
    if (whitelist.some(p => req.path.startsWith(p))) {
        return next();
    }

    authenticateToken(req, res, next);
});

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
                        const b64Id = Buffer.from(found.path).toString('base64');
                        let url = `/api/thumb/${b64Id}`;
                        try {
                            const thumbFilename = crypto.createHash('md5').update(b64Id).digest('hex') + '.webp';
                            const thumbPath = path.join(CACHE_DIR, thumbFilename);
                            if (fs.existsSync(thumbPath)) {
                                url += `?t=${fs.statSync(thumbPath).mtimeMs}`;
                            }
                        } catch (e) { }

                        coverMedia = {
                            url: url,
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
                const b64Id = Buffer.from(found.path).toString('base64');
                let url = `/api/thumb/${b64Id}`;
                try {
                    const thumbFilename = crypto.createHash('md5').update(b64Id).digest('hex') + '.webp';
                    const thumbPath = getCachedPath(thumbFilename);
                    if (fs.existsSync(thumbPath)) {
                        url += `?t=${fs.statSync(thumbPath).mtimeMs}`;
                    }
                } catch (e) { }

                coverMedia = {
                    url: url,
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
    let queryPath = req.query.path || '/';

    // Allow browsing from system root if requested explicitly
    if (queryPath === 'root') queryPath = '/';

    // If empty or null, default to MEDIA_ROOT for convenience, unless it's '/'
    if (!queryPath) queryPath = MEDIA_ROOT;

    const dirs = getSubfolders(queryPath).map(p => path.basename(p));
    res.json({ dirs });
});

// File Operations (Delete/Rename)
app.post('/api/file/delete', (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Missing path' });
    try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        database.deleteFile(filePath);
        res.json({ success: true });
    } catch (e) {
        console.error("Delete error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/file/rename', (req, res) => {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ error: 'Missing params' });

    const folder = path.dirname(oldPath);
    const newPath = path.join(folder, newName);

    try {
        if (fs.existsSync(newPath)) return res.status(400).json({ error: 'File already exists' });

        fs.renameSync(oldPath, newPath);
        database.renameFile(oldPath, newPath, newName);
        res.json({ success: true });
    } catch (e) {
        console.error("Rename error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/folder/delete', (req, res) => {
    const { path: folderPath } = req.body;
    if (!folderPath) return res.status(400).json({ error: 'Missing path' });
    try {
        if (fs.existsSync(folderPath)) {
            fs.rmSync(folderPath, { recursive: true, force: true });
            database.deleteFilesByFolder(folderPath);
        }
        res.json({ success: true });
    } catch (e) {
        console.error("Folder delete error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/folder/rename', (req, res) => {
    const { oldPath, newName } = req.body;
    try {
        const parent = path.dirname(oldPath);
        const newPath = path.join(parent, newName);
        if (fs.existsSync(newPath)) return res.status(400).json({ error: 'Folder exists' });

        fs.renameSync(oldPath, newPath);
        // Intentionally no DB update here, relying on user rescan
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
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
    // Non-blocking yield to allow API response
    await new Promise(r => setImmediate(r));

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

    // Incremental Scan: Fetch all existing files mtime
    console.log('Fetching existing file stats for incremental scan...');
    const existingFilesMtime = database.getAllFilesMtime();
    console.log(`Loaded ${existingFilesMtime.size} existing files from database.`);

    // Streaming batch processing - avoid memory accumulation
    let batchBuffer = [];
    const BATCH_SIZE = 1000;
    const SAVE_INTERVAL = 10000; // Save database every 10k files for safety
    let totalProcessed = 0;
    let allScannedPaths = new Set(); // Track scanned paths for cleanup

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
                            // OPTIMIZATION: Single stat call instead of two
                            const stats = fs.statSync(fullPath);

                            // INCREMENTAL SCAN CHECK
                            const lastMtime = existingFilesMtime.get(fullPath);
                            if (lastMtime && Math.abs(lastMtime - stats.mtimeMs) < 100) {
                                // File unchanged, skip detailed processing
                                allScannedPaths.add(fullPath);
                                totalProcessed++;
                                if (totalProcessed % 50 === 0) scanState.count = totalProcessed; // Update UI less frequently for speed
                                continue;
                            }

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

                            const fileData = {
                                id: Buffer.from(fullPath).toString('base64'),
                                path: fullPath,
                                name: item.name,
                                folderPath: path.dirname(fullPath),
                                size: stats.size,
                                type: fileType,
                                mediaType: fileType.startsWith('video') ? 'video' : (fileType.startsWith('audio') ? 'audio' : 'image'),
                                lastModified: stats.mtimeMs,
                                sourceId: 'local'
                            };

                            batchBuffer.push(fileData);
                            allScannedPaths.add(fullPath);
                            totalProcessed++;
                            scanState.count = totalProcessed;

                            // OPTIMIZATION: Batch insert without saving to disk
                            if (batchBuffer.length >= BATCH_SIZE) {
                                const shouldSave = (totalProcessed % SAVE_INTERVAL) === 0;
                                database.insertFilesBatch(batchBuffer, shouldSave);
                                if (shouldSave) {
                                    console.log(`Checkpoint: Saved database at ${totalProcessed} files`);
                                }
                                batchBuffer = []; // Clear buffer
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error scanning dir:", currentDir, e);
        }
    }

    // Insert remaining files in buffer
    if (!scanState.shouldStop && batchBuffer.length > 0) {
        database.insertFilesBatch(batchBuffer, false);
        batchBuffer = [];
    }

    // Save Results to Database
    if (!scanState.shouldStop) {
        console.log(`Scan complete. Total files processed: ${totalProcessed}`);

        // Cleanup / Pruning Phase
        console.log('Syncing database with scan results...');
        try {
            const allDbPaths = database.getAllFilePaths();
            const pathsToDelete = allDbPaths.filter(p => !allScannedPaths.has(p));

            if (pathsToDelete.length > 0) {
                console.log(`Found ${pathsToDelete.length} missing files to delete.`);
                const deleteBatch = pathsToDelete.map(p => ({
                    path: p,
                    id: Buffer.from(p).toString('base64')
                }));
                database.deleteFilesBatch(deleteBatch);
                console.log('Cleanup complete.');
            } else {
                console.log('No missing files found.');
            }
        } catch (err) {
            console.error('Error during database sync/cleanup:', err);
        }


        // Final save
        database.saveDatabase();
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
    } else if (action === 'stop' || action === 'cancel') {
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
        // Query favorites from DB
        const userId = 'admin'; // Match the hardcoded ID in toggleFavorite
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
        url: `/api/file/${encodeURIComponent(f.id)}`,
        thumbnailUrl: `/api/thumb/${encodeURIComponent(f.id)}`,
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
// CACHE_DIR removed (duplicate)


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



// Helper to get video duration
async function getVideoDuration(filePath) {
    return new Promise((resolve) => {
        const child = exec(`ffmpeg -i "${filePath}"`, { timeout: 10000 }, (err, stdout, stderr) => {
            if (err && err.signal === 'SIGTERM') {
                console.warn(`[VideoDuration] Timeout extracting duration for ${filePath}`);
                resolve(0);
                return;
            }
            // ffmpeg -i always fails if no output is specified, but prints info to stderr
            const output = stderr || stdout || '';
            const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
            if (match) {
                const hours = parseFloat(match[1]);
                const minutes = parseFloat(match[2]);
                const seconds = parseFloat(match[3]);
                const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
                resolve(totalSeconds);
            } else {
                resolve(0);
            }
        });
    });
}

async function generateThumbnail(file, force = false) {

    // Switch to WebP
    // USE MD5 hash of the ID for the filename to avoid length limits and directory separator issues
    const fileId = Buffer.from(file.path).toString('base64');
    const thumbFilename = crypto.createHash('md5').update(fileId).digest('hex') + '.webp';
    const thumbPath = getCachedPath(thumbFilename, true);

    if (!force && fs.existsSync(thumbPath)) return true;


    return new Promise(async (resolve) => {
        // Determine seek time
        let seekTime = 3; // Default fallback to 3 seconds
        if (file.mediaType === 'video') {
            const duration = await getVideoDuration(file.path);
            if (duration > 0) {
                // Use 20% of video length
                seekTime = duration * 0.2;
            } else {
                // If duration retrieval failed, stick to 3s (ffmpeg handles seeking past end gracefully usually by picking last frame)
                seekTime = 3;
            }
        } else {
            seekTime = 0;
        }

        // Build FFmpeg command with HW acceleration if available
        let inputFlags = [];
        // Default filter chain: scale -> smart thumbnail selection
        // 'thumbnail=n=50': Pick representave frame from 50 frames (~2s)
        let filterChain = 'scale=300:-1,thumbnail=n=50';

        // Apply HW Acceleration Flags
        if (hwAccel.type === 'cuda') {
            inputFlags = [...hwAccel.flags];
            // CUDA: decode(gpu). We need to download for 'thumbnail' filter (CPU) usually.
            // Simplified: let ffmpeg handle transfer.
            // If we keep it simple, software filtering after HW decode works fine.
        } else if (hwAccel.type === 'vaapi') {
            inputFlags = [...hwAccel.flags];
            // VAAPI: explicit pipeline often needed.
            // decode(gpu) -> scale_vaapi(gpu) -> hwdownload -> thumbnail(cpu)
            filterChain = 'scale_vaapi=w=300:h=-2,hwdownload,format=nv12,thumbnail=n=50';
        }

        // Construct command
        // Note: For VAAPI, input flags must be BEFORE -i
        // Add -ss (seek) to input flags to apply before -i
        const flagsStr = inputFlags.join(' ');

        // Base command
        let seekPart = file.mediaType === 'video' ? `-ss ${seekTime}` : '';
        let cmd = `ffmpeg -y ${flagsStr} ${seekPart} -i "${file.path}" -vf "${filterChain}" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;

        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) {
                console.error(`[Thumb] Primary FFmpeg command failed for ${file.path}`);
                console.error(`[Thumb] Command: ${cmd}`);
                console.error(`[Thumb] Error: ${err.message}`);
                console.error(`[Thumb] Stderr: ${stderr}`);

                // If HW accel failed, retry with software only
                if (hwAccel.type !== 'none') {
                    console.warn(`[Thumb] Retrying with software fallback...`);
                    // Fallback also uses smart selection
                    const swCmd = `ffmpeg -y ${seekPart} -i "${file.path}" -vf "scale=300:-1,thumbnail=n=50" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;
                    exec(swCmd, { timeout: 20000 }, (retryErr, swStdout, swStderr) => {
                        if (retryErr) {
                            console.error(`[Thumb] Software fallback failed for ${file.path}`);
                            console.error(`[Thumb] Command: ${swCmd}`);
                            console.error(`[Thumb] Error: ${retryErr.message}`);
                            console.error(`[Thumb] Stderr: ${swStderr}`);
                            resolve(false);
                        } else {
                            if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
                                resolve(true);
                            } else {
                                console.error(`[Thumb] Software fallback success but empty file: ${thumbPath}`);
                                resolve(false);
                            }
                        }
                    });
                } else {
                    resolve(false);
                }
            } else {
                if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
                    resolve(true);
                } else {
                    console.error(`[Thumb] Primary success but empty file: ${thumbPath}`);
                    console.error(`[Thumb] Stderr: ${stderr}`);
                    resolve(false);
                }
            }
        });
    });
}

// --- Thumbnail Generation (Queue & Concurrency) ---
// Global Queue State
let thumbQueue = [];
let currentTask = null;
let isTaskProcessorRunning = false;
// thumbState is already defined below implicitly or reused? 
// Wait, thumbState is NOT global in this file scope usually? 
// Ah, let me check where thumbState is defined. It was NOT defined in the top 100 lines.
// In the previous code (Chunk 0 view), it was used inside processThumbnails AND API endpoints.
// It must be defined globally somewhere.
// Let me check line 1048 again. "thumbState.status = ...". It implies thumbState exists.
// I will search for "let thumbState".



// Helper for Concurrency
async function processFilesConcurrently(files, concurrency, onProgress, getControlState) {
    const queue = [...files];
    const activePromises = new Set();

    // Loop until all processed
    while (queue.length > 0 || activePromises.size > 0) {
        // Check Control
        const { shouldStop, shouldPause } = getControlState();
        if (shouldStop) break;

        if (shouldPause) {
            await new Promise(r => setTimeout(r, 500));
            continue;
        }

        // Fill pool
        while (queue.length > 0 && activePromises.size < concurrency) {
            const file = queue.shift();
            onProgress(file);

            const p = (async () => {
                try {
                    await generateThumbnail(file, true); // Force regenerate
                } catch (e) {
                    console.error(`Error generating thumb for ${file.path}:`, e);
                }
            })();

            // Add to set
            activePromises.add(p);

            // Remove from set when done
            p.finally(() => {
                activePromises.delete(p);
            });
        }

        // Wait for one to finish if full or queue empty but active
        if (activePromises.size >= concurrency || (queue.length === 0 && activePromises.size > 0)) {
            await Promise.race(activePromises);
        }
    }
}

// Wrapper to check control state safely
function getThumbControl() {
    return { shouldStop: thumbState.shouldStop, shouldPause: thumbState.shouldPause };
}

// Smart Scan Results Storage
let smartScanResults = {
    missing: [], // List of file objects
    error: [],   // List of file objects
    timestamp: 0
};

// Queue Processor
async function processTaskQueue() {
    if (isTaskProcessorRunning) return;
    isTaskProcessorRunning = true;

    try {
        while (thumbQueue.length > 0) {
            currentTask = thumbQueue.shift(); // Dequeue

            // Setup global state for UI
            thumbState.status = 'scanning';
            thumbState.count = 0;
            thumbState.currentPath = `Starting: ${currentTask.name}`;
            thumbState.shouldStop = false;
            thumbState.shouldPause = false;

            // Handle different task types
            if (currentTask.type === 'smart_scan') {
                thumbState.total = 4; // Phases: ReadDB, ReadCache, Analyze, Save
                console.log(`[Queue] Starting Smart Scan...`);

                // Phase 1: Read Database
                thumbState.currentPath = "Phase 1/3: Reading Database...";
                const allFiles = database.queryFiles({ offset: 0, limit: 999999, recursive: true });
                thumbState.count = 1;

                // Phase 2: Read Cache
                thumbState.currentPath = "Phase 2/3: Analyzing Cache (this may take a while)...";

                const missing = [];
                const error = [];
                const cacheSet = new Set();

                // Read cache directory (Recursive for Sharding)
                if (fs.existsSync(CACHE_DIR)) {
                    const scanDir = (dir) => {
                        const items = fs.readdirSync(dir, { withFileTypes: true });
                        for (const item of items) {
                            if (item.isDirectory()) {
                                scanDir(path.join(dir, item.name));
                            } else if (item.name.endsWith('.webp')) {
                                try {
                                    const s = fs.statSync(path.join(dir, item.name));
                                    cacheSet.add(item.name);
                                    if (s.size === 0) cacheSet.add(item.name + ":0");
                                } catch (e) { }
                            }
                        }
                    };
                    scanDir(CACHE_DIR);
                }

                thumbState.count = 2;

                // Phase 3: Analysis
                thumbState.currentPath = "Phase 3/3: Comparing...";
                thumbState.total = allFiles.length + 3; // Adjust total to track progress through files
                thumbState.count = 3;

                let processed = 0;
                for (const file of allFiles) {
                    if (thumbState.shouldStop) break;

                    if (processed % 1000 === 0) {
                        thumbState.count = 3 + processed;
                        await new Promise(r => setImmediate(r)); // Yield
                    }
                    processed++;

                    const fileId = Buffer.from(file.path).toString('base64');
                    const hash = crypto.createHash('md5').update(fileId).digest('hex') + '.webp';

                    if (!cacheSet.has(hash)) {
                        missing.push(file);
                    } else if (cacheSet.has(hash + ":0")) {
                        error.push(file); // 0-byte file
                    }
                    // Else exists and > 0 bytes
                }

                // Done
                smartScanResults = {
                    missing: missing,
                    error: error,
                    timestamp: Date.now()
                };
                console.log(`[Queue] Smart Scan Complete. Missing: ${missing.length}, Error: ${error.length}`);
                thumbState.currentPath = "Analysis Complete.";

            } else {
                // Normal Repair/Regenerate Task
                thumbState.total = currentTask.total || (currentTask.files ? currentTask.files.length : 0);

                console.log(`[Queue] Starting Task: ${currentTask.name} (${thumbState.total} files)`);

                // Determine Thread Count
                let threadCount = 2; // Default
                if (fs.existsSync(CONFIG_FILE)) {
                    try {
                        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
                        if (config.threadCount && config.threadCount > 0) threadCount = config.threadCount;
                    } catch (e) { }
                }

                // Process Files
                if (currentTask.files && currentTask.files.length > 0) {
                    await processFilesConcurrently(
                        currentTask.files,
                        threadCount,
                        (file) => {
                            thumbState.currentPath = file.path;
                            thumbState.count++;
                        },
                        getThumbControl
                    );
                }
            }

            if (thumbState.shouldStop) {
                console.log(`[Queue] Task cancelled: ${currentTask.name}`);
            } else {
                console.log(`[Queue] Task completed: ${currentTask.name}`);
            }

            // allow events
            await new Promise(r => setImmediate(r));
        }
    } catch (e) {
        console.error('[Queue] Processor fatal error:', e);
    } finally {
        isTaskProcessorRunning = false;
        currentTask = null;
        thumbState.status = 'idle';
        thumbState.currentPath = '';
    }
}

// Enqueue Helper
function enqueueTask(task) {
    // task: { id, type, name, files: [], total }
    console.log(`[Queue] Enqueuing task: ${task.name}`);
    thumbQueue.push(task);
    processTaskQueue(); // Trigger loop if idle
}

// System Scan Helper (Legacy wrapper)
function processThumbnails() {
    enqueueTask({
        id: 'system-scan-' + Date.now(),
        type: 'smart_scan', // Use smart scan for default "Process" or keep 'system_scan'?
        // The user asked for a separate entry. Let's make "Process Thumbnails" use Smart Scan?
        // Actually, legacy processThumbnails was "Check all -> Queue missing".
        // Let's leave processThumbnails as is (renamed logic) or redirect.
        // For now, I will NOT change this function signature but inside logic.
        // Wait, I replaced `processThumbnails` logic before. 
        // Let's just create a new wrapper for Smart Scan.
        name: 'System Thumbnail Scan',
        files: [], // Smart scan finds its own files
        total: 0
    });
}


// Thumb Gen API
app.get('/api/thumb-gen/status', (req, res) => {
    // Return queue summary
    const queueSummary = thumbQueue.map(t => ({ id: t.id, name: t.name, total: t.total, type: t.type }));

    res.json({
        status: thumbState.status,
        count: thumbState.count,
        total: thumbState.total,
        currentPath: thumbState.currentPath,
        currentTaskName: currentTask ? currentTask.name : null,
        queue: queueSummary
    });
});

app.post('/api/thumb-gen/start', (req, res) => {
    // Start System Scan
    processThumbnails(); // This now queues
    res.json({ success: true, message: 'System scan queued' });
});

app.post('/api/thumb-gen/control', (req, res) => {
    const { action, taskId } = req.body;

    if (action === 'pause') {
        thumbState.shouldPause = true;
    } else if (action === 'resume') {
        thumbState.shouldPause = false;
    } else if (action === 'stop' || action === 'cancel') {
        // Stops CURRENT task
        thumbState.shouldStop = true;
        thumbState.shouldPause = false;
    } else if (action === 'cancel-item') {
        // Remove specific task from queue
        if (currentTask && currentTask.id === taskId) {
            thumbState.shouldStop = true;
            thumbState.shouldPause = false;
        } else {
            thumbQueue = thumbQueue.filter(t => t.id !== taskId);
        }
    }
    res.json({ success: true, status: thumbState.status });
});

// Regenerate Endpoint (Queue Based)
app.post('/api/thumb/smart-scan', (req, res) => {
    // Queue a smart scan
    enqueueTask({
        id: 'smart-scan-' + Date.now(),
        type: 'smart_scan',
        name: 'Smart Thumbnail Scan',
        files: [],
        total: 0
    });
    res.json({ success: true, message: 'Smart scan queued' });
});

app.get('/api/thumb/smart-results', (req, res) => {
    res.json(smartScanResults);
});

app.post('/api/thumb/smart-repair', (req, res) => {
    const { repairMissing, repairError } = req.body;

    let filesToRepair = [];

    // We trust the cached results in memory for simplicity.
    // In a production app, we might want to re-validate or accept IDs passed from client.
    // For now, repair what we found.

    if (repairMissing && smartScanResults.missing.length > 0) {
        filesToRepair = [...filesToRepair, ...smartScanResults.missing];
    }
    if (repairError && smartScanResults.error.length > 0) {
        filesToRepair = [...filesToRepair, ...smartScanResults.error];
    }

    if (filesToRepair.length === 0) {
        return res.json({ success: true, message: 'No files to repair' });
    }

    enqueueTask({
        id: crypto.randomUUID(),
        type: 'folder_repair', // Use standard repair type which triggers processFilesConcurrently
        name: `Smart Repair (${filesToRepair.length} files)`,
        files: filesToRepair,
        total: filesToRepair.length
    });

    res.json({ success: true, message: 'Repair task queued' });
});

// Regenerate Endpoint (Queue Based)
app.post('/api/thumb/regenerate', async (req, res) => {
    const { id, folderPath } = req.body;

    try {
        if (id) {
            // Single File - Execute Immediately
            const filePath = Buffer.from(id, 'base64').toString('utf8');
            if (fs.existsSync(filePath)) {
                const ext = path.extname(filePath).toLowerCase();
                let mediaType = (['.mp4', '.webm', '.mov'].includes(ext)) ? 'video' : 'image';
                // We need to construct a robust file object if generateThumbnail relies on it
                // The old code passed { path, mediaType }
                await generateThumbnail({ path: filePath, mediaType, id }, true);
                return res.json({ success: true });
            }
            return res.status(404).json({ error: 'File not found' });
        }
        else if (folderPath) {
            // Batch Folder
            let targetPath = folderPath;
            if (targetPath === 'root') targetPath = MEDIA_ROOT;

            // Recursively find files
            // ensure { recursive: true } is supported by database.queryFiles (it was added in V6)
            const files = database.queryFiles({ folderPath: targetPath, limit: 99999, recursive: true });

            if (files.length === 0) {
                return res.json({ success: true, message: 'No files to regenerate.' });
            }

            const taskName = path.basename(targetPath) || 'Root';

            enqueueTask({
                id: crypto.randomUUID(),
                type: 'folder_repair',
                name: `Repair: ${taskName}`,
                files: files,
                total: files.length
            });

            res.json({ success: true, message: 'Task queued' });

        } else {
            res.status(400).json({ error: 'Missing params' });
        }

    } catch (e) {
        console.error("Regenerate Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Serve Thumbs (WebP)
// Serve Thumbs (WebP)
app.get('/api/thumb/:id', async (req, res) => {
    // Use MD5 hash of the ID to look up the file
    const thumbFilename = crypto.createHash('md5').update(req.params.id).digest('hex') + '.webp';
    const thumbPath = getCachedPath(thumbFilename);

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
            // Recursive count function
            const countRecursive = (dir) => {
                let count = 0;
                let size = 0;
                if (!fs.existsSync(dir)) return { count: 0, size: 0 };

                try {
                    const items = fs.readdirSync(dir, { withFileTypes: true });
                    for (const item of items) {
                        const fullPath = path.join(dir, item.name);
                        if (item.isDirectory()) {
                            const sub = countRecursive(fullPath);
                            count += sub.count;
                            size += sub.size;
                        } else {
                            count++;
                            try { size += fs.statSync(fullPath).size; } catch (e) { }
                        }
                    }
                } catch (e) { }
                return { count, size };
            };

            const stats = countRecursive(CACHE_DIR);
            cacheCount = stats.count;
            cacheSize = stats.size;
        }
    } catch (e) { }

    const dbStats = dbReady ? database.getStats() : { totalFiles: 0, totalImages: 0, totalVideos: 0, totalAudio: 0 };

    res.json({
        cpu: 0,
        memory: 0,
        storage: cacheSize,
        watcherActive: isWatcherActive, // This will always be false now
        mode: monitorMode,
        scanInterval: scanInterval,
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

// Monitor Control Endpoint
app.post('/api/system/monitor', (req, res) => {
    const { mode, interval, enabled } = req.body;

    try {
        let currentConfig = {};
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const content = fs.readFileSync(CONFIG_FILE, 'utf8');
                if (content.trim()) currentConfig = JSON.parse(content);
            } catch (e) { }
        }

        // Stop everything first
        stopAllMonitoring();

        let newMode = 'manual';
        let paths = currentConfig.libraryPaths || [MEDIA_ROOT];

        if (mode === 'periodic') {
            console.log(`[Monitor] Switched to Periodic (Every ${interval}m)`);
            newMode = 'periodic';
            const newInterval = interval || scanInterval || 60;
            scanInterval = newInterval;
            currentConfig.scanInterval = newInterval;
            startPeriodicScanner(paths, newInterval);
        } else {
            console.log(`[Monitor] Switched to Manual`);
            newMode = 'manual';
            // No periodic, no watcher
        }

        // Realtime is removed/ignored

        monitorMode = newMode;
        currentConfig.monitorMode = newMode;

        // Remove watcherEnabled flag as it's confusing now
        delete currentConfig.watcherEnabled;

        fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2));

        res.json({
            success: true,
            active: isWatcherActive,
            mode: monitorMode,
            scanInterval: scanInterval
        });
    } catch (e) {
        console.error("Monitor control failed:", e);
        res.status(500).json({ error: e.message });
    }
});

// Watcher control endpoint (Legacy)
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

// EXIF API
// EXIF API (Duplicate removed, see below)

app.post('/api/cache/clear', (req, res) => {
    try {
        if (fs.existsSync(CACHE_DIR)) {
            // Recursive delete of valid cache directory
            fs.rmSync(CACHE_DIR, { recursive: true, force: true });

            // Re-create the empty directory
            if (!fs.existsSync(CACHE_DIR)) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
            }
        }

        // Fix: Clear thumbnails table, not files table
        try {
            database.clearThumbnails();
            console.log("Cleared thumbnails table.");
        } catch (dbErr) {
            console.error("Failed to clear thumbnails from DB", dbErr);
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
            // Valid IDs from database
            // Note: This relies on manual filename reconstruction. 
            // Better to iterate disk.
            const allFiles = database.queryFiles({ offset: 0, limit: 999999 });
            const validIds = new Set(allFiles.map(f => {
                const b64 = Buffer.from(f.path).toString('base64');
                return crypto.createHash('md5').update(b64).digest('hex') + '.webp';
            }));

            const scanAndPrune = (dir) => {
                const items = fs.readdirSync(dir, { withFileTypes: true });
                for (const item of items) {
                    const fullPath = path.join(dir, item.name);
                    if (item.isDirectory()) {
                        scanAndPrune(fullPath);
                        // Optional: Remove empty folders
                        try {
                            if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
                        } catch (e) { }
                    } else if (item.name.endsWith('.webp')) {
                        if (!validIds.has(item.name)) {
                            fs.unlinkSync(fullPath);
                            count++;
                        }
                    }
                }
            };
            scanAndPrune(CACHE_DIR);

            console.log(`Pruned ${count} orphaned cache files.`);
        }
        res.json({ success: true, count });
    } catch (e) {
        console.error("Prune cache error", e);
        res.status(500).json({ success: false });
    }
});

// EXIF Endpoint
// EXIF Endpoint (Improved with exifr)
app.get('/api/file/:id/exif', async (req, res) => {
    try {
        const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');
        if (!fs.existsSync(filePath)) return res.json({});

        // Use exifr to parse the file (handles paths directly and is more robust)
        const tags = await exifr.parse(filePath);
        res.json(tags || {});
    } catch (e) {
        console.error('EXIF parse error:', e.message);
        res.json({});
    }
});

// Favorites Logic
// Favorites Logic (Legacy JSON) - REMOVED to use Database


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

                // Restore settings
                if (config.scanInterval) scanInterval = config.scanInterval;

                const libraryPaths = (config.libraryPaths && config.libraryPaths.length > 0)
                    ? config.libraryPaths
                    : [MEDIA_ROOT];

                // Determine mode
                if (config.monitorMode === 'periodic') {
                    console.log(`Starting periodic scanner (every ${scanInterval}m)...`);
                    monitorMode = 'periodic';
                    startPeriodicScanner(libraryPaths, scanInterval);
                    startPeriodicScanner(libraryPaths, scanInterval);
                } else {
                    monitorMode = 'manual';
                }
            }
        }
    } catch (e) {
        console.error("Failed to auto-start monitoring:", e);
    }
});