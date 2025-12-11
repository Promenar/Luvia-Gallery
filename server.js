const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');
const chokidar = require('chokidar');

// Database Integration
let Database;
let db;
try {
    Database = require('better-sqlite3');
} catch (e) {
    console.error("Module 'better-sqlite3' not found. Please install it.");
    process.exit(1);
}

// Try to require sharp
let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn("Module 'sharp' not found. Image thumbnail generation will fail.");
}

// Try to require fluent-ffmpeg
let ffmpeg;
try {
  ffmpeg = require('fluent-ffmpeg');
} catch (e) {
  console.warn("Module 'fluent-ffmpeg' not found. Video thumbnail generation will fail.");
}

const app = express();
const PORT = process.env.PORT || 80;
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'; 

// Data persistence setup
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const DB_FILE = path.join(DATA_DIR, 'library.db');

// Cache directory setup (persistent thumbnails)
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');

// Ensure directories exist on startup
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`Created data directory at ${DATA_DIR}`);
    } catch (e) {
        console.error(`Failed to create data directory: ${e.message}`);
    }
}

if (!fs.existsSync(CACHE_DIR)) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        console.log(`Created cache directory at ${CACHE_DIR}`);
    } catch (e) {
        console.error(`Failed to create cache directory: ${e.message}`);
    }
}

// --- SQLite Initialization ---
try {
    db = new Database(DB_FILE);
    // WAL mode for better concurrency and ZFS performance
    db.pragma('journal_mode = WAL');
    
    // Create Tables
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            name TEXT,
            folder_path TEXT,
            type TEXT,
            media_type TEXT,
            size INTEGER,
            mtime INTEGER,
            width INTEGER,
            height INTEGER,
            source_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_path);
        CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime DESC);
        CREATE INDEX IF NOT EXISTS idx_files_type ON files(media_type);
        
        CREATE TABLE IF NOT EXISTS folders (
            path TEXT PRIMARY KEY,
            name TEXT,
            parent_path TEXT,
            file_count INTEGER DEFAULT 0,
            cover_file_path TEXT
        );
        
        CREATE TABLE IF NOT EXISTS sources (
            id TEXT PRIMARY KEY,
            name TEXT,
            path TEXT,
            count INTEGER
        );
    `);
    console.log("SQLite Database initialized.");
} catch (e) {
    console.error("Failed to initialize SQLite:", e);
    process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'build')));

// --- Global Scan State ---
let scanJob = {
    status: 'idle', // idle, scanning, paused, completed, cancelled, error
    count: 0,
    currentPath: '',
    control: { pause: false, cancel: false }
};

// --- Thumbnail Gen State ---
let thumbJob = {
    status: 'idle',
    count: 0,
    total: 0,
    currentPath: '',
    currentEngine: '',
    control: { pause: false, cancel: false }
};

// --- Watcher State ---
let watcher = null;
let isWatcherActive = true;

// --- System Capabilities ---
let systemCaps = {
    ffmpeg: false,
    ffmpegHwAccels: [],
    sharp: !!sharp
};

const checkSystemCapabilities = () => {
    if (ffmpeg) {
        ffmpeg.getAvailableCodecs((err, codecs) => {
            if (!err) systemCaps.ffmpeg = true;
        });
        exec('ffmpeg -hwaccels', (err, stdout, stderr) => {
            if (!err) {
                const output = stdout || stderr;
                const lines = output.split('\n');
                let capturing = false;
                let accels = [];
                if (output.includes('Hardware acceleration methods:')) {
                    const methods = output.split('Hardware acceleration methods:')[1].trim().split('\n')[0].trim().split(' ');
                    accels = methods.filter(m => m && m !== '');
                } else {
                     lines.forEach(line => {
                         if(capturing && line.trim()) accels.push(line.trim());
                         if(line.includes('Hardware acceleration methods')) capturing = true;
                     });
                }
                systemCaps.ffmpegHwAccels = accels;
                console.log("Detected HW Accels:", accels);
            }
        });
    }
};
checkSystemCapabilities();

// --- Helpers ---

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const checkControl = async () => {
    if (scanJob.control.cancel) throw new Error('CANCELLED');
    while (scanJob.control.pause) {
        if (scanJob.control.cancel) throw new Error('CANCELLED');
        await sleep(500);
    }
    await sleep(0);
};

const checkThumbControl = async () => {
    if (thumbJob.control.cancel) throw new Error('CANCELLED');
    while (thumbJob.control.pause) {
        if (thumbJob.control.cancel) throw new Error('CANCELLED');
        await sleep(500);
    }
    await sleep(0);
}

// Sharded Cache Path Generator
const getCachePath = (sourcePath, mtime) => {
    const hash = crypto.createHash('md5').update(sourcePath + (mtime || 0)).digest('hex');
    const l1 = hash.substring(0, 2);
    const l2 = hash.substring(2, 4);
    const dir = path.join(CACHE_DIR, l1, l2);
    return { dir, filepath: path.join(dir, hash + '.jpg') };
};

const ensureDir = async (dir) => {
    try {
        await fs.promises.access(dir);
    } catch {
        await fs.promises.mkdir(dir, { recursive: true });
    }
};

// Video Thumbnail Generator
const generateVideoThumbnail = (sourcePath, outputPath) => {
    return new Promise((resolve, reject) => {
        if (!ffmpeg) return reject(new Error("FFmpeg not available"));

        ffmpeg.ffprobe(sourcePath, (err, metadata) => {
            if (err) return reject(err);

            const duration = metadata.format.duration || 0;
            const timestamp = duration > 10 ? duration * 0.2 : 1; 

            const runFfmpeg = (useHardwareAccel) => {
                return new Promise((innerResolve, innerReject) => {
                    let command = ffmpeg(sourcePath);
                    if (useHardwareAccel && systemCaps.ffmpegHwAccels.includes('cuda')) {
                         command = command.inputOptions(['-hwaccel cuda']);
                         thumbJob.currentEngine = 'FFmpeg (CUDA)';
                    } else if (useHardwareAccel && systemCaps.ffmpegHwAccels.includes('vaapi')) {
                         command = command.inputOptions(['-hwaccel vaapi']);
                         thumbJob.currentEngine = 'FFmpeg (VAAPI)';
                    } else {
                         thumbJob.currentEngine = 'FFmpeg (CPU)';
                    }

                    command
                        .screenshots({
                            timestamps: [timestamp],
                            filename: path.basename(outputPath),
                            folder: path.dirname(outputPath),
                            size: '300x?',
                        })
                        .on('end', () => innerResolve())
                        .on('error', (err) => innerReject(err));
                });
            };

            const hasGpu = systemCaps.ffmpegHwAccels.length > 0;
            runFfmpeg(hasGpu).then(resolve).catch((hwErr) => {
                if (hasGpu) runFfmpeg(false).then(resolve).catch(reject);
                else reject(hwErr);
            });
        });
    });
};

// --- Scanning Logic (Database Optimized) ---

const upsertFileStmt = db.prepare(`
    INSERT INTO files (path, name, folder_path, type, media_type, size, mtime, source_id)
    VALUES (@path, @name, @folder_path, @type, @media_type, @size, @mtime, @source_id)
    ON CONFLICT(path) DO UPDATE SET
        size=excluded.size,
        mtime=excluded.mtime,
        type=excluded.type,
        media_type=excluded.media_type,
        source_id=excluded.source_id
`);

const deleteFileStmt = db.prepare(`DELETE FROM files WHERE path = ?`);

// Recursively scan and batch insert into DB
const scanDirectoryToDB = async (baseDir, currentSubDir = '', sourceName, batchSize = 500) => {
    await checkControl();
    
    const fullPathToScan = path.join(baseDir, currentSubDir);
    scanJob.currentPath = fullPathToScan;

    let itemsBuffer = [];
    
    // Function to flush buffer
    const flushBuffer = () => {
        if (itemsBuffer.length === 0) return;
        const transaction = db.transaction((items) => {
            for (const item of items) upsertFileStmt.run(item);
        });
        transaction(itemsBuffer);
        scanJob.count += itemsBuffer.length;
        itemsBuffer = [];
    };

    try {
        const dirExists = await fs.promises.access(fullPathToScan).then(() => true).catch(() => false);
        if (!dirExists) return;

        const list = await fs.promises.readdir(fullPathToScan);
        
        for (const file of list) {
            if (file.startsWith('.')) continue;

            const fullFilePath = path.join(fullPathToScan, file);
            const relativePath = path.join(sourceName, currentSubDir, file); 
            // Normalize path for DB: ensure forward slashes
            const normalizedPath = relativePath.replace(/\\/g, '/');
            const normalizedFolderPath = path.dirname(normalizedPath).replace(/\\/g, '/');

            try {
                const stat = await fs.promises.stat(fullFilePath);
                
                if (stat.isDirectory()) {
                    // Flush before going deeper
                    flushBuffer(); 
                    await scanDirectoryToDB(baseDir, path.join(currentSubDir, file), sourceName, batchSize);
                } else {
                    const mimeType = mime.lookup(fullFilePath);
                    if (mimeType && typeof mimeType === 'string' && 
                       (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'))) {
                        
                        let mediaType = 'image';
                        if (mimeType.startsWith('video/')) mediaType = 'video';
                        if (mimeType.startsWith('audio/')) mediaType = 'audio';

                        itemsBuffer.push({
                            path: normalizedPath, // This acts as the unique ID for the file
                            name: file,
                            folder_path: normalizedFolderPath === '.' ? sourceName : normalizedFolderPath,
                            type: mimeType,
                            media_type: mediaType,
                            size: stat.size,
                            mtime: stat.mtimeMs,
                            source_id: `nas-${Buffer.from(sourceName).toString('base64')}`
                        });

                        if (itemsBuffer.length >= batchSize) {
                            flushBuffer();
                            await checkControl();
                            // Yield to event loop
                            await sleep(1); 
                        }
                    }
                }
            } catch (err) { /* ignore access errors */ }
        }
        flushBuffer(); // Flush remaining
    } catch (e) {
        if (e.message === 'CANCELLED') throw e;
        console.error(`Error reading directory ${fullPathToScan}:`, e.message);
    }
};

const rebuildFolderStats = () => {
    console.log("Rebuilding folder stats...");
    db.exec(`DELETE FROM folders`);
    
    db.exec(`
        INSERT INTO folders (path, name, parent_path, file_count, cover_file_path)
        SELECT 
            folder_path,
            replace(folder_path, rtrim(folder_path, replace(folder_path, '/', '')), ''),
            substr(folder_path, 0, length(folder_path) - length(replace(folder_path, rtrim(folder_path, replace(folder_path, '/', '')), ''))),
            COUNT(*),
            (SELECT path FROM files f2 WHERE f2.folder_path = files.folder_path AND f2.media_type = 'image' ORDER BY mtime DESC LIMIT 1)
        FROM files
        GROUP BY folder_path
    `);

    db.exec(`
        UPDATE folders 
        SET cover_file_path = (SELECT path FROM files WHERE files.folder_path = folders.path AND files.media_type = 'video' LIMIT 1)
        WHERE cover_file_path IS NULL
    `);
    console.log("Folder stats rebuilt.");
};

// --- File Watcher Logic ---

const startWatcher = (libraryPaths) => {
    if (watcher) {
        watcher.close();
        watcher = null;
    }

    if (!isWatcherActive || !libraryPaths || libraryPaths.length === 0) return;

    // Resolve paths to absolute
    const pathsToWatch = libraryPaths.map(p => {
        return p.startsWith('/') ? p : path.join(MEDIA_ROOT, p);
    });

    console.log("Starting file watcher on:", pathsToWatch);

    watcher = chokidar.watch(pathsToWatch, {
        ignored: /(^|[\/\\])\../, // ignore dotfiles
        persistent: true,
        ignoreInitial: true, // Don't re-scan everything on startup
        awaitWriteFinish: {
            stabilityThreshold: 2000,
            pollInterval: 100
        }
    });

    watcher.on('add', async (filePath) => {
        await handleWatcherEvent('add', filePath, libraryPaths);
    });

    watcher.on('change', async (filePath) => {
        await handleWatcherEvent('change', filePath, libraryPaths);
    });

    watcher.on('unlink', async (filePath) => {
        await handleWatcherEvent('unlink', filePath, libraryPaths);
    });

    watcher.on('error', error => console.error(`Watcher error: ${error}`));
};

const handleWatcherEvent = async (event, filePath, libraryPaths) => {
    try {
        // Determine source alias
        // We need to map absolute filePath back to DB path structure
        // DB Path = Relative path from source alias + Source Alias Prefix?
        // Actually, our scanner logic: pathInput (user config) is the root.
        // If config is "Photos", and absolute is "/media/Photos/img.jpg", DB path is "Photos/img.jpg".
        
        let matchedConfigPath = null;
        let matchedAbsolutePath = null;

        for (const configPath of libraryPaths) {
            const absolute = configPath.startsWith('/') ? configPath : path.join(MEDIA_ROOT, configPath);
            if (filePath.startsWith(absolute)) {
                matchedConfigPath = configPath;
                matchedAbsolutePath = absolute;
                break;
            }
        }

        if (!matchedConfigPath) return;

        // Construct DB normalized path
        const relativeFromRoot = path.relative(matchedAbsolutePath, filePath);
        const relativePath = path.join(matchedConfigPath, relativeFromRoot);
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const normalizedFolderPath = path.dirname(normalizedPath).replace(/\\/g, '/');
        
        if (event === 'unlink') {
            console.log(`Watcher: Deleting ${normalizedPath}`);
            deleteFileStmt.run(normalizedPath);
        } else {
            // Add or Change
            const mimeType = mime.lookup(filePath);
            if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'))) {
                const stat = await fs.promises.stat(filePath);
                let mediaType = 'image';
                if (mimeType.startsWith('video/')) mediaType = 'video';
                if (mimeType.startsWith('audio/')) mediaType = 'audio';

                console.log(`Watcher: Upserting ${normalizedPath}`);
                upsertFileStmt.run({
                    path: normalizedPath,
                    name: path.basename(filePath),
                    folder_path: normalizedFolderPath === '.' ? matchedConfigPath : normalizedFolderPath,
                    type: mimeType,
                    media_type: mediaType,
                    size: stat.size,
                    mtime: stat.mtimeMs,
                    source_id: `nas-${Buffer.from(matchedConfigPath).toString('base64')}`
                });
            }
        }
    } catch (e) {
        console.error("Watcher event handler failed", e);
    }
};

// --- API Endpoints ---

// System Status
app.get('/api/system/status', async (req, res) => {
    let cacheCount = 0;
    
    const dbStats = db.prepare('SELECT COUNT(*) as count FROM files').get();
    const mediaStats = db.prepare(`
        SELECT 
            SUM(CASE WHEN media_type = 'image' THEN 1 ELSE 0 END) as image,
            SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) as video,
            SUM(CASE WHEN media_type = 'audio' THEN 1 ELSE 0 END) as audio
        FROM files
    `).get();

    res.json({
        ffmpeg: systemCaps.ffmpeg,
        ffmpegHwAccels: systemCaps.ffmpegHwAccels,
        sharp: systemCaps.sharp,
        cacheCount: cacheCount,
        totalItems: dbStats.count,
        mediaBreakdown: mediaStats,
        platform: os.platform() + ' ' + os.arch(),
        watcherActive: isWatcherActive
    });
});

app.get('/api/watcher/toggle', (req, res) => {
    isWatcherActive = !isWatcherActive;
    
    // Restart watcher with current config
    let config = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    
    const paths = config.libraryPaths || [MEDIA_ROOT];
    startWatcher(paths);

    res.json({ active: isWatcherActive });
});

// Scan Control
app.post('/api/scan/start', async (req, res) => {
    if (scanJob.status === 'scanning' || scanJob.status === 'paused') {
        return res.status(409).json({ error: 'Scan already in progress' });
    }

    scanJob = {
        status: 'scanning',
        count: 0,
        currentPath: '',
        control: { pause: false, cancel: false }
    };

    res.json({ success: true, message: 'Scan started' });

    // Pause watcher during full scan to avoid conflicts
    if (watcher) {
        await watcher.close();
        watcher = null;
    }

    try {
        let config = {};
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            }
        } catch (e) {}

        const pathsToScan = (config.libraryPaths && config.libraryPaths.length > 0) 
            ? config.libraryPaths 
            : [MEDIA_ROOT];
        
        // Mark Phase: Mark all existing files as potentially stale
        // We append '_scanning' to source_id.
        // We only mark files that don't already have it (safety check)
        db.exec("UPDATE files SET source_id = source_id || '_scanning' WHERE source_id NOT LIKE '%_scanning'");

        for (const pathInput of pathsToScan) {
             await checkControl();
             if (!pathInput) continue;

             const isAbsolute = pathInput.startsWith('/');
             const absoluteScanPath = isAbsolute ? pathInput : path.join(MEDIA_ROOT, pathInput);
             const normalized = path.normalize(absoluteScanPath);
             
             // Check existence
             try {
                await fs.promises.access(normalized);
                // scanDirectoryToDB will upsert with clean source_id (no suffix)
                await scanDirectoryToDB(normalized, '', pathInput);
             } catch(e) { console.warn(`Path not found: ${normalized}`); }
        }

        // Sweep Phase: Delete files that still have the '_scanning' suffix (they weren't found/updated)
        const deleteResult = db.prepare("DELETE FROM files WHERE source_id LIKE '%_scanning'").run();
        console.log(`Scan Sweep: Removed ${deleteResult.changes} stale files.`);

        rebuildFolderStats();

        scanJob.status = 'completed';
    } catch (e) {
        if (e.message === 'CANCELLED') {
            scanJob.status = 'cancelled';
        } else {
            scanJob.status = 'error';
            console.error('Scan failed:', e);
        }
    } finally {
        // Restart watcher if it was active
        if (isWatcherActive) {
            let config = {};
            try {
                 if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
            } catch(e){}
            startWatcher(config.libraryPaths || [MEDIA_ROOT]);
        }
    }
});

app.get('/api/scan/status', (req, res) => {
    res.json(scanJob);
});

app.post('/api/scan/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause') {
        scanJob.control.pause = true;
        scanJob.status = 'paused';
    } else if (action === 'resume') {
        scanJob.control.pause = false;
        scanJob.status = 'scanning';
    } else if (action === 'cancel') {
        scanJob.control.cancel = true;
        scanJob.control.pause = false;
    }
    res.json({ success: true, status: scanJob.status });
});

// Helper to format DB item to Client item
const formatDbItem = (row) => {
    return {
        id: Buffer.from(row.path).toString('base64'),
        url: `/media-stream/${encodeURIComponent(row.path)}`,
        name: row.name,
        path: row.path,
        folderPath: row.folder_path,
        size: row.size,
        type: row.type,
        lastModified: row.mtime,
        mediaType: row.media_type,
        sourceId: row.source_id
    };
};

const resolveValidPath = (reqPath) => {
    const decodedPath = decodeURIComponent(reqPath);
    const file = db.prepare('SELECT path FROM files WHERE path = ?').get(decodedPath);
    
    let config = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {}

    const libraryPaths = config.libraryPaths || [MEDIA_ROOT];
    let absolutePath = null;
    
    if (path.isAbsolute(decodedPath)) {
        if (fs.existsSync(decodedPath)) absolutePath = decodedPath;
    } else {
        const p = path.join(MEDIA_ROOT, decodedPath);
        if (fs.existsSync(p)) absolutePath = p;
    }

    if (!absolutePath) {
        if (fs.existsSync(decodedPath)) absolutePath = decodedPath;
        else if (fs.existsSync(path.join(MEDIA_ROOT, decodedPath))) absolutePath = path.join(MEDIA_ROOT, decodedPath);
    }
    
    if (absolutePath) return { path: absolutePath };
    return { error: 404, message: 'Not found' };
};

app.get('/api/scan/results', (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 1000;
        const folder = req.query.folder;

        let rows, total;

        if (folder !== undefined) {
            // Filter by folder
            rows = db.prepare(`SELECT * FROM files WHERE folder_path = ? ORDER BY mtime DESC LIMIT ? OFFSET ?`).all(folder, limit, offset);
            total = db.prepare(`SELECT COUNT(*) as count FROM files WHERE folder_path = ?`).get(folder).count;
        } else {
            // All files
            rows = db.prepare(`SELECT * FROM files ORDER BY mtime DESC LIMIT ? OFFSET ?`).all(limit, offset);
            total = db.prepare(`SELECT COUNT(*) as count FROM files`).get().count;
        }

        const files = rows.map(formatDbItem);
        const sources = db.prepare('SELECT DISTINCT source_id as id, source_id as name FROM files').all().map(s => ({...s, count: 0}));

        res.json({
            files,
            sources,
            total,
            offset,
            limit,
            hasMore: (offset + limit) < total
        });
    } catch (e) {
        console.error("Results API Error", e);
        res.status(500).json({ error: "DB Error" });
    }
});

app.get('/api/library/folders', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT path, file_count as count, cover_file_path 
            FROM folders 
            ORDER BY path ASC
        `).all();
        
        const folders = rows.map(r => {
             let coverItem = null;
             if (r.cover_file_path) {
                 const f = db.prepare('SELECT * FROM files WHERE path = ?').get(r.cover_file_path);
                 if (f) coverItem = formatDbItem(f);
             }
             return {
                 path: r.path,
                 count: r.count,
                 coverItem
             };
        });

        res.json({ folders });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// --- Thumbnails (Sharded) ---

app.post('/api/thumb-gen/start', async (req, res) => {
    if (thumbJob.status === 'scanning') return res.status(409).json({ error: 'Busy' });
    
    // Get total count
    const total = db.prepare('SELECT COUNT(*) as count FROM files').get().count;
    if (total === 0) return res.status(400).json({ error: 'Library empty' });

    thumbJob = {
        status: 'scanning',
        count: 0,
        total: total,
        currentPath: '',
        currentEngine: 'Initializing...',
        control: { pause: false, cancel: false }
    };
    
    res.json({ success: true });
    
    // Background
    (async () => {
        try {
            // Iterate using a cursor to avoid loading all into RAM
            const stmt = db.prepare('SELECT path, type, mtime FROM files');
            
            for (const item of stmt.iterate()) {
                await checkThumbControl();
                
                thumbJob.count++;
                thumbJob.currentPath = item.path;

                // Resolve absolute path
                const res = resolveValidPath(item.path);
                if (res.error) continue;
                const sourcePath = res.path;

                // Determine Cache Path
                const { dir, filepath } = getCachePath(sourcePath, item.mtime);
                
                // Skip if exists
                if (fs.existsSync(filepath)) continue;

                // Ensure directory
                await ensureDir(dir);

                // Generate
                if (sharp && item.type.startsWith('image/')) {
                    thumbJob.currentEngine = 'Sharp (CPU)';
                    try {
                        await sharp(sourcePath)
                            .resize({ width: 300, withoutEnlargement: true, fit: 'inside' })
                            .jpeg({ quality: 80, mozjpeg: true })
                            .toFile(filepath);
                    } catch(e) {}
                } else if (ffmpeg && item.type.startsWith('video/')) {
                    try {
                         await generateVideoThumbnail(sourcePath, filepath);
                    } catch(e) {}
                }
            }
            thumbJob.status = 'completed';
        } catch (e) {
            thumbJob.status = e.message === 'CANCELLED' ? 'cancelled' : 'error';
        }
    })();
});

app.get('/api/thumb-gen/status', (req, res) => res.json(thumbJob));
app.post('/api/thumb-gen/control', (req, res) => {
    if (req.body.action === 'cancel') thumbJob.control.cancel = true;
    res.json({ success: true });
});

app.get('/api/thumbnail', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Path required');
    
    // Lookup item for mtime
    const item = db.prepare('SELECT mtime FROM files WHERE path = ?').get(filePath);
    if (!item) return res.redirect(`/media-stream/${encodeURIComponent(filePath)}`);

    const result = resolveValidPath(filePath);
    if (result.error) return res.status(404).send('Not found');
    
    const { filepath: cacheFilePath, dir } = getCachePath(result.path, item.mtime);

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Type', 'image/jpeg');

    if (fs.existsSync(cacheFilePath)) {
        fs.createReadStream(cacheFilePath).pipe(res);
        return;
    }

    // On-demand gen
    try {
        await ensureDir(dir);
        const mimeType = mime.lookup(result.path) || '';
        
        if (sharp && mimeType.startsWith('image/')) {
            await sharp(result.path).resize({ width: 300, withoutEnlargement: true, fit: 'inside' }).jpeg().toFile(cacheFilePath);
            fs.createReadStream(cacheFilePath).pipe(res);
            return;
        }
        
        if (ffmpeg && mimeType.startsWith('video/')) {
            await generateVideoThumbnail(result.path, cacheFilePath);
            fs.createReadStream(cacheFilePath).pipe(res);
            return;
        }
    } catch(e) {}

    res.redirect(`/media-stream/${encodeURIComponent(filePath)}`);
});

// Config and Streaming Endpoints
app.get('/api/config', (req, res) => {
    try {
        if (fs.existsSync(CONFIG_FILE)) res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
        else res.json({ configured: false });
    } catch(e) { res.json({ configured: false }); }
});

app.post('/api/config', (req, res) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    
    // Update watcher if paths changed
    if (isWatcherActive) {
        startWatcher(req.body.libraryPaths || [MEDIA_ROOT]);
    }
    
    res.json({ success: true });
});

app.get('/media-stream/:filepath', (req, res) => {
    const result = resolveValidPath(req.params.filepath);
    if (result.error) return res.status(404).send('Not found');
    
    const stat = fs.statSync(result.path);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = mime.lookup(result.path) || 'application/octet-stream';

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(result.path, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        });
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
        });
        fs.createReadStream(result.path).pipe(res);
    }
});

// Initial startup watcher
let startupConfig = {};
try {
    if (fs.existsSync(CONFIG_FILE)) startupConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (e) {}
startWatcher(startupConfig.libraryPaths || [MEDIA_ROOT]);

app.listen(PORT, () => console.log(`Lumina Server (SQLite + Watcher) running on port ${PORT}`));