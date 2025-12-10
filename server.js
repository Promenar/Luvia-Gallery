const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');
const crypto = require('crypto');
const os = require('os');
const { exec } = require('child_process');

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
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json');

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

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'build')));

// --- Global Scan State ---
let scanJob = {
    status: 'idle', // idle, scanning, paused, completed, cancelled, error
    count: 0,
    currentPath: '',
    items: [],
    sources: [],
    folders: [], // Cached folder structure with counts
    control: {
        pause: false,
        cancel: false
    }
};

// --- Thumbnail Gen State ---
let thumbJob = {
    status: 'idle',
    count: 0,
    total: 0,
    currentPath: '',
    currentEngine: '', // 'sharp', 'ffmpeg-cpu', 'ffmpeg-cuda'
    control: { pause: false, cancel: false }
};

// --- System Capabilities ---
let systemCaps = {
    ffmpeg: false,
    ffmpegHwAccels: [],
    sharp: !!sharp
};

// Check FFmpeg Capabilities
const checkSystemCapabilities = () => {
    if (ffmpeg) {
        ffmpeg.getAvailableCodecs((err, codecs) => {
            if (!err) systemCaps.ffmpeg = true;
        });

        // Exec ffmpeg to check hwaccels
        exec('ffmpeg -hwaccels', (err, stdout, stderr) => {
            if (!err) {
                const output = stdout || stderr;
                const lines = output.split('\n');
                let capturing = false;
                let accels = [];
                // Simple parsing strategy depending on ffmpeg version output
                // Usually output lists "Hardware acceleration methods:" then list
                if (output.includes('Hardware acceleration methods:')) {
                    const methods = output.split('Hardware acceleration methods:')[1].trim().split('\n')[0].trim().split(' ');
                    accels = methods.filter(m => m && m !== '');
                } else {
                    // Fallback parse
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

// --- Persistence Functions ---

const saveLibrary = () => {
    try {
        const data = {
            items: scanJob.items,
            sources: scanJob.sources,
            folders: scanJob.folders,
            lastScan: Date.now()
        };
        fs.writeFileSync(LIBRARY_FILE, JSON.stringify(data));
        console.log(`Library saved to disk. ${scanJob.items.length} items.`);
    } catch (e) {
        console.error("Failed to save library:", e);
    }
};

const loadLibrary = () => {
    if (fs.existsSync(LIBRARY_FILE)) {
        try {
            const raw = fs.readFileSync(LIBRARY_FILE, 'utf8');
            const data = JSON.parse(raw);
            if (data && Array.isArray(data.items)) {
                scanJob.items = data.items;
                scanJob.sources = data.sources || [];
                scanJob.folders = data.folders || [];
                scanJob.count = data.items.length;
                scanJob.status = 'completed'; 
                console.log(`Library loaded from disk. ${scanJob.items.length} items.`);
            }
        } catch (e) {
            console.error("Failed to load library:", e);
        }
    }
};

// Load on startup
loadLibrary();


// --- Helper Functions ---

// Promisified sleep for async pause
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to check pause/cancel status during scan
const checkControl = async () => {
    if (scanJob.control.cancel) throw new Error('CANCELLED');
    
    while (scanJob.control.pause) {
        if (scanJob.control.cancel) throw new Error('CANCELLED');
        await sleep(500);
    }
    // Allow event loop to breathe
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

// --- Video Thumbnail Helper ---
const generateVideoThumbnail = (sourcePath, outputPath) => {
    return new Promise((resolve, reject) => {
        if (!ffmpeg) return reject(new Error("FFmpeg not available"));

        // 1. Probe for duration
        ffmpeg.ffprobe(sourcePath, (err, metadata) => {
            if (err) return reject(err);

            const duration = metadata.format.duration || 0;
            const timestamp = duration > 10 ? duration * 0.2 : 1; 

            // Helper to run ffmpeg command
            const runFfmpeg = (useHardwareAccel) => {
                return new Promise((innerResolve, innerReject) => {
                    let command = ffmpeg(sourcePath);

                    // If GPU is detected in systemCaps, try to use it
                    // This is a naive implementation; real world needs more complex codec mapping
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

            // Strategy: Try GPU if available, else CPU
            const hasGpu = systemCaps.ffmpegHwAccels.length > 0;
            
            runFfmpeg(hasGpu)
                .then(() => resolve())
                .catch((hwErr) => {
                    if (hasGpu) {
                         // Fallback
                         runFfmpeg(false)
                            .then(() => resolve())
                            .catch((cpuErr) => reject(cpuErr));
                    } else {
                        reject(hwErr);
                    }
                });
        });
    });
};


// Async recursive scan
const scanDirectoryAsync = async (baseDir, currentSubDir = '', rootAlias = '') => {
    await checkControl();
    
    let results = [];
    const fullPathToScan = path.join(baseDir, currentSubDir);
    
    // Safety check for currentPath assignment
    scanJob.currentPath = path.join(rootAlias || '', currentSubDir || '');

    try {
        const dirExists = await fs.promises.access(fullPathToScan).then(() => true).catch(() => false);
        if (!dirExists) return [];

        const list = await fs.promises.readdir(fullPathToScan);
        
        for (const file of list) {
            if (file.startsWith('.')) continue;

            // Check control before processing each file/folder
            await checkControl();

            const fullFilePath = path.join(fullPathToScan, file);
            // relativePath: used for Unique ID generation and streaming
            const relativePath = path.join(rootAlias, currentSubDir, file);
            
            try {
                const stat = await fs.promises.stat(fullFilePath);
                
                if (stat.isDirectory()) {
                    const subResults = await scanDirectoryAsync(baseDir, path.join(currentSubDir, file), rootAlias);
                    results = results.concat(subResults);
                } else {
                    const mimeType = mime.lookup(fullFilePath);
                    // Check if mimeType is a string before checking startsWith, as lookup can return false
                    if (mimeType && typeof mimeType === 'string' && 
                       (mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType.startsWith('audio/'))) {
                        const item = {
                            name: file,
                            path: relativePath,
                            streamPath: fullFilePath,
                            size: stat.size,
                            lastModified: stat.mtimeMs,
                            type: mimeType
                        };
                        results.push(item);
                        
                        // Update global live stats
                        scanJob.count++;
                        scanJob.items.push(item); // We accumulate in global state for simplicity here
                    }
                }
            } catch (err) {
                // Ignore individual file errors
            }
        }
    } catch (e) {
        if (e.message === 'CANCELLED') throw e;
        console.error(`Error reading directory ${fullPathToScan}:`, e.message);
    }
    return results;
};

// Helper to format an item for API response
const formatItemForClient = (f) => {
    if (!f || !f.path) return null;

    try {
        const dir = path.dirname(f.path);
        // Normalize folderPath to match frontend "path/to/folder" format.
        const normalizedFolder = (dir === '.' ? '' : dir).replace(/\\/g, '/').replace(/^\//, '');
        const streamPath = f.streamPath || f.path; // Fallback
        
        let mediaType = 'image';
        // Ensure f.type is string
        const typeStr = (typeof f.type === 'string') ? f.type : 'application/octet-stream';
        
        if (typeStr.startsWith('video/')) mediaType = 'video';
        else if (typeStr.startsWith('audio/')) mediaType = 'audio';

        return {
            id: Buffer.from(streamPath).toString('base64'),
            url: `/media-stream/${encodeURIComponent(streamPath)}`,
            name: f.name || 'Unknown',
            path: f.path,
            folderPath: normalizedFolder,
            size: f.size || 0,
            type: typeStr,
            lastModified: f.lastModified || Date.now(),
            mediaType: mediaType,
            sourceId: 'nas-mixed' 
        };
    } catch (e) {
        console.error("Error formatting item", f, e);
        return null;
    }
};

// Helper to validate and resolve paths (shared logic)
const resolveValidPath = (reqPath) => {
    const decodedPath = decodeURIComponent(reqPath);
    let config = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const content = fs.readFileSync(CONFIG_FILE, 'utf8');
            if (content.trim()) config = JSON.parse(content);
        }
    } catch (e) {}

    const validRoots = (config.libraryPaths && config.libraryPaths.length > 0) 
        ? config.libraryPaths.map(p => p.startsWith('/') ? p : path.join(MEDIA_ROOT, p))
        : [MEDIA_ROOT];

    if (validRoots.length === 0) validRoots.push(MEDIA_ROOT);

    const normalizedReqPath = path.normalize(decodedPath);
    
    // Security check: ensure path is within one of the valid roots
    const isAllowed = validRoots.some(root => normalizedReqPath.startsWith(path.normalize(root)));

    if (!isAllowed) return { error: 403, message: 'Access Denied' };
    if (!fs.existsSync(normalizedReqPath)) return { error: 404, message: 'Not found' };
    
    return { path: normalizedReqPath };
};

// Calculate folders from scanned items (used at end of scan)
const calculateFolderStats = (items) => {
    const folderMap = new Map();

    // 1. First Pass: Aggregate direct counts and identify covers
    items.forEach(item => {
        if (!item.path) return;
        const dir = path.dirname(item.path);
        const folderPath = (dir === '.' ? '' : dir).replace(/\\/g, '/').replace(/^\//, '');
        
        if (!folderMap.has(folderPath)) {
            folderMap.set(folderPath, {
                path: folderPath,
                directCount: 0,
                totalCount: 0, 
                coverItem: null
            });
        }
        
        const folderData = folderMap.get(folderPath);
        folderData.directCount++;
        
        // Pick cover: Prefer image over video/audio.
        if (item.type && typeof item.type === 'string') {
            if (!folderData.coverItem) {
                 folderData.coverItem = item;
            } else if (folderData.coverItem.type.startsWith('video/') && item.type.startsWith('image/')) {
                 folderData.coverItem = item; // Upgrade to image
            }
        }
    });

    // 2. Second Pass: Calculate Recursive Counts
    const allFolders = Array.from(folderMap.values());
    allFolders.forEach(f => f.totalCount = f.directCount); // Init

    allFolders.forEach(child => {
        if (child.directCount > 0) {
                let currentPath = child.path;
                while(currentPath.includes('/')) {
                    currentPath = path.dirname(currentPath);
                    const parentKey = currentPath === '.' ? '' : currentPath; 
                    if (folderMap.has(parentKey)) {
                        folderMap.get(parentKey).totalCount += child.directCount;
                    }
                }
                // Handle root files if root key exists (often empty string '')
                if (child.path !== '' && folderMap.has('')) {
                     folderMap.get('').totalCount += child.directCount;
                }
        }
    });

    return allFolders.map(f => ({
        path: f.path,
        count: f.totalCount, 
        coverItem: f.coverItem ? formatItemForClient(f.coverItem) : null
    }));
};

// --- API Endpoints ---

// System Status Endpoint
app.get('/api/system/status', async (req, res) => {
    let cacheCount = 0;
    try {
        const files = await fs.promises.readdir(CACHE_DIR);
        cacheCount = files.length;
    } catch(e) {}

    const breakdown = {
        image: 0,
        video: 0,
        audio: 0
    };

    scanJob.items.forEach(i => {
        if (i.type.startsWith('image')) breakdown.image++;
        else if (i.type.startsWith('video')) breakdown.video++;
        else if (i.type.startsWith('audio')) breakdown.audio++;
    });

    res.json({
        ffmpeg: systemCaps.ffmpeg,
        ffmpegHwAccels: systemCaps.ffmpegHwAccels,
        sharp: systemCaps.sharp,
        cacheCount: cacheCount,
        totalItems: scanJob.items.length,
        mediaBreakdown: breakdown,
        platform: os.platform() + ' ' + os.arch()
    });
});

// File Rename
app.post('/api/file/rename', async (req, res) => {
    const { oldPath, newName } = req.body;
    if (!oldPath || !newName) return res.status(400).json({ error: 'Missing parameters' });

    const result = resolveValidPath(oldPath);
    if (result.error) return res.status(result.error).json({ error: result.message });
    
    const oldFilePath = result.path;
    const dir = path.dirname(oldFilePath);
    const newFilePath = path.join(dir, newName);

    try {
        await fs.promises.rename(oldFilePath, newFilePath);
        
        // Update memory cache (scanJob)
        const foundItem = scanJob.items.find(i => i.streamPath === oldFilePath);
        if (foundItem) {
            foundItem.name = newName;
            foundItem.streamPath = newFilePath;
            // Update the display path too
            const parts = foundItem.path.split('/');
            parts.pop();
            parts.push(newName);
            foundItem.path = parts.join('/');
        }
        
        saveLibrary(); // Persist changes
        
        res.json({ success: true, newPath: foundItem ? foundItem.path : newName });
    } catch (e) {
        console.error("Rename error", e);
        res.status(500).json({ error: e.message });
    }
});

// File Delete
app.post('/api/file/delete', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Path required' });

    const result = resolveValidPath(filePath);
    if (result.error) return res.status(result.error).json({ error: result.message });

    try {
        await fs.promises.unlink(result.path);
        
        // Remove from memory cache
        const idx = scanJob.items.findIndex(i => i.streamPath === result.path);
        if (idx !== -1) {
            scanJob.items.splice(idx, 1);
            scanJob.count--;
        }
        
        saveLibrary(); // Persist changes

        res.json({ success: true });
    } catch (e) {
        console.error("Delete error", e);
        res.status(500).json({ error: e.message });
    }
});

// File System Autocomplete
app.get('/api/fs/list', async (req, res) => {
    const queryPath = req.query.path || '/';
    
    try {
        const resolvedPath = path.normalize(queryPath);
        
        const stats = await fs.promises.stat(resolvedPath);
        if (!stats.isDirectory()) {
             return res.json({ dirs: [] });
        }

        const items = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
        
        const dirs = items
            .filter(item => item.isDirectory() && !item.name.startsWith('.'))
            .map(item => item.name);
            
        res.json({ dirs });
    } catch (e) {
        console.error(`FS List error for ${queryPath}:`, e.message);
        res.json({ dirs: [] }); 
    }
});

// Get Configuration
app.get('/api/config', (req, res) => {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      // Handle empty file
      if (!content || content.trim() === '') {
          return res.json({ configured: false });
      }
      const config = JSON.parse(content);
      // Ensure we never return null if the file content was "null"
      if (!config || typeof config !== 'object') {
          return res.json({ configured: false });
      }
      res.json(config);
    } catch (e) {
      console.error("Config read error", e);
      res.json({ configured: false }); // Return safe default on error instead of 500
    }
  } else {
    // Return object instead of null to prevent "Unexpected non-whitespace character after JSON at position 4"
    res.json({ configured: false });
  }
});

// Save Configuration
app.post('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to write config' });
  }
});

// Scan Control & Status API
app.post('/api/scan/start', async (req, res) => {
    if (scanJob.status === 'scanning' || scanJob.status === 'paused') {
        return res.status(409).json({ error: 'Scan already in progress' });
    }

    // Reset Job
    scanJob = {
        status: 'scanning',
        count: 0,
        currentPath: '',
        items: [],
        sources: [],
        folders: [],
        control: { pause: false, cancel: false }
    };

    res.json({ success: true, message: 'Scan started' });

    // Start background scan
    try {
        let config = {};
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const content = fs.readFileSync(CONFIG_FILE, 'utf8');
                if (content.trim()) config = JSON.parse(content);
            }
        } catch (e) {}

        const pathsToScan = (config.libraryPaths && config.libraryPaths.length > 0) 
            ? config.libraryPaths 
            : [MEDIA_ROOT];
        
        console.log(`Starting background scan: ${JSON.stringify(pathsToScan)}`);

        for (const pathInput of pathsToScan) {
             await checkControl();
             
             if (!pathInput) continue;

             const isAbsolute = pathInput.startsWith('/');
             const absoluteScanPath = isAbsolute ? pathInput : path.join(MEDIA_ROOT, pathInput);
             const normalized = path.normalize(absoluteScanPath);
             
             const exists = await fs.promises.access(normalized).then(() => true).catch(() => false);
             if (exists) {
                 const startIndex = scanJob.items.length;
                 await scanDirectoryAsync(normalized, '', pathInput);
                 const endIndex = scanJob.items.length;
                 
                 scanJob.sources.push({
                     id: `nas-${Buffer.from(pathInput).toString('base64')}`,
                     name: pathInput,
                     count: endIndex - startIndex
                 });
             }
        }
        
        // Post-Scan: Calculate Folders Structure immediately
        scanJob.folders = calculateFolderStats(scanJob.items);

        scanJob.status = 'completed';
        saveLibrary(); // Persist to disk
        console.log(`Scan completed. Found ${scanJob.count} items. Folders processed.`);

    } catch (e) {
        if (e.message === 'CANCELLED') {
            scanJob.status = 'cancelled';
            console.log('Scan cancelled by user.');
        } else {
            scanJob.status = 'error';
            console.error('Scan failed:', e);
        }
    }
});

app.get('/api/scan/status', (req, res) => {
    // Defensive coding to prevent returning null or undefined which can break JSON parsing on client
    try {
        const statusData = {
            status: (scanJob && scanJob.status) ? scanJob.status : 'idle',
            count: (scanJob && typeof scanJob.count === 'number') ? scanJob.count : 0,
            currentPath: (scanJob && scanJob.currentPath) ? scanJob.currentPath : ''
        };
        res.json(statusData);
    } catch(e) {
        console.error("Error sending status:", e);
        res.json({ status: 'error', count: 0, currentPath: '' });
    }
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
        scanJob.control.pause = false; // ensure loop breaks
    }
    res.json({ success: true, status: scanJob.status });
});

app.get('/api/scan/results', (req, res) => {
    try {
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 1000;
        // Distinguish between undefined (all folders) and empty string (root folder)
        let folderFilter = null;
        if (req.query.folder !== undefined) {
            folderFilter = req.query.folder;
        }

        // Ensure scanJob is valid
        if (!scanJob) {
            return res.json({ files: [], sources: [], total: 0, offset, limit, hasMore: false });
        }

        let filteredItems = (scanJob.items) ? scanJob.items : [];
        
        // Server-side folder filtering to support folder navigation without loading everything
        if (folderFilter !== null) {
            filteredItems = filteredItems.filter(f => {
                if (!f || !f.path) return false;
                try {
                    const dir = path.dirname(f.path);
                    const normalizedFolder = (dir === '.' ? '' : dir).replace(/\\/g, '/').replace(/^\//, '');
                    return normalizedFolder === folderFilter;
                } catch(e) { return false; }
            });
        }

        // Apply simple pagination slice to memory array
        const slicedItems = filteredItems.slice(offset, offset + limit);
        const total = filteredItems.length;

        // Process items for frontend (generate base64 IDs etc)
        const processedItems = slicedItems.map(formatItemForClient).filter(i => i !== null);

        // Better source association
        const sources = (scanJob.sources) ? scanJob.sources : [];
        const finalItems = processedItems.map(item => {
            // Find which source this item belongs to
            // item.path is the relative path stored in memory, safe to compare
            const source = sources.find(s => item.path && item.path.startsWith(s.name));
            return { ...item, sourceId: source ? source.id : 'nas-unknown' };
        });

        res.json({
            files: finalItems,
            sources: sources,
            total: total,
            offset: offset,
            limit: limit,
            hasMore: (offset + limit) < total
        });
    } catch (e) {
        console.error("Results API Error", e);
        res.status(500).json({ error: "Internal Server Error during fetch" });
    }
});

// Endpoint to get all folders at once (grouped by directory)
app.get('/api/library/folders', (req, res) => {
    try {
        // Return pre-calculated folders from scan job if available
        if (scanJob && scanJob.folders && scanJob.folders.length > 0) {
            return res.json({ folders: scanJob.folders });
        }
        
        // Fallback for empty state
        res.json({ folders: [] });
    } catch(e) {
        console.error("Folder List API Error", e);
        res.status(500).json({ error: "Failed to list folders" });
    }
});

// --- Thumbnail Gen API ---

app.post('/api/thumb-gen/start', async (req, res) => {
    if (thumbJob.status === 'scanning' || thumbJob.status === 'paused') {
        return res.status(409).json({ error: 'Thumbnail generation already in progress' });
    }
    
    if (!scanJob.items || scanJob.items.length === 0) {
        return res.status(400).json({ error: 'Library is empty. Please scan library first.' });
    }

    if (!sharp && !ffmpeg) {
        return res.status(500).json({ error: 'No thumbnail generators (Sharp/FFmpeg) installed.' });
    }

    // Reset Job
    thumbJob = {
        status: 'scanning',
        count: 0,
        total: scanJob.items.length,
        currentPath: '',
        currentEngine: 'Initializing...',
        control: { pause: false, cancel: false }
    };
    
    res.json({ success: true, message: 'Thumbnail generation started' });
    
    // Background Process
    const processThumbnails = async () => {
        try {
            console.log("Starting thumbnail generation...");
            const items = scanJob.items;
            
            for (const item of items) {
                await checkThumbControl();
                
                thumbJob.currentPath = item.path;
                thumbJob.count++;
                
                const sourcePath = item.streamPath;
                const cacheKey = crypto.createHash('md5').update(sourcePath + item.lastModified + 'v2').digest('hex');
                const cacheFilename = `${cacheKey}.jpg`;
                const cacheFilePath = path.join(CACHE_DIR, cacheFilename);

                if (!fs.existsSync(cacheFilePath)) {
                    // IMAGE
                    if (sharp && item.type && item.type.startsWith('image/')) {
                        thumbJob.currentEngine = 'Sharp (CPU)';
                        try {
                            await sharp(sourcePath)
                                .resize({ width: 300, withoutEnlargement: true, fit: 'inside' })
                                .jpeg({ quality: 80, mozjpeg: true })
                                .toFile(cacheFilePath);
                        } catch(e) { /* ignore */ }
                    }
                    // VIDEO
                    else if (ffmpeg && item.type && item.type.startsWith('video/')) {
                         // engine set inside generateVideoThumbnail
                        try {
                            await generateVideoThumbnail(sourcePath, cacheFilePath);
                        } catch(e) { /* ignore */ }
                    }
                }
            }
            thumbJob.status = 'completed';
            console.log("Thumbnail generation completed.");
        } catch(e) {
            if (e.message === 'CANCELLED') {
                thumbJob.status = 'cancelled';
                console.log('Thumbnail generation cancelled.');
            } else {
                thumbJob.status = 'error';
                console.error("Thumbnail generation failed:", e);
            }
        }
    };
    
    processThumbnails();
});

app.get('/api/thumb-gen/status', (req, res) => {
    res.json({
        status: thumbJob.status,
        count: thumbJob.count,
        total: thumbJob.total,
        currentPath: thumbJob.currentPath,
        currentEngine: thumbJob.currentEngine
    });
});

app.post('/api/thumb-gen/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause') {
        thumbJob.control.pause = true;
        thumbJob.status = 'paused';
    } else if (action === 'resume') {
        thumbJob.control.pause = false;
        thumbJob.status = 'scanning';
    } else if (action === 'cancel') {
        thumbJob.control.cancel = true;
        thumbJob.control.pause = false;
    }
    res.json({ success: true, status: thumbJob.status });
});


// --- Thumbnail Endpoint (Persisted) ---
app.get('/api/thumbnail', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).send('Path required');

    const result = resolveValidPath(filePath);
    if (result.error) return res.status(result.error).send(result.message);

    try {
        const sourcePath = result.path;
        
        let stat;
        try {
            stat = await fs.promises.stat(sourcePath);
        } catch(e) {
            return res.status(404).send('Source file not found');
        }

        const cacheKey = crypto.createHash('md5').update(sourcePath + stat.mtimeMs + 'v2').digest('hex');
        const cacheFilename = `${cacheKey}.jpg`;
        const cacheFilePath = path.join(CACHE_DIR, cacheFilename);

        // Common headers
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Content-Type', 'image/jpeg');

        // Check if cached file exists
        if (fs.existsSync(cacheFilePath)) {
             const stream = fs.createReadStream(cacheFilePath);
             stream.pipe(res);
             return;
        }

        const mimeType = mime.lookup(sourcePath) || '';

        // VIDEO ON-DEMAND GEN
        if (ffmpeg && mimeType.startsWith('video/')) {
            try {
                await generateVideoThumbnail(sourcePath, cacheFilePath);
                fs.createReadStream(cacheFilePath).pipe(res);
                return;
            } catch(e) {
                // console.error("Video thumb gen failed", e);
                return res.redirect(`/media-stream/${encodeURIComponent(filePath)}`);
            }
        }

        // IMAGE ON-DEMAND GEN
        if (sharp && mimeType.startsWith('image/')) {
            await sharp(sourcePath)
                .resize({ 
                    width: 300, 
                    withoutEnlargement: true,
                    fit: 'inside' 
                })
                .jpeg({ quality: 80, mozjpeg: true })
                .toFile(cacheFilePath);

            fs.createReadStream(cacheFilePath).pipe(res);
            return;
        }

        // Fallback
        res.redirect(`/media-stream/${encodeURIComponent(filePath)}`);

    } catch (e) {
        console.error("Thumbnail error:", e);
        res.redirect(`/media-stream/${encodeURIComponent(filePath)}`);
    }
});

// Stream Media Content
app.get('/media-stream/:filepath', (req, res) => {
  const result = resolveValidPath(req.params.filepath);
  if (result.error) return res.status(result.error).send(result.message);
  
  const normalizedReqPath = result.path;
  const stat = fs.statSync(normalizedReqPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = mime.lookup(normalizedReqPath) || 'application/octet-stream';

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(normalizedReqPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': mimeType,
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
    };
    res.writeHead(200, head);
    fs.createReadStream(normalizedReqPath).pipe(res);
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Data Directory: ${DATA_DIR}`);
});