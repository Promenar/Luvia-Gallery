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

// Helper to format an item for API response
const formatItemForClient = (f) => {
    if (!f || !f.path) return null;

    try {
        const dir = path.dirname(f.path);
        // Normalize folderPath to match frontend "path/to/folder" format.
        const normalizedFolder = (dir === '.' ? '' : dir).replace(/\\/g, '/').replace(/^\//, '');
        const streamPath = f.streamPath || f.path; // Fallback

        return {
            id: Buffer.from(streamPath).toString('base64'),
            url: `/media-stream/${encodeURIComponent(streamPath)}`,
            name: f.name || 'Unknown',
            path: f.path,
            folderPath: normalizedFolder,
            size: f.size || 0,
            type: f.type || 'application/octet-stream',
            lastModified: f.lastModified || Date.now(),
            mediaType: (f.type && f.type.startsWith('video/')) ? 'video' : 'image',
            sourceId: 'nas-mixed' 
        };
    } catch (e) {
        console.error("Error formatting item", f, e);
        return null;
    }
};

// --- API Endpoints ---

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

        let filteredItems = (scanJob && scanJob.items) ? scanJob.items : [];
        
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
        const sources = (scanJob && scanJob.sources) ? scanJob.sources : [];
        const finalItems = processedItems.map(item => {
            // Find which source this item belongs to
            const source = sources.find(s => item.path.startsWith(s.name));
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
// This avoids pagination issues in the frontend folder view
app.get('/api/library/folders', (req, res) => {
    try {
        const folderMap = new Map();

        if (scanJob && scanJob.items) {
            scanJob.items.forEach(item => {
                if (!item.path) return;
                const dir = path.dirname(item.path);
                const folderPath = (dir === '.' ? '' : dir).replace(/\\/g, '/').replace(/^\//, '');
                
                if (!folderMap.has(folderPath)) {
                    folderMap.set(folderPath, {
                        path: folderPath,
                        count: 0,
                        coverItem: null
                    });
                }
                
                const folderData = folderMap.get(folderPath);
                folderData.count++;
                
                // Pick the first image as cover, or video if no image yet
                if (item.type) {
                    if (!folderData.coverItem || (folderData.coverItem.type.startsWith('video/') && item.type.startsWith('image/'))) {
                        folderData.coverItem = item;
                    }
                }
            });
        }

        const folders = Array.from(folderMap.values()).map(f => ({
            ...f,
            coverItem: f.coverItem ? formatItemForClient(f.coverItem) : null
        }));

        res.json({ folders });
    } catch(e) {
        console.error("Folder List API Error", e);
        res.status(500).json({ error: "Failed to list folders" });
    }
});

// Stream Media Content
app.get('/media-stream/:filepath', (req, res) => {
  const reqPath = decodeURIComponent(req.params.filepath);
  
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