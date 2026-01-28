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
const sizeOf = require('image-size');

const app = express();
const port = process.env.PORT || 3001;

// --- Constants ---
const RAW_MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, 'media');
// Support multiple roots via ';' delimiter (cross-platform friendly config)
const MEDIA_ROOTS = RAW_MEDIA_ROOT.split(';').map(p => p.trim()).filter(p => p.length > 0 && p !== '');
const PRIMARY_MEDIA_ROOT = MEDIA_ROOTS[0]; // Backward compatibility for single-path assumptions
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const CONFIG_FILE = path.join(DATA_DIR, 'lumina-config.json');
const SECRET_FILE = path.join(DATA_DIR, 'jwt_secret.key');
const SMART_RESULTS_FILE = path.join(DATA_DIR, 'smart-results.json');
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

// --- Global Config Cache (Performance) ---
let configCache = null;
let lastConfigRead = 0;
const CONFIG_CACHE_TTL = 5000; // 5 seconds cache

function getConfig() {
    const now = Date.now();
    if (configCache && (now - lastConfigRead < CONFIG_CACHE_TTL)) {
        return configCache;
    }
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const content = fs.readFileSync(CONFIG_FILE, 'utf8');
            configCache = JSON.parse(content);
            lastConfigRead = now;
            return configCache;
        } catch (e) {
            console.error("Config read error", e);
        }
    }
    return configCache || {};
}

function updateConfig(newConfig) {
    try {
        console.log(`[Config] Saving configuration to ${CONFIG_FILE}...`);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
        configCache = newConfig;
        lastConfigRead = Date.now();
        console.log('[Config] Configuration saved successfully.');
    } catch (e) {
        console.error(`[Config] Generic Error: Failed to save config file at ${CONFIG_FILE}`, e);
        throw e; // Re-throw to let API know
    }
}

// --- Global Cache Stats (Performance) ---
// Avoid blocking the event loop on every status request
let globalCacheCount = 0;
let globalCacheSize = 0;
let lastCacheUpdate = 0;

function updateGlobalCacheStats() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return;

        let count = 0;
        let size = 0;

        const countRecursive = (dir) => {
            const items = fs.readdirSync(dir, { withFileTypes: true });
            for (const item of items) {
                const fullPath = path.join(dir, item.name);
                if (item.isDirectory()) {
                    countRecursive(fullPath);
                } else if (item.isFile() && item.name.endsWith('.webp')) {
                    count++;
                    try { size += fs.statSync(fullPath).size; } catch (e) { }
                }
            }
        };

        console.log('[System] Start background cache stats update...');
        countRecursive(CACHE_DIR);
        globalCacheCount = count;
        globalCacheSize = size;
        lastCacheUpdate = Date.now();
        console.log(`[System] Cache stats updated: ${count} files, ${globalCacheSize} bytes`);
    } catch (e) {
        console.error("[System] Failed to update cache stats", e);
    }
}

// Schedule updates
setTimeout(updateGlobalCacheStats, 2000); // 2s after start
setInterval(updateGlobalCacheStats, 10 * 60 * 1000); // map every 10 mins

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

// (Static files middleware moved down after API routes)

// --- Auth Middleware ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Fallback: Check query parameter (for img/video src)
    if (!token && req.query.token) {
        // Fix: backend might receive multiple token params if frontend appends duplicates
        const qToken = req.query.token;
        token = Array.isArray(qToken) ? qToken[qToken.length - 1] : qToken;
    }

    if (!token) return res.sendStatus(401); // Unauthorized

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403); // Forbidden
        req.user = user;
        next();
    });
}

function adminOnly(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        return next();
    }

    // Special case: If the system has no users yet, allow POST /api/config to create the first admin
    if (req.path === '/api/config' && req.method === 'POST') {
        // If no config file, system is unconfigured or has no users
        const config = getConfig();
        if (!config.users || config.users.length === 0) {
            return next();
        }
    }

    res.status(403).json({ error: 'Admin access required' });
}

// --- Auth Endpoints ---
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    // Read config to find user
    const config = getConfig();
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

    // Default/Fallback Admin logic (if no config exists yet, maybe allow setup?)
    // But here we just reject.
    res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/auth/wallpaper-token', authenticateToken, (req, res) => {
    const config = getConfig();
    const user = config.users?.find(u => u.username === req.user.username);
    res.json({
        token: user?.wallpaperToken || '',
        config: user?.wallpaperConfig || { mode: 'random', path: '', interval: 30, showInfo: true, showVideos: true }
    });
});

app.post('/api/auth/wallpaper-token', authenticateToken, (req, res) => {
    // Generate a long-lived token (approx 10 years) for wallpaper access
    const token = jwt.sign(
        {
            username: req.user.username,
            role: req.user.role,
            isWallpaper: true
        },
        JWT_SECRET,
        { expiresIn: '3650d' }
    );

    // Persist to config.json
    try {
        const { wallpaperConfig } = req.body;
        const config = getConfig();
        const userIndex = config.users?.findIndex(u => u.username === req.user.username);
        if (userIndex !== -1 && userIndex !== undefined) {
            config.users[userIndex].wallpaperToken = token;
            if (wallpaperConfig) {
                config.users[userIndex].wallpaperConfig = wallpaperConfig;
            }
            updateConfig(config);
        }
    } catch (e) {
        console.error("Failed to persist wallpaper token/config", e);
    }

    res.json({ token });
});

// Watcher State
let monitorMode = 'manual'; // 'manual' | 'periodic'
let scanInterval = 60; // Minutes
let periodicIntervalId = null;
let scanState = {
    status: 'idle',
    count: 0,
    currentPath: '',
    shouldStop: false,
    shouldPause: false
};
// Watcher state variables removed.
// let isWatcherActive = false;
// let watcher = null;
// let watcherLogs = [];
// const MAX_LOGS = 50;

// Debounce state for file changes (No longer used without watcher)
let pendingChanges = new Map(); // path -> timeout
const DEBOUNCE_DELAY = 500; // ms

// --- Helper Functions ---
// --- Helper Functions ---
function getUserLibraryPaths(user) {
    if (!user) return [];
    const config = getConfig();
    const foundUser = (config.users || []).find(u => u.username === user.username);

    // Admin fallback to global libraryPaths
    // FIX: Admin should always see global config prioritized over legacy 'allowedPaths'
    if (user.isAdmin || user.role === 'admin' || (foundUser && foundUser.isAdmin)) {
        return (config.libraryPaths && config.libraryPaths.length > 0) ? config.libraryPaths : MEDIA_ROOTS.map(p => path.resolve(p));
    }

    // Prioritize user-specific allowedPaths (only for non-admins)
    if (foundUser && foundUser.allowedPaths && foundUser.allowedPaths.length > 0) {
        return foundUser.allowedPaths;
    }

    // Regular User fallback (JWT payload)
    return user.allowedPaths || [];
}

function checkFileAccess(user, filePath) {
    if (!user) return false;
    const config = getConfig();
    const foundUser = (config.users || []).find(u => u.username === user.username);

    // Admin check
    if (user.isAdmin || user.role === 'admin' || (foundUser && foundUser.isAdmin)) return true;

    // For non-admins, check allowedPaths
    const allowedPaths = getUserLibraryPaths(user);
    if (allowedPaths.length === 0) return false;

    const normalizedFile = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
    return allowedPaths.some(p => {
        const normalizedAllowed = path.resolve(p).replace(/\\/g, '/').toLowerCase();
        return normalizedFile.startsWith(normalizedAllowed);
    });
}

// Helper to recursively count cached files
function countCachedFiles(dir = CACHE_DIR) {
    let count = 0;
    if (!fs.existsSync(dir)) return 0;
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            if (item.isDirectory()) {
                count += countCachedFiles(path.join(dir, item.name));
            } else if (item.isFile() && item.name.endsWith('.webp')) {
                count++;
            }
        }
    } catch (e) {
        // Ignore errors during counting (e.g. permission or locking)
    }
    return count;
}

function rebuildFolderStats() {
    console.log("Rebuilding folder stats...");
}

function getSubfolders(dir) {
    if (!fs.existsSync(dir)) return [];
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        return items
            .filter(item => item.isDirectory() && !item.name.startsWith('.'))
            .map(item => path.join(dir, item.name));
    } catch (e) {
        console.error("Error reading subfolders:", e);
        return [];
    }
}

function findCoverMedia(folderPath) {
    try {
        if (!fs.existsSync(folderPath)) return null;
        const items = fs.readdirSync(folderPath, { withFileTypes: true });

        // 1. Try to find an image first
        const image = items.find(i => i.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(i.name));
        if (image) return { path: path.join(folderPath, image.name), type: 'image', name: image.name };

        // 2. Try to find a video
        const video = items.find(i => i.isFile() && /\.(mp4|mov|webm)$/i.test(i.name));
        if (video) return { path: path.join(folderPath, video.name), type: 'video', name: video.name };

        // 3. Recursive search in subdirectories
        const subdirs = items.filter(i => i.isDirectory() && !i.name.startsWith('.'));
        for (const subdir of subdirs) {
            const found = findCoverMedia(path.join(folderPath, subdir.name));
            if (found) return found;
        }
    } catch (e) {
        console.error("findCoverMedia error:", e);
    }
    return null;
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

// --- Security Barrier ---
app.use((req, res, next) => {
    // Only protect /api routes
    if (!req.path.startsWith('/api')) return next();

    // 1. Soft Authenticate (Try to set req.user if token is present)
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Fallback: Check query parameter
    if (!token && req.query.token) {
        const qToken = req.query.token;
        token = Array.isArray(qToken) ? qToken[qToken.length - 1] : qToken;
    }

    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) {
                // Enrich user object with latest config data (role/allowedPaths)
                const config = getConfig();
                const foundUser = (config.users || []).find(u => u.username === user.username);
                if (foundUser) {
                    req.user = {
                        ...user,
                        isAdmin: foundUser.isAdmin,
                        allowedPaths: foundUser.allowedPaths || [],
                        role: foundUser.isAdmin ? 'admin' : 'user'
                    };
                } else {
                    req.user = user;
                }
            }
            checkPath();
        });
    } else {
        checkPath();
    }

    function checkPath() {
        // 2. Whitelist
        const whitelist = [
            '/api/auth',
            '/api/video/stream',
            '/api/config', // GET /api/config is allowed for init checks
            '/api/fs/list'  // Allow browsing for setup/config
        ];

        // If it's a whitelisted path (exact or startsWith for sub-routes like /api/auth/)
        if (whitelist.some(p => req.path === p || req.path.startsWith(p + '/'))) {
            // Special case: Config POST still needs protection UNLESS it's the bootstrap case
            // Bootstrap case is handled by adminOnly and the logic below
            if (req.path === '/api/config' && req.method === 'POST' && !req.user) {
                // Check if system is unconfigured
                const config = getConfig();
                if (config.users && config.users.length > 0) {
                    return res.status(401).json({ error: 'Auth required for this operation' });
                }
            }
            return next();
        }

        // 3. Final Auth Enforce
        if (!req.user) return res.sendStatus(401);
        next();
    }
});

// --- API Endpoints ---

// Config API
app.get('/api/config', (req, res) => {
    const config = getConfig();
    if (Object.keys(config).length === 0) {
        return res.json({ configured: false });
    }

    // Scenario 1: Admin User (Full Config)
    if (req.user && (req.user.isAdmin || req.user.role === 'admin')) {
        const sanitizedConfig = JSON.parse(JSON.stringify(config));
        if (sanitizedConfig.users) {
            sanitizedConfig.users = sanitizedConfig.users.map(u => {
                const { password, ...safeUser } = u;
                return safeUser;
            });
        }
        return res.json(sanitizedConfig);
    }

    // Scenario 2: Regular User (Sanitized Config)
    if (req.user) {
        const currentUser = (config.users || []).find(u => u.username === req.user.username);
        if (currentUser) {
            const { password, ...safeUser } = currentUser;
            return res.json({
                configured: true,
                libraryPaths: safeUser.libraryPaths || [],
                homeSettings: safeUser.homeSettings || {},
                role: 'user',
                username: safeUser.username,
                title: config.title || 'Luvia Gallery'
            });
        }
    }

    // Scenario 3: Anonymous/Login stage (Public Info)
    return res.json({
        configured: true,
        title: config.title || 'Luvia Gallery',
        users: (config.users || []).map(u => ({ username: u.username, isAdmin: u.isAdmin }))
    });
});

app.post('/api/config', adminOnly, (req, res) => {
    const currentConfig = getConfig();
    const oldPaths = currentConfig.libraryPaths || [];
    const newPaths = req.body.libraryPaths || [];
    const normalizedBody = { ...req.body };
    console.log('[DEBUG] POST /api/config received libraryPaths:', newPaths);

    // CRITICAL FIX: The frontend sends users without passwords (sanitized).
    // We must merge with existing passwords to avoid wiping them.
    if (normalizedBody.users && Array.isArray(normalizedBody.users) && currentConfig.users) {
        normalizedBody.users = normalizedBody.users.map(newUser => {
            const existingUser = currentConfig.users.find(u => u.username === newUser.username);
            if (existingUser) {
                return {
                    ...existingUser,
                    ...newUser,
                    password: newUser.password || existingUser.password,
                    isAdmin: newUser.isAdmin !== undefined ? !!newUser.isAdmin : !!existingUser.isAdmin,
                    allowedPaths: newUser.allowedPaths !== undefined ? newUser.allowedPaths : (existingUser.allowedPaths || [])
                };
            }
            return newUser;
        });
    }

    const newConfig = {
        ...currentConfig,
        ...normalizedBody,
    };

    try {
        updateConfig(newConfig);
    } catch (e) {
        console.error('[API] Config save failed:', e);
        return res.status(500).json({ error: 'Failed to save configuration', details: e.message });
    }

    // Detect and cleanup removed paths (Admin operation)
    const removedPaths = oldPaths.filter(p => !newPaths.includes(p));
    if (removedPaths.length > 0) {
        console.log("Removing data for deleted paths:", removedPaths);
        try {
            // FIX: Removed direct db.prepare call since db is not exported
            // Use simple iteration instead of transaction
            for (const p of removedPaths) {
                // Normalize path string to match how it was stored
                let cleanSource = p.trim();
                if (cleanSource.length > 1 && cleanSource.endsWith('/')) cleanSource = cleanSource.slice(0, -1);
                if (cleanSource.length > 1 && cleanSource.endsWith('\\')) cleanSource = cleanSource.slice(0, -1);

                const sourceId = `nas-${Buffer.from(cleanSource).toString('base64')}`;
                database.deleteFilesBySourceId(sourceId);
            }
            rebuildFolderStats();
        } catch (e) {
            console.error("Failed to cleanup DB:", e);
        }
    }

    res.json({ success: true });
});

app.get('/api/library/folders', (req, res) => {
    const favoritesOnly = req.query.favorites === 'true';
    const userId = req.user.username;
    const isAdmin = req.user.role === 'admin';

    const userLibraryPaths = getUserLibraryPaths(req.user);
    if (userLibraryPaths.length === 0) return res.json([]);

    // Check if the current requested path (if any) is allowed
    // Note: LibraryFolders root request has no path, sub-folders are processed in frontend usually.
    // However, if we filter here, we provide data isolation.

    if (favoritesOnly) {
        // Return favorite folders
        if (!dbReady) {
            return res.status(503).json({ error: 'Database not ready' });
        }

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

            let lastModified = 0;
            try {
                lastModified = fs.statSync(folderPath).mtimeMs;
            } catch (e) { }

            return {
                name: path.basename(folderPath),
                path: folderPath,
                mediaCount: mediaCount,
                coverMedia: coverMedia,
                lastModified
            };
        });

        return res.json({ folders });
    }

    // Normal folder browsing (non-favorites)
    // Decode if it came from encoded param
    let parentPath = req.query.parentPath || req.query.parent;
    const isRootRequest = !parentPath || parentPath === 'root' || parentPath === '/';

    // If client passes "root" or "/", treat as root request
    // If it's a root request, we need to decide what to show
    let subs = [];

    if (isRootRequest) {
        console.log(`[DEBUG] Root folder request. User: ${req.user?.username}, Admin: ${isAdmin}`);
        if (userLibraryPaths.length > 0) {
            // If we have specific library paths configured, ONLY show those
            subs = userLibraryPaths;
            console.log(`[DEBUG] Showing user library paths: ${JSON.stringify(subs)}`);
        } else if (isAdmin) {
            // Fallback to MEDIA_ROOTS if no config AND is admin
            subs = MEDIA_ROOTS;
            console.log(`[DEBUG] Root request: Admin/No User Config, showing MEDIA_ROOTS: ${subs.join(', ')}`);
        } else {
            // Non-admin with no config sees NOTHING
            subs = [];
            console.log(`[DEBUG] No access/config, showing empty.`);
        }
    } else {
        // Not root, just get subfolders of the requested parent
        const resolvedPath = path.resolve(parentPath);

        // Security Check: Is user allowed to browse this folder?
        if (!isAdmin) {
            const isAllowed = userLibraryPaths.some(lp => {
                const lpResolved = path.resolve(lp);
                return resolvedPath === lpResolved || resolvedPath.startsWith(lpResolved + path.sep) || resolvedPath.startsWith(lpResolved + '/');
            });

            if (!isAllowed) {
                console.log(`[Security] User ${userId} blocked from browsing: ${resolvedPath}`);
                return res.status(403).json({ error: "Access denied to this folder" });
            }
        }

        console.log(`[DEBUG] /api/library/folders request. mappedPath: ${parentPath}`);
        let rawSubs = getSubfolders(parentPath);

        // Security/Scope Check:
        if (userLibraryPaths.length > 0) {
            // Filter rawSubs
            subs = rawSubs.filter(subPath => {
                // Check 1: Is subPath inside any libraryPath?
                const isDescendant = userLibraryPaths.some(lp => subPath.startsWith(lp));
                if (isDescendant) return true;

                // Check 2: Is subPath on the way to any libraryPath?
                const isAncestor = userLibraryPaths.some(lp => lp.startsWith(subPath));
                if (isAncestor) return true;

                return false;
            });
        } else if (isAdmin) {
            subs = rawSubs;
        } else {
            subs = []; // Normal user with no library paths assigned sees nothing
        }
    }

    const favoriteIds = database.getFavoriteIds(userId);
    const favoriteFolders = new Set(favoriteIds.folders || []);

    const folders = subs.map(sub => {
        let coverMedia = null;
        let mediaCount = 0;
        let lastModified = 0;

        try {
            const stats = fs.statSync(sub);
            lastModified = stats.mtimeMs;

            // Count media files (non-recursive)
            const items = fs.readdirSync(sub, { withFileTypes: true });
            mediaCount = items.filter(i => i.isFile() && /(jpg|jpeg|png|webp|mp4|mov|webm)$/i.test(i.name)).length;

            // Find cover media
            const found = findCoverMedia(sub);
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
            name: path.basename(sub),
            path: sub,
            mediaCount,
            coverMedia,
            lastModified,
            isFavorite: favoriteFolders.has(sub)
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
    if (!queryPath) queryPath = PRIMARY_MEDIA_ROOT;

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
// (Moved to bottom with Range request support and Security checks)

// Old thumb endpoint removed - handled below


// --- Scanning Logic ---

async function processScan() {
    // Non-blocking yield to allow API response
    await new Promise(r => setImmediate(r));

    console.log('Starting processScan...');
    scanState.status = 'scanning';
    scanState.shouldStop = false;

    let libraryPaths = MEDIA_ROOTS;
    const config = getConfig();
    if (config.libraryPaths && config.libraryPaths.length > 0) {
        libraryPaths = config.libraryPaths;
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
    if (!dbReady) {
        return res.json({ status: 'initializing', count: 0, total: 0, mediaStats: {}, cacheCount: 0 });
    }

    try {
        // Return sanitized status for non-admins to prevent crash but hide internal details
        if (!req.user || (req.user.role !== 'admin' && !req.user.isAdmin)) {
            return res.json({
                status: 'idle',
                count: 0,
                currentPath: '',
                total: 0,
                mediaStats: { images: 0, videos: 0, audio: 0, totalFiles: 0 }, // Empty stats
                cacheCount: 0,
                totalItems: 0
            });
        }

        const stats = database.getStats();
        res.json({
            status: scanState.status,
            count: scanState.count,
            currentPath: scanState.currentPath,
            total: stats.totalFiles,
            mediaStats: {
                images: stats.totalImages,
                videos: stats.totalVideos,
                audio: stats.totalAudio,
                totalFiles: stats.totalFiles
            },
            storage: globalCacheSize,
            cacheCount: globalCacheCount,
            totalItems: stats.totalFiles
        });
    } catch (e) {
        console.error("[Scan Status] Error:", e);
        res.status(500).json({ error: "Status check failed" });
    }
});

app.post('/api/scan/start', adminOnly, (req, res) => {
    // Set status synchronously to prevent UI from seeing 'idle' in the next poll
    scanState.status = 'scanning';
    scanState.shouldPause = false;
    scanState.shouldStop = false;
    scanState.count = 0;

    // Start Async
    processScan();

    res.json({ success: true });
});

app.post('/api/scan/control', adminOnly, (req, res) => {
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
    const random = req.query.random === 'true';
    const recursive = req.query.recursive === 'true';
    const sortOption = req.query.sort || 'dateDesc';
    const mediaType = req.query.mediaType;
    const excludeMediaType = req.query.excludeMediaType;
    let folderPath = req.query.folder;

    // Handle root path mapping for folder filter
    if (req.query.folder !== undefined) {
        if (!folderPath || folderPath === 'root' || folderPath === '/') {
            folderPath = PRIMARY_MEDIA_ROOT;
        }
    }

    let files, total;
    const userId = req.user.username;
    const isAdmin = req.user.role === 'admin';

    const userLibraryPaths = getUserLibraryPaths(req.user);

    const sortArray = (arr) => {
        if (!Array.isArray(arr)) return arr;
        switch (sortOption) {
            case 'dateAsc':
                return [...arr].sort((a, b) => (a.lastModified || 0) - (b.lastModified || 0));
            case 'nameAsc':
                return [...arr].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
            case 'nameDesc':
                return [...arr].sort((a, b) => (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' }));
            case 'dateDesc':
            default:
                return [...arr].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
        }
    };

    if (favoritesOnly) {
        // Query favorites from DB
        if (recursive) {
            // Recursive mode: Favorite files + All files in favorite folders
            console.log('[Favorites Carousel] Recursive mode enabled');

            // 1. Get directly favorited files
            const favoriteFiles = database.queryFavoriteFiles(userId, { offset: 0, limit: 999999 });

            // 2. Get all favorite folder paths
            const favoriteIds = database.getFavoriteIds(userId);
            const favoriteFolderPaths = favoriteIds.folders || [];

            console.log(`[Favorites Carousel] Found ${favoriteFiles.length} favorite files and ${favoriteFolderPaths.length} favorite folders`);

            // 3. Recursively get all files from favorite folders
            let folderFiles = [];
            for (const folderPath of favoriteFolderPaths) {
                try {
                    // Security check: ensure folder is within user's allowed paths
                    let canAccess = isAdmin;
                    if (!canAccess && userLibraryPaths.length > 0) {
                        const resolvedPath = path.resolve(folderPath);
                        canAccess = userLibraryPaths.some(lp => {
                            const resolvedLp = path.resolve(lp);
                            return resolvedPath === resolvedLp ||
                                resolvedPath.startsWith(resolvedLp + path.sep) ||
                                resolvedPath.startsWith(resolvedLp + '/');
                        });
                    }

                    if (canAccess) {
                        const files = database.queryFiles({
                            folderPath: path.resolve(folderPath),
                            offset: 0,
                            limit: 999999,
                            userId,
                            recursive: true, // Enable recursive scanning
                            allowedPaths: isAdmin ? null : userLibraryPaths
                        });
                        folderFiles = folderFiles.concat(files);
                        console.log(`[Favorites Carousel] Folder ${folderPath}: ${files.length} files`);
                    } else {
                        console.log(`[Favorites Carousel] Skipping unauthorized folder: ${folderPath}`);
                    }
                } catch (e) {
                    console.error(`[Favorites Carousel] Error querying folder ${folderPath}:`, e);
                }
            }

            // 4. Merge and deduplicate (by id or path)
            const allFiles = [...favoriteFiles, ...folderFiles];
            const uniqueFilesMap = new Map();
            allFiles.forEach(f => {
                if (!uniqueFilesMap.has(f.id)) {
                    uniqueFilesMap.set(f.id, f);
                }
            });

            const uniqueFiles = Array.from(uniqueFilesMap.values());
            console.log(`[Favorites Carousel] Total unique files after merge: ${uniqueFiles.length}`);

            // 5. Apply filters (mediaType, excludeMediaType, random)
            let filteredFiles = uniqueFiles;

            if (mediaType) {
                const types = Array.isArray(mediaType) ? mediaType : [mediaType];
                filteredFiles = filteredFiles.filter(f => types.includes(f.mediaType));
            }

            if (excludeMediaType) {
                const excludeTypes = Array.isArray(excludeMediaType) ? excludeMediaType : [excludeMediaType];
                filteredFiles = filteredFiles.filter(f => !excludeTypes.includes(f.mediaType));
            }

            // Ensure favorites are marked for downstream filters/clients
            filteredFiles = filteredFiles.map(f => ({ ...f, isFavorite: true }));

            if (random) {
                // Shuffle array using Fisher-Yates
                for (let i = filteredFiles.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [filteredFiles[i], filteredFiles[j]] = [filteredFiles[j], filteredFiles[i]];
                }
            } else {
                filteredFiles = sortArray(filteredFiles);
            }

            // 6. Apply pagination
            total = filteredFiles.length;
            files = filteredFiles.slice(offset, offset + limit);

            console.log(`[Favorites Carousel] Returning ${files.length} files (total: ${total})`);
        } else {
            // Non-recursive mode: Only directly favorited files
            files = database.queryFavoriteFiles(userId, { offset, limit });
            total = database.countFavoriteFiles(userId);
        }
    } else {
        const userLibraryPaths = getUserLibraryPaths(req.user);

        // Security Guard: If non-admin has no allowed paths, they see nothing.
        // This prevents "allow everything" behavior if logic below is flawed.
        if (!isAdmin && userLibraryPaths.length === 0) {
            files = [];
            total = 0;
        } else {
            let isBasePathValid = true;

            if (userLibraryPaths.length > 0 && folderPath) {
                const resolvedPath = path.resolve(folderPath);
                const isDescendantOrEqual = userLibraryPaths.some(lp => {
                    const resolvedLp = path.resolve(lp);
                    return resolvedPath === resolvedLp || resolvedPath.startsWith(resolvedLp + path.sep) || resolvedPath.startsWith(resolvedLp + '/');
                });

                if (!isDescendantOrEqual) {
                    isBasePathValid = false;
                    console.log(`[Security] Blocking file listing for unauthorized path: ${resolvedPath}`);
                }
            } else if (!isAdmin && !folderPath) {
                // If requesting a global view (random, recent) and not admin, must constrain to user's paths
                // queryFiles needs update to support multiple paths constraint or we just filter results?
                // Better: constraint in DB.
            }

            if (!isBasePathValid) {
                files = [];
                total = 0;
            } else {
                // Query database normally
                const queryOptions = { offset, limit, random, recursive, mediaType, excludeMediaType, userId };

                if (folderPath) {
                    queryOptions.folderPath = path.resolve(folderPath);
                } else if (!isAdmin) {
                    // If no specific folder and not admin, ALWAYS apply path constraints
                    queryOptions.allowedPaths = userLibraryPaths;
                }

                files = database.queryFiles({ ...queryOptions, sortOption });
                total = database.countFiles({
                    folderPath: folderPath ? path.resolve(folderPath) : null,
                    recursive,
                    allowedPaths: (!folderPath && !isAdmin) ? userLibraryPaths : null
                });
            }
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
        sourceId: f.sourceId,
        isFavorite: f.isFavorite, // Pass through
        width: f.thumb_width,           // ✨ NEW
        height: f.thumb_height,         // ✨ NEW
        aspectRatio: f.thumb_aspect_ratio // ✨ NEW
    }));

    res.json({
        files: transformedFiles,
        total: total,
        hasMore: offset + limit < total,
        sources: [{ id: 'local', name: 'Local Storage', count: total }]
    });
});

app.post('/api/favorites/toggle', (req, res) => {
    const { id, type } = req.body;
    const userId = req.user.username;
    try {
        // Strict ID toggle. Frontend must send Base64 ID.
        const newStatus = database.toggleFavorite(userId, id, type || 'file');
        res.json({ success: true, isFavorite: newStatus });
    } catch (e) {
        console.error("Toggle Fav Error:", e);
        res.status(500).json({ error: e.message });
    }
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
                // Check for 'scale_cuda' filter as a secondary confirmation of functional support
                exec('ffmpeg -filters', (filterErr, filterStdout) => {
                    const hasCudaFilter = filterStdout && filterStdout.includes('scale_cuda');
                    console.log(`FFmpeg CUDA filters: ${hasCudaFilter ? 'Available (scale_cuda found)' : 'Not found'}`);

                    const testCmd = 'ffmpeg -init_hw_device cuda=cuda:0 -f null -';
                    exec(testCmd, (testErr, testStdout, testStderr) => {
                        const stderrOutput = testStderr || '';
                        // If it says "no stream", it usually means it finished command processing AFTER initializing the device successfully
                        const initializedSuccess = !testErr || stderrOutput.includes('Output file #0 does not contain any stream');

                        if (initializedSuccess) {
                            console.log('Hardware Acceleration: NVIDIA CUDA detected and verified.');
                            hwAccel.type = 'cuda';
                            hwAccel.flags = ['-hwaccel', 'cuda'];
                            resolve();
                        } else {
                            console.warn(`Hardware Acceleration: NVIDIA CUDA initialization (cuda:0) failed: ${stderrOutput || testErr.message}`);

                            // Try generic device as fallback
                            exec('ffmpeg -init_hw_device cuda -f null -', (retryErr, retryStdout, retryStderr) => {
                                const retryStderrOutput = retryStderr || '';
                                if (!retryErr || retryStderrOutput.includes('Output file #0 does not contain any stream')) {
                                    console.log('Hardware Acceleration: NVIDIA CUDA detected and verified (via generic device).');
                                    hwAccel.type = 'cuda';
                                    hwAccel.flags = ['-hwaccel', 'cuda'];
                                } else {
                                    console.error(`Hardware Acceleration: NVIDIA CUDA critical failure. Stderr: ${retryStderrOutput}`);
                                }
                                resolve();
                            });
                        }
                    });
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

/**
 * Extract thumbnail dimensions
 * @param {string} thumbPath - Path to thumbnail file
 * @returns {{width: number, height: number, aspectRatio: number}|null}
 */
function extractThumbnailDimensions(thumbPath) {
    try {
        const dimensions = sizeOf(thumbPath);
        return {
            width: dimensions.width,
            height: dimensions.height,
            aspectRatio: dimensions.width / dimensions.height
        };
    } catch (error) {
        console.error(`[DimExtract] Failed to read ${thumbPath}:`, error.message);
        return null;
    }
}

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

        // Build FFmpeg command with HW acceleration if available (Videos only)
        // ✨ INCREASED robustness: larger probe size and ignore errors
        let inputFlags = ['-probesize', '32M', '-analyzeduration', '16M', '-err_detect', 'ignore_err'];
        let filterChain = 'scale=300:-1';

        if (file.mediaType === 'video') {
            filterChain += ',thumbnail=n=50';

            // Apply HW Acceleration Flags
            if (hwAccel.type === 'cuda') {
                inputFlags = [...inputFlags, ...hwAccel.flags];
            } else if (hwAccel.type === 'vaapi') {
                inputFlags = [...inputFlags, ...hwAccel.flags];
                filterChain = 'scale_vaapi=w=300:h=-2,hwdownload,format=nv12,thumbnail=n=50';
            }
        }

        const flagsStr = inputFlags.join(' ');
        let seekPart = file.mediaType === 'video' ? `-ss ${seekTime}` : '';

        // Robustness: For videos, use "Output Seeking" (place -ss after -i) to ensure bitstream headers
        // are parsed correctly from the start. Fixes AV1 temporal unit errors in older FFmpeg.
        let cmd = `ffmpeg -y ${flagsStr} -i "${file.path}" ${seekPart} -vf "${filterChain}" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;

        const runFfmpeg = (command, timeoutMs) => {
            return new Promise((resolveExec) => {
                exec(command, { timeout: timeoutMs }, (err, stdout, stderr) => {
                    resolveExec({ err, stdout, stderr });
                });
            });
        };

        const updateDbWithDimensions = (thumbFilePath, filePayload) => {
            try {
                const dimensions = extractThumbnailDimensions(thumbFilePath);
                if (dimensions) {
                    database.upsertFile({
                        id: filePayload.id,
                        path: filePayload.path,
                        name: filePayload.name,
                        folderPath: filePayload.folderPath,
                        size: filePayload.size,
                        type: filePayload.type,
                        mediaType: filePayload.mediaType,
                        lastModified: filePayload.lastModified,
                        sourceId: filePayload.sourceId,
                        thumb_width: dimensions.width,
                        thumb_height: dimensions.height,
                        thumb_aspect_ratio: dimensions.aspectRatio
                    });
                    return dimensions;
                }
            } catch (e) {
                console.error(`[Thumb] DB update error:`, e);
            }
            return null;
        };

        // Execution Logic with Fallbacks
        let result = await runFfmpeg(cmd, 15000);

        if (result.err) {
            console.error(`[Thumb] Primary FFmpeg command failed for ${file.path}`);
            // Fallback 1: Try software-only at original seek point
            if (hwAccel.type !== 'none' || file.mediaType === 'video') {
                console.warn(`[Thumb] Retrying with software fallback (seeking)...`);
                const swFilterChain = file.mediaType === 'video' ? 'scale=300:-1,thumbnail=n=50' : 'scale=300:-1';
                const swCmd = `ffmpeg -y -probesize 32M -analyzeduration 16M -err_detect ignore_err -i "${file.path}" ${seekPart} -vf "${swFilterChain}" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;
                result = await runFfmpeg(swCmd, 20000);
            }

            // Fallback 2: If video seek point failed, try seeking to 0 (Ultra safe)
            if (result.err && file.mediaType === 'video') {
                console.warn(`[Thumb] Retrying with software fallback (frame 0)...`);
                const safeCmd = `ffmpeg -y -probesize 32M -analyzeduration 16M -err_detect ignore_err -i "${file.path}" -vf "scale=300:-1" -vcodec libwebp -q:v 50 -frames:v 1 "${thumbPath}"`;
                result = await runFfmpeg(safeCmd, 10000);
            }
        }

        // Check final result
        if (!result.err && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
            const dims = updateDbWithDimensions(thumbPath, file);
            if (dims) {
                console.log(`[Thumb] Success: ${file.name} (${dims.width}x${dims.height})`);
            }
            resolve(true);
        } else {
            if (result.err) console.error(`[Thumb] All fallbacks failed for ${file.path}. Stderr: ${result.stderr}`);
            resolve(false);
        }
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

function saveSmartResults() {
    try {
        fs.writeFileSync(SMART_RESULTS_FILE, JSON.stringify(smartScanResults, null, 2));
    } catch (e) {
        console.error('[SmartScan] Failed to save results:', e);
    }
}

function loadSmartResults() {
    if (fs.existsSync(SMART_RESULTS_FILE)) {
        try {
            const data = fs.readFileSync(SMART_RESULTS_FILE, 'utf8');
            smartScanResults = JSON.parse(data);
            console.log(`[SmartScan] Loaded ${smartScanResults.missing.length + smartScanResults.error.length} results from disk.`);
        } catch (e) {
            console.error('[SmartScan] Failed to load results:', e);
        }
    }
}

// Load on init (moved down to after definition)

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
            if (currentTask.type === 'dimension_extract') {
                // ✨ NEW: Extract dimensions from existing thumbnails
                console.log(`[Queue] Starting Dimension Extract...`);

                // Phase 1: Load all files  
                thumbState.currentPath = "Phase 1/3: Loading database records...";
                const allFiles = database.queryFiles({
                    offset: 0,
                    limit: 999999,
                    recursive: true
                });
                thumbState.total = allFiles.length;
                thumbState.count = 0;

                let processedCount = 0;
                let successCount = 0;
                let skipCount = 0;

                // Phase 2: Process files
                thumbState.currentPath = "Phase 2/3: Extracting dimensions...";

                for (const file of allFiles) {
                    // Check control signals
                    if (thumbState.shouldStop) break;

                    // Pause check
                    while (thumbState.shouldPause && !thumbState.shouldStop) {
                        await new Promise(r => setTimeout(r, 500));
                    }

                    processedCount++;
                    thumbState.count = processedCount;

                    // Update progress display
                    if (processedCount % 100 === 0) {
                        thumbState.currentPath = `Extracting: ${file.name}`;
                        await new Promise(r => setImmediate(r));
                    }

                    // Skip files that already have dimensions
                    if (file.thumb_width && file.thumb_height) {
                        skipCount++;
                        continue;
                    }

                    // Calculate thumbnail path
                    const fileId = Buffer.from(file.path).toString('base64');
                    const thumbFilename = crypto.createHash('md5').update(fileId).digest('hex') + '.webp';
                    const thumbPath = getCachedPath(thumbFilename);

                    // Check if thumbnail exists
                    if (!fs.existsSync(thumbPath)) {
                        continue;
                    }

                    // Extract dimensions
                    const dimensions = extractThumbnailDimensions(thumbPath);

                    if (dimensions) {
                        // Update database
                        try {
                            database.upsertFile({
                                id: file.id,
                                path: file.path,
                                name: file.name,
                                folderPath: file.folderPath,
                                size: file.size,
                                type: file.type,
                                mediaType: file.mediaType,
                                lastModified: file.lastModified,
                                sourceId: file.sourceId,
                                thumb_width: dimensions.width,
                                thumb_height: dimensions.height,
                                thumb_aspect_ratio: dimensions.aspectRatio
                            });
                            successCount++;
                        } catch (dbErr) {
                            console.error(`[DimExtract] DB update failed for ${file.id}:`, dbErr);
                        }
                    }

                    // Save database periodically
                    if (processedCount % 1000 === 0) {
                        database.saveDatabase();
                        console.log(`[DimExtract] Progress: ${processedCount}/${allFiles.length} (${successCount} extracted, ${skipCount} skipped)`);
                    }
                }

                // Phase 3: Final save
                thumbState.currentPath = "Phase 3/3: Saving to database...";
                database.saveDatabase();

                console.log(`[Queue] Dimension Extract Complete. Processed: ${processedCount}, Extracted: ${successCount}, Skipped: ${skipCount}`);
                thumbState.currentPath = `Extraction Complete: ${successCount} dimensions extracted.`;

            } else if (currentTask.type === 'smart_scan') {
                thumbState.total = 4; // Phases: ReadDB, ReadCache, Analyze, Save
                console.log(`[Queue] Starting Smart Scan...`);

                // Phase 1: Read Database
                thumbState.currentPath = "Phase 1/3: Counting Records...";
                const totalFileCount = database.countFiles({ recursive: true });
                thumbState.total = totalFileCount + 3; // Est total: Count + 3 major phases
                thumbState.count = 1;

                thumbState.currentPath = "Phase 1/3: Loading file data...";
                const allFiles = database.queryFiles({ offset: 0, limit: 999999, recursive: true });
                thumbState.count = 2;

                const missing = [];
                const error = [];
                const cacheSet = new Set();

                // Phase 2: Read Cache
                thumbState.count = 3;
                thumbState.currentPath = "Phase 2/3: Analyzing Cache contents...";
                const scanDir = (dir) => {
                    if (!fs.existsSync(dir)) return;
                    try {
                        const items = fs.readdirSync(dir, { withFileTypes: true });
                        for (const item of items) {
                            if (item.isDirectory()) {
                                scanDir(path.join(dir, item.name));
                            } else if (item.name.endsWith('.webp')) {
                                cacheSet.add(item.name);
                                // Check if file is empty (corrupted)
                                try {
                                    const s = fs.statSync(path.join(dir, item.name));
                                    if (s.size === 0) cacheSet.add(item.name + ":0");
                                } catch (e) { }
                            }
                        }
                    } catch (e) { console.error(`[Queue] Error scanning cache dir ${dir}:`, e); }
                };
                scanDir(CACHE_DIR);
                console.log(`[Queue] Cache analyzed. Found ${cacheSet.size} valid thumbnail names.`);

                thumbState.count = 4;
                thumbState.total = allFiles.length + 4;

                // Phase 3: Analysis
                thumbState.currentPath = "Phase 3/3: Comparing Records with Cache...";
                let processed = 0;
                for (const file of allFiles) {
                    if (thumbState.shouldStop) break;

                    if (processed % 100 === 0) {
                        thumbState.count = 4 + processed;
                        thumbState.currentPath = `Comparing: ${file.path.split(/[\\/]/).pop()}`;
                        await new Promise(r => setImmediate(r));
                    }
                    processed++;

                    // Debug Log for Cache Sample
                    if (processed === 1 && cacheSet.size > 0) {
                        console.log(`[SmartScan DEBUG] Cache Sample (first 3): ${Array.from(cacheSet).slice(0, 3).join(', ')}`);
                    }

                    // CRITICAL: Use the same ID generation as the rest of the app
                    const fileId = file.id || Buffer.from(file.path).toString('base64');
                    const hash = crypto.createHash('md5').update(fileId).digest('hex') + '.webp';

                    if (!cacheSet.has(hash)) {
                        missing.push(file);
                        // Debug log for first few missing
                        if (missing.length <= 3) {
                            console.log(`[SmartScan DEBUG] Missing File: Path="${file.path}" ID="${fileId}" Hash="${hash}"`);
                        }
                    } else if (cacheSet.has(hash + ":0")) {
                        error.push(file);
                    }
                }

                // Done
                smartScanResults = {
                    missing: missing,
                    error: error,
                    timestamp: Date.now()
                };
                saveSmartResults();
                console.log(`[Queue] Smart Scan Complete. Missing: ${missing.length}, Error: ${error.length}`);
                thumbState.currentPath = "Analysis Complete.";

            } else {
                // Normal Repair/Regenerate Task
                thumbState.total = currentTask.total || (currentTask.files ? currentTask.files.length : 0);

                console.log(`[Queue] Starting Task: ${currentTask.name} (${thumbState.total} files)`);

                // Determine Thread Count
                let threadCount = 2; // Default
                const config = getConfig();
                if (config.threadCount && config.threadCount > 0) threadCount = config.threadCount;

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

                    // If this was a repair task (inferred by name or context), clear results
                    // To be safe, if we just processed a batch of files, we assume user acted on results.
                    // Or specifically check for "Smart Repair" name if possible, but clearing on any mass op is safer UX.
                    if (currentTask.name.includes('Smart Repair')) {
                        console.log('[Queue] Smart Repair finished. clearing results.');
                        smartScanResults = { missing: [], error: [], timestamp: Date.now() };
                        saveSmartResults();
                    }
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
    const summary = req.query.summary === 'true';
    if (summary) {
        return res.json({
            missingCount: smartScanResults.missing.length,
            errorCount: smartScanResults.error.length,
            timestamp: smartScanResults.timestamp
        });
    }
    res.json(smartScanResults);
});

// ✨ NEW: Extract Dimensions Endpoint
app.post('/api/thumb/extract-dimensions', authenticateToken, adminOnly, (req, res) => {
    console.log('[API] Dimension extract task requested');

    // Queue task
    enqueueTask({
        id: 'dimension-extract-' + Date.now(),
        type: 'dimension_extract',
        name: 'Extract Thumbnail Dimensions',
        files: [],  // Task queries files itself
        total: 0    // Task calculates total
    });

    res.json({
        success: true,
        message: 'Dimension extraction task queued'
    });
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

// ✨ NEW: Batch Delete Endpoint for Error Management
app.post('/api/file/batch-delete', authenticateToken, adminOnly, (req, res) => {
    const { fileIds } = req.body;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
        return res.status(400).json({ error: 'Invalid or empty fileIds array' });
    }

    let deletedCount = 0;
    let failedCount = 0;
    const errors = [];

    fileIds.forEach(id => {
        try {
            const filePath = Buffer.from(id, 'base64').toString('utf8');

            // 1. Security Check (Path Traversal prevention is handled by checkFileAccess/LibraryPaths logic normally, 
            // but for deletion we must be extra careful. Here we rely on adminOnly and DB validation)
            if (!fs.existsSync(filePath)) {
                // Already gone? Remove from DB anyway
                database.deleteFile(id);
                deletedCount++;
                return;
            }

            // 2. Physical Delete
            fs.unlinkSync(filePath);

            // 3. DB Delete
            database.deleteFile(id);

            // 4. Remove from Results lists
            smartScanResults.missing = smartScanResults.missing.filter(f => f.id !== id);
            smartScanResults.error = smartScanResults.error.filter(f => f.id !== id);

            deletedCount++;
        } catch (e) {
            failedCount++;
            errors.push({ id, error: e.message });
            console.error(`[BatchDelete] Failed to delete ${id}:`, e);
        }
    });

    // Save updated results
    saveSmartResults();
    database.saveDatabase();

    res.json({
        success: true,
        deleted: deletedCount,
        failed: failedCount,
        errors: errors
    });
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
            if (targetPath === 'root') targetPath = PRIMARY_MEDIA_ROOT;

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

    // [Security] Verify access before serving from cache
    try {
        const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');
        if (!checkFileAccess(req.user, filePath)) {
            return res.status(403).send('Access Denied');
        }
    } catch (e) { return res.status(400).send('Invalid ID'); }

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

// EXIF Endpoint (Moved up for priority)
app.get('/api/file/:id/exif', async (req, res) => {
    try {
        const filePath = Buffer.from(req.params.id, 'base64').toString('utf8');
        if (!fs.existsSync(filePath)) return res.json({});
        const ext = path.extname(filePath).toLowerCase();
        const videoExts = ['.mp4', '.webm', '.mov'];
        if (videoExts.includes(ext)) {
            // Get video metadata via ffmpeg
            exec(`ffmpeg -i "${filePath}"`, { timeout: 5000 }, (err, stdout, stderr) => {
                const output = stderr || stdout || '';
                const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d+)/);
                const resolutionMatch = output.match(/, (\d{2,5})x(\d{2,5})/);
                const meta = {};
                if (durationMatch) {
                    const h = parseFloat(durationMatch[1]);
                    const m = parseFloat(durationMatch[2]);
                    const s = parseFloat(durationMatch[3]);
                    meta.duration = (h * 3600) + (m * 60) + s;
                }
                if (resolutionMatch) {
                    meta.width = parseInt(resolutionMatch[1]);
                    meta.height = parseInt(resolutionMatch[2]);
                }
                res.json(meta);
            });
        } else {
            const tags = await exifr.parse(filePath);
            res.json(tags || {});
        }
    } catch (e) {
        console.error('EXIF parse error:', e.message);
        res.json({});
    }
});

// Serve Media Files
app.get('/api/file/*', (req, res) => {
    console.log(`\x1b[33m[DEBUG] Media Hit: ${req.url}\x1b[0m`);
    try {
        const fullId = decodeURIComponent(req.params[0] || '');
        const filePath = Buffer.from(fullId, 'base64').toString('utf8');
        console.log(`\x1b[36m[DEBUG] Resolved Path: ${filePath}\x1b[0m`);

        if (!fs.existsSync(filePath)) {
            console.error(`[API] File 404: ${filePath}`);
            return res.status(404).send('File not found');
        }

        if (!req.user) {
            console.warn(`[Security] 401: No user for media request to ${filePath}`);
            return res.status(401).send('Auth Required');
        }

        if (!checkFileAccess(req.user, filePath)) {
            console.warn(`[Security] 403: Access Denied for ${req.user.username} to ${filePath}`);
            return res.status(403).send('Access Denied');
        }

        // Determine MIME Type manually to avoid 'no supported source' error in CEF
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mov': 'video/quicktime',
            '.m4v': 'video/x-m4v',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.gif': 'image/gif'
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';

        if (process.env.DEBUG === 'true') {
            console.log(`[API] Serving ${filePath} as ${contentType}`);
        }

        if (req.headers.range) {
            console.log(`\x1b[32m[DEBUG] Range Requested: ${req.headers.range}\x1b[0m`);
        }

        res.sendFile(filePath, {
            acceptRanges: true,
            cacheControl: true,
            maxAge: '5m',
            headers: {
                'Content-Type': contentType,
                'X-Content-Type-Options': 'nosniff',
                'Access-Control-Allow-Origin': '*',
                'Accept-Ranges': 'bytes'
            }
        }, (err) => {
            if (err) {
                if (!res.headersSent) {
                    console.error('\x1b[31m[API] SendFile error:\x1b[0m', err.message);
                    res.status(500).send('Error');
                }
            } else {
                console.log(`\x1b[32m[DEBUG] Served: ${path.basename(filePath)} (${contentType})\x1b[0m`);
            }
        });
    } catch (error) {
        console.error('[API] Error in /api/file:', error);
        if (!res.headersSent) res.status(500).send('Error');
    }
});

// System Status API Stub
app.get('/api/system/status', (req, res) => {
    const userId = req.user.username;
    const isAdmin = req.user.role === 'admin';

    const userLibraryPaths = getUserLibraryPaths(req.user);
    const dbStats = dbReady ? database.getStats({ allowedPaths: isAdmin ? null : userLibraryPaths }) : { totalFiles: 0, totalImages: 0, totalVideos: 0, totalAudio: 0 };

    // Use pre-calculated values to avoid blocking the event loop
    const cacheSize = globalCacheSize;
    const cacheCount = globalCacheCount;

    const status = {
        mediaStats: {
            totalFiles: dbStats.totalFiles || 0,
            images: dbStats.totalImages || 0,
            videos: dbStats.totalVideos || 0,
            audio: dbStats.totalAudio || 0
        }
    };

    if (isAdmin) {
        Object.assign(status, {
            uptime: Math.floor(process.uptime()),
            cpu: 0,
            memory: process.memoryUsage(),
            storage: cacheSize,
            watcherActive: false,
            mode: monitorMode,
            scanInterval: scanInterval,
            ffmpeg: true,
            sharp: false,
            imageProcessor: 'ffmpeg',
            platform: process.platform,
            ffmpegHwAccels: hwAccel.type !== 'none' ? [hwAccel.type.toUpperCase()] : [],
            hardwareAcceleration: {
                type: hwAccel.type,
                device: hwAccel.device
            },
            cacheCount: cacheCount,
            totalItems: dbStats.totalFiles,
            dbStatus: dbReady ? 'connected' : 'initializing',
        });
    }

    res.json(status);
});

// Monitor Control Endpoint
app.post('/api/system/monitor', adminOnly, (req, res) => {
    const { mode, interval, enabled } = req.body;

    try {
        const currentConfig = getConfig();

        // Stop everything first
        stopAllMonitoring();

        let newMode = 'manual';
        let paths = currentConfig.libraryPaths || MEDIA_ROOTS;

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

        updateConfig(currentConfig);

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
app.get('/api/watcher/toggle', adminOnly, (req, res) => {
    try {
        const currentConfig = getConfig();

        if (isWatcherActive) {
            // Turn off
            stopWatcher();
            currentConfig.watcherEnabled = false;
        } else {
            // Turn on
            let libraryPaths = MEDIA_ROOTS;
            if (currentConfig.libraryPaths && currentConfig.libraryPaths.length > 0) {
                libraryPaths = currentConfig.libraryPaths;
            }
            startWatcher(libraryPaths);
            currentConfig.watcherEnabled = true;
        }

        // Persist setting
        try {
            updateConfig(currentConfig);
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

    const userId = req.user.username;
    const favoriteIds = database.getFavoriteIds(userId);
    res.json(favoriteIds);
});

// app.post('/api/favorites/toggle', ...) -> DUPLICATE REMOVED (Defined above at line 1054)

// EXIF API
// EXIF API (Duplicate removed, see below)

app.post('/api/cache/clear', adminOnly, (req, res) => {
    try {
        console.log("[Cache] Starting cache clear operation...");
        if (fs.existsSync(CACHE_DIR)) {
            // Helper to recursively delete contents instead of the directory itself
            // Removing the root CACHE_DIR can cause issues if it's a Docker volume mount
            const deleteContents = (dir) => {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    const fullPath = path.join(dir, item);
                    try {
                        if (fs.statSync(fullPath).isDirectory()) {
                            deleteContents(fullPath);
                            fs.rmdirSync(fullPath);
                        } else {
                            fs.unlinkSync(fullPath);
                        }
                    } catch (err) {
                        console.warn(`[Cache] Could not delete ${fullPath}: ${err.message}`);
                    }
                }
            };

            deleteContents(CACHE_DIR);
            console.log("[Cache] All contents within cache directory removed.");
        }

        // Reset Smart Scan Results
        smartScanResults = {
            missing: [],
            error: [],
            timestamp: 0
        };
        saveSmartResults();

        // Immediate update after clear
        updateGlobalCacheStats();

        // Trigger immediate stats update
        updateGlobalCacheStats();

        // Fix: Clear thumbnails table, not files table
        try {
            database.clearThumbnails();
            console.log("[DB] Thumbnails table cleared.");
        } catch (dbErr) {
            console.error("[DB] Failed to clear thumbnails from DB", dbErr);
        }

        res.json({ success: true });
    } catch (e) {
        console.error("[Cache] Clear cache fatal error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/cache/prune', adminOnly, (req, res) => {
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

// EXIF route moved up

// Favorites Logic
// Favorites Logic (Legacy JSON) - REMOVED to use Database


// (Moved catch-all route to bottom)
// --- User Management Endpoints ---
app.post('/api/users', adminOnly, (req, res) => {
    const { username, password, isAdmin, allowedPaths } = req.body;

    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    try {
        const config = getConfig();
        if (Object.keys(config).length === 0) return res.status(500).json({ error: 'Config missing' });
        if (!config.users) config.users = [];

        if (config.users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Cleanup paths: remove empty, trim
        const cleanedPaths = (allowedPaths || []).map(p => p.trim()).filter(Boolean);

        config.users.push({
            username,
            password,
            isAdmin: !!isAdmin,
            allowedPaths: cleanedPaths
        });

        updateConfig(config);

        const sanitizedUsers = config.users.map(({ password, ...u }) => u);
        res.json({ success: true, users: sanitizedUsers });
    } catch (e) {
        console.error("User creation error", e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/users/:targetUser', authenticateToken, (req, res) => {
    const { targetUser } = req.params;
    const { newUsername, newPassword, allowedPaths, isAdmin: newIsAdmin } = req.body;

    console.log(`[DEBUG] Update user ${targetUser}:`, { newUsername, allowedPaths, newIsAdmin, reqUser: req.user });

    const isSelf = req.user.username === targetUser;
    const isAdmin = req.user.isAdmin || req.user.role === 'admin';

    if (!isAdmin && !isSelf) {
        console.log('[DEBUG] Permission denied');
        return res.status(403).json({ error: 'Permission denied' });
    }

    // Non-admins can only change password
    if (!isAdmin && (allowedPaths !== undefined || newUsername || newIsAdmin !== undefined)) {
        console.log('[DEBUG] Admin fields denied for non-admin');
        return res.status(403).json({ error: 'Admins only for these fields' });
    }

    try {
        const config = getConfig();
        const userIndex = config.users?.findIndex(u => u.username === targetUser);

        if (userIndex === -1 || userIndex === undefined) return res.status(404).json({ error: 'User not found' });

        // If renaming, check conflict
        if (newUsername && newUsername !== targetUser) {
            if (config.users.find(u => u.username === newUsername)) {
                return res.status(400).json({ error: 'Username already taken' });
            }
            config.users[userIndex].username = newUsername;
        }

        if (newPassword) config.users[userIndex].password = newPassword;
        if (allowedPaths !== undefined && isAdmin) {
            config.users[userIndex].allowedPaths = allowedPaths.map(p => p.trim()).filter(Boolean);
        }
        if (newIsAdmin !== undefined && isAdmin) {
            config.users[userIndex].isAdmin = !!newIsAdmin;
        }

        updateConfig(config);

        const sanitizedUsers = config.users.map(({ password, ...u }) => u);
        res.json({ success: true, users: sanitizedUsers });
    } catch (e) {
        console.error("User update error", e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/users/:targetUser', adminOnly, (req, res) => {
    const { targetUser } = req.params;

    // Prevent deleting self (though frontend should block too)
    if (req.user.username === targetUser) return res.status(400).json({ error: "Cannot delete yourself" });

    try {
        const config = getConfig();
        const initialLen = config.users?.length || 0;
        config.users = (config.users || []).filter(u => u.username !== targetUser);

        if (config.users.length === initialLen) return res.status(404).json({ error: 'User not found' });

        updateConfig(config);

        const sanitizedUsers = config.users.map(({ password, ...u }) => u);
        res.json({ success: true, users: sanitizedUsers });
    } catch (e) {
        console.error("User deletion error", e);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve static files from the 'dist' directory (Vite build output)
app.use(express.static(path.join(__dirname, 'dist')));
// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all route to serve index.html for client-side routing (MUST be last)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);

    // Check config for watcher auto-start
    try {
        const config = getConfig();
        if (config && Object.keys(config).length > 0) {
            // Restore settings
            if (config.scanInterval) scanInterval = config.scanInterval;

            const libraryPaths = (config.libraryPaths && config.libraryPaths.length > 0)
                ? config.libraryPaths
                : MEDIA_ROOTS;

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
    } catch (e) {
        console.error("Failed to auto-start monitoring:", e);
    }
});