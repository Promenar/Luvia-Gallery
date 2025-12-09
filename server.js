const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 80;
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'; 

// Data persistence setup
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure data directory exists on startup
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log(`Created data directory at ${DATA_DIR}`);
    } catch (e) {
        console.error(`Failed to create data directory: ${e.message}`);
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
    control: {
        pause: false,
        cancel: false
    }
};

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

// Async recursive scan
const scanDirectoryAsync = async (baseDir, currentSubDir = '', rootAlias = '') => {
    await checkControl();
    
    let results = [];
    const fullPathToScan = path.join(baseDir, currentSubDir);
    
    scanJob.currentPath = path.join(rootAlias, currentSubDir);

    try {
        const dirExists = await fs.promises.access(fullPathToScan).then(() => true).catch(() => false);
        if (!dirExists) return [];

        const list = await fs.promises.readdir(fullPathToScan);
        
        for (const file of list) {
            if (file.startsWith('.')) continue;

            // Check control before processing each file/folder
            await checkControl();

            const fullFilePath = path.join(fullPathToScan, file);
            const relativePath = path.join(rootAlias, currentSubDir, file);
            
            try {
                const stat = await fs.promises.stat(fullFilePath);
                
                if (stat.isDirectory()) {
                    const subResults = await scanDirectoryAsync(baseDir, path.join(currentSubDir, file), rootAlias);
                    results = results.concat(subResults);
                } else {
                    const mimeType = mime.lookup(fullFilePath);
                    if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
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

// --- API Endpoints ---

// File System Autocomplete
app.get('/api/fs/list', async (req, res) => {
    const queryPath = req.query.path || '/';
    
    // Security check: In a real app, you might want to restrict this to MEDIA_ROOT
    // For this app (NAS Viewer), we generally assume the container has access to what it needs.
    // However, we should ensure we don't crash on permission errors.
    
    try {
        const resolvedPath = path.normalize(queryPath);
        
        // Simple check to prevent traversing up out of root if needed, 
        // but for a dockerized NAS viewer, usually absolute paths are valid.
        
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
        res.json({ dirs: [] }); // Return empty on error (permission denied, not found, etc)
    }
});

// Get Configuration
app.get('/api/config', (req, res) => {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      res.json(config);
    } catch (e) {
      res.status(500).json({ error: 'Config file corrupted' });
    }
  } else {
    res.json(null);
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
        control: { pause: false, cancel: false }
    };

    res.json({ success: true, message: 'Scan started' });

    // Start background scan
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
        
        console.log(`Starting background scan: ${JSON.stringify(pathsToScan)}`);

        for (const pathInput of pathsToScan) {
             await checkControl();
             
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
        
        scanJob.status = 'completed';
        console.log(`Scan completed. Found ${scanJob.count} items.`);

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
    res.json({
        status: scanJob.status,
        count: scanJob.count,
        currentPath: scanJob.currentPath
    });
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
    const offset = parseInt(req.query.offset) || 0;
    const limit = parseInt(req.query.limit) || 1000;

    // Apply simple pagination slice to memory array
    const slicedItems = scanJob.items.slice(offset, offset + limit);
    const total = scanJob.items.length;

    // Process items for frontend (generate base64 IDs etc)
    const processedItems = slicedItems.map(f => ({
        id: Buffer.from(f.streamPath).toString('base64'),
        url: `/media-stream/${encodeURIComponent(f.streamPath)}`,
        name: f.name,
        path: f.path,
        folderPath: path.dirname(f.path) === '.' ? '' : path.dirname(f.path),
        size: f.size,
        type: f.type,
        lastModified: f.lastModified,
        mediaType: f.type.startsWith('video/') ? 'video' : 'image',
        // Associate with source based on path prefix logic or simplified assumption
        sourceId: 'nas-mixed' 
    }));

    // Better source association
    const finalItems = processedItems.map(item => {
        // Find which source this item belongs to
        const source = scanJob.sources.find(s => item.path.startsWith(s.name));
        return { ...item, sourceId: source ? source.id : 'nas-unknown' };
    });

    res.json({
        files: finalItems,
        sources: scanJob.sources,
        total: total,
        offset: offset,
        limit: limit,
        hasMore: (offset + limit) < total
    });
});

// Stream Media Content
app.get('/media-stream/:filepath', (req, res) => {
  const reqPath = decodeURIComponent(req.params.filepath);
  
  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}

  const validRoots = (config.libraryPaths && config.libraryPaths.length > 0) 
    ? config.libraryPaths.map(p => p.startsWith('/') ? p : path.join(MEDIA_ROOT, p))
    : [MEDIA_ROOT];

  if (validRoots.length === 0) validRoots.push(MEDIA_ROOT);

  const normalizedReqPath = path.normalize(reqPath);
  const isAllowed = validRoots.some(root => normalizedReqPath.startsWith(path.normalize(root)));

  if (!isAllowed) {
      return res.status(403).send('Access Denied');
  }

  if (!fs.existsSync(normalizedReqPath)) {
    return res.status(404).send('Not found');
  }

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