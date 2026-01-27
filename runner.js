const http = require('http');
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const EXTERNAL_PORT = 3001;
const INTERNAL_PORT = 3002;
const MAX_RETRIES = 3;
const RETRY_WINDOW = 60000; // 1 minute
const SERVER_SCRIPT = 'server.js';

const CONFIG_FILE = path.join(__dirname, 'data', 'update_config.json');
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// State
let childProcess = null;
let retryCount = 0;
let lastRetryTime = 0;
let isSafeMode = false;
let updateInProgress = false;

// Helper: Log with timestamp
function log(msg) {
    console.log(`[Supervisor] ${new Date().toISOString()} - ${msg}`);
}

function getUpdateConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) { }
    return { repoUrl: 'git@github.com:NarcisWL/Luvia-Gallery.git', branch: 'main' };
}

// Helper: Setup SSH keys for remote operations (Sync version for API)
function prepareSSHSync() {
    try {
        const sshDir = path.join(process.env.HOME || '/root', '.ssh');
        if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

        // Import keys from mount if available
        const mountDir = '/tmp/ssh_mount';
        if (fs.existsSync(mountDir)) {
            const files = fs.readdirSync(mountDir);
            for (const file of files) {
                const src = path.join(mountDir, file);
                const dest = path.join(sshDir, file);
                fs.copyFileSync(src, dest);
                fs.chmodSync(dest, 0o600);
            }
        }

        // Add GitHub to known_hosts
        const hostsPath = path.join(sshDir, 'known_hosts');
        if (!fs.existsSync(hostsPath)) {
            // We use a simple echo if we can't scan, but usually keyscan is better.
            // For now, assume update.sh does the heavy scanning, but let's try a safe approach
            try {
                exec(`ssh-keyscan github.com >> ${hostsPath}`);
            } catch (e) { }
        }
        return true;
    } catch (e) {
        log(`SSH Prep Error: ${e.message}`);
        return false;
    }
}

// Function to start the main application
function startApp() {
    if (isSafeMode) return;

    // Reset retry count if enough time passed
    if (Date.now() - lastRetryTime > RETRY_WINDOW) {
        retryCount = 0;
    }

    log(`Starting ${SERVER_SCRIPT} on port ${INTERNAL_PORT}...`);

    childProcess = spawn('node', [SERVER_SCRIPT], {
        stdio: 'inherit',
        env: { ...process.env, PORT: INTERNAL_PORT }
    });

    childProcess.on('exit', (code, signal) => {
        log(`${SERVER_SCRIPT} exited with code ${code} / signal ${signal}`);

        if (updateInProgress) {
            log("Exit due to update. Not restarting immediately.");
            return;
        }

        retryCount++;
        lastRetryTime = Date.now();

        if (retryCount > MAX_RETRIES) {
            log(`CRITICAL: Crash loop detected (${retryCount} crashes in ${RETRY_WINDOW}ms). Entering SAFE MODE.`);
            isSafeMode = true;
            childProcess = null;
        } else {
            log(`Restarting in 2 seconds... (Attempt ${retryCount}/${MAX_RETRIES})`);
            setTimeout(startApp, 2000);
        }
    });

    childProcess.on('error', (err) => {
        log(`Failed to spawn child process: ${err}`);
        retryCount++; // Immediate fail counts as retry
        if (retryCount > MAX_RETRIES) {
            isSafeMode = true;
            childProcess = null;
        }
    });
}

// Helper: Get hash of current file (Supervisor)
const crypto = require('crypto');
function getSelfHash() {
    try {
        const content = fs.readFileSync(__filename);
        return crypto.createHash('md5').update(content).digest('hex');
    } catch (e) {
        return null;
    }
}

// Initial Hash
const initialHash = getSelfHash();
log(`Supervisor initialized. Hash: ${initialHash}`);

// Log Security Status
const hasEnvToken = !!process.env.UPDATE_TOKEN;
const hasLocalToken = fs.existsSync(path.join(__dirname, 'data', 'update_secret.txt'));
const hasVolumeToken = fs.existsSync(path.join('/app/data', 'update_secret.txt'));
log(`Update Token Protection: ${hasEnvToken || hasLocalToken || hasVolumeToken ? 'ENABLED 🔒' : 'DISABLED ⚠️'}`);

// Function to handle updates (Git Pull + Rebuild)
function performUpdate(res) {
    if (updateInProgress) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Update already in progress" }));
        return;
    }

    updateInProgress = true;
    log("Starting System Update...");

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ status: "started", message: "Update process started." }) + "\n");
    res.end();

    if (childProcess) {
        log("Stopping app for update...");
        childProcess.kill();
    }

    const config = getUpdateConfig();
    const updateScript = path.join(__dirname, 'scripts', 'update.sh');
    const updateCmd = spawn('sh', [updateScript], {
        stdio: 'inherit',
        env: { ...process.env, REPO_URL: config.repoUrl, BRANCH: config.branch }
    });

    updateCmd.on('close', (code) => {
        updateInProgress = false;
        if (code === 0) {
            log("Update successful!");

            // Check if Supervisor (this file) was updated
            const newHash = getSelfHash();
            if (newHash && newHash !== initialHash) {
                log(`Supervisor update detected (${initialHash} -> ${newHash}). Exiting to let Docker restart container...`);
                process.exit(0); // Docker Restart Policy will bring us back up with new code
            }

            log("Restarting app...");
            isSafeMode = false;
            retryCount = 0;
            startApp();
        } else {
            log(`Update failed with code ${code}. Remaining in current state.`);
            isSafeMode = true;
        }
    });
}

// Safe Mode HTML
const SAFE_MODE_HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Luvia Gallery - Recovery Mode</title>
    <style>
        body { font-family: monospace; background: #1a1a1a; color: #ff5555; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
        .box { border: 2px solid #ff5555; padding: 40px; border-radius: 8px; text-align: center; background: #2a2a2a; max-width: 600px; }
        button { background: #ff5555; color: white; border: none; padding: 10px 20px; font-size: 16px; cursor: pointer; margin-top: 20px; font-family: inherit; font-weight: bold; }
        button:hover { background: #ff7777; }
        h1 { margin-top: 0; }
        p { color: #ccc; }
    </style>
</head>
<body>
    <div class="box">
        <h1>⚠️ 系统崩溃 (System Crash)</h1>
        <p>后端服务多次崩溃，已进入安全模式。</p>
        <p>Running in <strong>SAFE MODE</strong> (Supervisor).</p>
        <hr style="border-color: #444; margin: 20px 0;">
        <p>1. 请检查容器日志。<br>2. 修复代码并推送到仓库。<br>3. 点击下方按钮拉取更新并重启。</p>
        <button onclick="triggerUpdate()">强制更新系统 (Force Update)</button>
        <p id="status" style="margin-top: 15px; font-size: 14px; color: #888;"></p>
    </div>
    <script>
        function triggerUpdate(token) {
            const btn = document.querySelector('button');
            const stat = document.getElementById('status');
            btn.disabled = true;
            btn.innerText = "UPDATING...";
            stat.innerText = "Pulling from git & rebuilding... this may take a minute.";
            
            const headers = {};
            if (token) headers['Authorization'] = 'Bearer ' + token;

            fetch('/api/admin/system/update', { method: 'POST', headers: headers })
                .then(r => {
                    if (r.status === 401) {
                         const input = prompt("Security Check: Please enter the Update Token.");
                         if (input) return triggerUpdate(input); // Retry
                         throw new Error("Update cancelled.");
                    }
                    return r.json().then(d => {
                        if (!r.ok) throw new Error(d.error || "Update failed");
                        return d;
                    });
                })
                .then(d => {
                    if (!d) return; // Handled by retry
                    stat.innerText = "Command sent: " + d.message + " Reloading in 30s...";
                    setTimeout(() => location.reload(), 30000);
                })
                .catch(e => {
                    stat.innerText = "Error: " + e.message;
                    btn.disabled = false;
                    btn.innerText = "FORCE SYSTEM UPDATE";
                });
        }
    </script>
</body>
</html>
`;

// Helper: Proxy request to Internal Backend
function proxyRequest(req, res) {
    const options = {
        hostname: 'localhost',
        port: INTERNAL_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
    };

    const proxy = http.request(options, (targetRes) => {
        res.writeHead(targetRes.statusCode, targetRes.headers);
        targetRes.pipe(res, { end: true });
    });

    proxy.on('error', (err) => {
        // If child is starting up, we might get connection refused.
        // Return 503 Service Unavailable so clients retry
        if (!res.headersSent) {
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('Service starting...');
        }
    });

    req.pipe(proxy, { end: true });
}

// Helper: Check for Admin Token
function checkAuth(req, res) {
    let requiredToken = process.env.UPDATE_TOKEN;
    if (!requiredToken) {
        try {
            const tokenPath = path.join(__dirname, 'data', 'update_secret.txt');
            if (fs.existsSync(tokenPath)) {
                requiredToken = fs.readFileSync(tokenPath, 'utf8').trim();
            } else {
                // Also check /app/data for Docker volume compatibility
                const altPath = path.join('/app/data', 'update_secret.txt');
                if (fs.existsSync(altPath)) {
                    requiredToken = fs.readFileSync(altPath, 'utf8').trim();
                }
            }
        } catch (e) { }
    }

    if (!requiredToken) return true; // No token set = open access

    const authHeader = req.headers['authorization'];
    const providedToken = authHeader && authHeader.split(' ')[1];

    if (providedToken !== requiredToken) {
        log(`Blocked unauthorized access attempt to ${req.url} from ${req.socket.remoteAddress}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Unauthorized: Invalid or missing Update Token." }));
        return false;
    }
    return true;
}

// Main Supervisor Server
const server = http.createServer((req, res) => {
    // 1. Handle Update Endpoint (Always available)
    if (req.url === '/api/admin/system/update' && req.method === 'POST') {
        if (!checkAuth(req, res)) return;
        return performUpdate(res);
    }

    // 1.1 Handle Update Status Check
    if (req.url === '/api/admin/system/update/status' && req.method === 'GET') {
        const config = getUpdateConfig();
        const branch = config.branch || 'main';
        let repoUrl = config.repoUrl;

        // Normalize URL: Ensure it ends with .git for better compatibility
        if (repoUrl.includes('github.com') && !repoUrl.endsWith('.git')) {
            repoUrl += '.git';
        }

        log(`Checking update status for ${branch} on ${repoUrl}...`);

        // Prepare SSH environment before checking
        if (repoUrl.startsWith('git@')) prepareSSHSync();

        // Preparation sequence:
        // 1. Ensure safe directory
        // 2. Ensure .git exists
        // 3. Force update remote 'origin'
        const prepCmd = `
            git config --global --add safe.directory "${path.resolve(__dirname)}" &&
            ( [ -d .git ] || git init ) &&
            ( git remote add origin "${repoUrl}" 2>/dev/null || git remote set-url origin "${repoUrl}" )
        `.replace(/\n/g, '').trim();

        exec(`${prepCmd} && git fetch -q origin ${branch} && git rev-parse HEAD && git rev-parse origin/${branch}`, (error, stdout, stderr) => {
            if (error) {
                log(`Status check failed: ${stderr || error.message}`);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Failed to check update status", details: stderr }));
                return;
            }

            const lines = stdout.trim().split('\n').filter(l => l.length === 40); // Commit hashes are 40 chars
            if (lines.length < 2) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: "Failed to parse commit hashes", output: stdout }));
                return;
            }

            const localHash = lines[0];
            const remoteHash = lines[lines.length - 1]; // Use last line as remote if there are extras

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                updatable: localHash !== remoteHash,
                local: localHash,
                remote: remoteHash,
                config: config
            }));
        });
        return;
    }

    // 1.2 Handle Update Config Update
    if (req.url === '/api/admin/system/update/config' && req.method === 'POST') {
        if (!checkAuth(req, res)) return;

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const newConfig = JSON.parse(body);
                if (!newConfig.repoUrl) throw new Error("Missing repoUrl");

                fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
                log(`Update config saved: ${newConfig.repoUrl} (${newConfig.branch})`);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: "Configuration saved successfully" }));
            } catch (e) {
                if (!res.headersSent) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: e.message }));
                }
            }
        });
        return;
    }

    // 2. Safe Mode Fallback
    if (isSafeMode) {
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end(SAFE_MODE_HTML);
        return;
    }

    // 3. Normal Proxy
    proxyRequest(req, res);
});

// Start Supervisor
server.listen(EXTERNAL_PORT, '0.0.0.0', () => {
    log(`Supervisor running on port ${EXTERNAL_PORT}`);
    startApp();
});
