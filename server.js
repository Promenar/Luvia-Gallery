const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 80;
const MEDIA_ROOT = process.env.MEDIA_ROOT || '/media'; 
const CONFIG_FILE = path.join(__dirname, 'lumina-config.json');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use(express.static(path.join(__dirname, 'build')));

// --- Helper Functions ---

// Recursively scan directory
// baseDir: The physical absolute path on the server/container (e.g. /photos)
// currentSubDir: The traversal path relative to baseDir (e.g. 2023/Holidays)
// rootAlias: The logical name to show in frontend (e.g. /photos)
const scanDirectory = (baseDir, currentSubDir = '', rootAlias = '') => {
  let results = [];
  const fullPathToScan = path.join(baseDir, currentSubDir);

  try {
    if (!fs.existsSync(fullPathToScan)) return results;

    const list = fs.readdirSync(fullPathToScan);
    list.forEach(file => {
      if (file.startsWith('.')) return;

      const fullFilePath = path.join(fullPathToScan, file);
      // Logical path for frontend: join rootAlias + subDir + file
      // If rootAlias is "/photos", result is "/photos/2023/img.jpg"
      const relativePath = path.join(rootAlias, currentSubDir, file);
      
      try {
        const stat = fs.statSync(fullFilePath);
        if (stat.isDirectory()) {
          results = results.concat(scanDirectory(baseDir, path.join(currentSubDir, file), rootAlias));
        } else {
          const mimeType = mime.lookup(fullFilePath);
          if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
            results.push({
              name: file,
              path: relativePath,
              // We use the absolute path for streaming to support multiple roots
              streamPath: fullFilePath, 
              size: stat.size,
              lastModified: stat.mtimeMs,
              type: mimeType
            });
          }
        }
      } catch (err) {
        // Ignore permission errors
      }
    });
  } catch (e) {
    console.error(`Error reading directory ${fullPathToScan}:`, e);
  }
  return results;
};

// --- API Endpoints ---

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

// Scan Media Files
app.get('/api/scan', (req, res) => {
  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { console.error("Config read error", e); }

  // Determine paths to scan
  // If config.libraryPaths is set, use those. 
  // Otherwise default to scanning MEDIA_ROOT.
  const pathsToScan = (config.libraryPaths && config.libraryPaths.length > 0) 
    ? config.libraryPaths 
    : [MEDIA_ROOT];

  console.log(`Starting media scan. Roots: ${JSON.stringify(pathsToScan)}`);
  
  let allMediaItems = [];
  const sources = [];

  pathsToScan.forEach(pathInput => {
     // Determine absolute path
     // If input starts with '/', treat as absolute container path.
     // Otherwise treat as relative to default MEDIA_ROOT.
     const isAbsolute = pathInput.startsWith('/');
     const absoluteScanPath = isAbsolute ? pathInput : path.join(MEDIA_ROOT, pathInput);
     
     // Sanitization to prevent traversing out if using relative paths (simple check)
     const normalized = path.normalize(absoluteScanPath);
     
     if (!fs.existsSync(normalized)) {
         console.warn(`Path not found: ${normalized}`);
         return;
     }

     const items = scanDirectory(normalized, '', pathInput); 
     
     if (items.length > 0) {
         const processedItems = items.map(f => ({
            id: Buffer.from(f.streamPath).toString('base64'),
            url: `/media-stream/${encodeURIComponent(f.streamPath)}`,
            name: f.name,
            path: f.path, // Logical path shown in UI
            folderPath: path.dirname(f.path) === '.' ? '' : path.dirname(f.path),
            size: f.size,
            type: f.type,
            lastModified: f.lastModified,
            mediaType: f.type.startsWith('video/') ? 'video' : 'image',
            sourceId: `nas-${Buffer.from(pathInput).toString('base64')}`
         }));
         
         allMediaItems = allMediaItems.concat(processedItems);
         sources.push({
             id: `nas-${Buffer.from(pathInput).toString('base64')}`,
             name: pathInput,
             count: processedItems.length
         });
     }
  });

  console.log(`Scan complete. Found ${allMediaItems.length} items.`);
  res.json({ files: allMediaItems, sources });
});

// Stream Media Content
app.get('/media-stream/:filepath', (req, res) => {
  const reqPath = decodeURIComponent(req.params.filepath);
  // reqPath is now the Absolute Path on the server
  
  // Security Validation: 
  // Ensure the requested path is within one of the allowed library paths (or MEDIA_ROOT)
  // to prevent reading arbitrary system files.
  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) {}

  const validRoots = (config.libraryPaths && config.libraryPaths.length > 0) 
    ? config.libraryPaths.map(p => p.startsWith('/') ? p : path.join(MEDIA_ROOT, p))
    : [MEDIA_ROOT];

  // Add MEDIA_ROOT to valid roots fallback if strictly empty config
  if (validRoots.length === 0) validRoots.push(MEDIA_ROOT);

  const normalizedReqPath = path.normalize(reqPath);
  const isAllowed = validRoots.some(root => normalizedReqPath.startsWith(path.normalize(root)));

  if (!isAllowed) {
      console.warn(`Blocked access to: ${normalizedReqPath}`);
      return res.status(403).send('Access Denied: File not in allowed library paths');
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
  console.log(`Default Media Root: ${MEDIA_ROOT}`);
});