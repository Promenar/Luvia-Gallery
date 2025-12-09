const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 80;
// Media root directory inside the container
const MEDIA_ROOT = '/media'; 
const CONFIG_FILE = path.join(__dirname, 'lumina-config.json');

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve built frontend assets
app.use(express.static(path.join(__dirname, 'build')));

// --- Helper Functions ---

// Recursively scan directory
const scanDirectory = (dirPath, rootPath = '') => {
  let results = [];
  try {
    const list = fs.readdirSync(dirPath);
    list.forEach(file => {
      // Skip hidden files
      if (file.startsWith('.')) return;

      const fullPath = path.join(dirPath, file);
      const relativePath = path.join(rootPath, file);
      
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          results = results.concat(scanDirectory(fullPath, relativePath));
        } else {
          const mimeType = mime.lookup(fullPath);
          if (mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/'))) {
            results.push({
              name: file,
              path: relativePath,
              fullPath: fullPath,
              size: stat.size,
              lastModified: stat.mtimeMs,
              type: mimeType
            });
          }
        }
      } catch (err) {
        // Ignore permission errors or bad links
      }
    });
  } catch (e) {
    console.error(`Error reading directory ${dirPath}:`, e);
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
    // Return null to indicate no config exists yet (trigger setup)
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
  if (!fs.existsSync(MEDIA_ROOT)) {
    return res.json({ files: [], sources: [] });
  }

  console.log('Starting media scan...');
  const rawFiles = scanDirectory(MEDIA_ROOT);
  
  const mediaItems = rawFiles.map(f => {
    // Use base64 of path as ID to be consistent across reloads
    const id = Buffer.from(f.path).toString('base64');
    return {
      id: id,
      url: `/media-stream/${encodeURIComponent(f.path)}`, // Stream endpoint
      name: f.name,
      path: f.path,
      folderPath: path.dirname(f.path) === '.' ? '' : path.dirname(f.path),
      size: f.size,
      type: f.type,
      lastModified: f.lastModified,
      mediaType: f.type.startsWith('video/') ? 'video' : 'image',
      sourceId: 'nas-storage'
    };
  });

  // Calculate folder stats for "sources" UI
  const rootFolders = new Set();
  mediaItems.forEach(item => {
      const root = item.path.split(path.sep)[0];
      if (root) rootFolders.add(root);
  });
  
  const sources = [{ 
      id: 'nas-storage', 
      name: 'NAS Library', 
      count: mediaItems.length 
  }];

  console.log(`Scan complete. Found ${mediaItems.length} items.`);
  res.json({ files: mediaItems, sources });
});

// Stream Media Content (Support Range Requests for Video)
app.get('/media-stream/:filepath', (req, res) => {
  const reqPath = decodeURIComponent(req.params.filepath);
  // Security: prevent directory traversal
  const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
  const absolutePath = path.join(MEDIA_ROOT, safePath);

  if (!fs.existsSync(absolutePath)) {
    return res.status(404).send('Not found');
  }

  const stat = fs.statSync(absolutePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';

  if (range) {
    // Handling Range header (Essential for video seeking)
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(absolutePath, { start, end });
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
    fs.createReadStream(absolutePath).pipe(res);
  }
});

// SPA Fallback: Send index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Mapping /media to: ${MEDIA_ROOT}`);
});