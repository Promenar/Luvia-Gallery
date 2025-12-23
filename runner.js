const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const EXTERNAL_PORT = 3001;
const INTERNAL_PORT = 3002;
const MAX_RETRIES = 3;
const RETRY_WINDOW = 60000; // 1 minute
const SERVER_SCRIPT = 'server.js';

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

// Function to handle updates (Git Pull + Rebuild)
function performUpdate(res) {
    if (updateInProgress) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Update already in progress" }));
        return;
    }

    updateInProgress = true;
    log("Starting System Update...");

    // Notify client the update started
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write(JSON.stringify({ status: "started", message: "Update process started. Check logs." }) + "\n");
    // Don't close res yet if we want to stream partial results, 
    // but simplified: we respond then kill connection or keep it to stream? 
    // Let's just respond immediately, the client will poll or wait for reload.
    // Actually, client expects a response. Let's finish response.
    res.end();

    // Kill child process if running
    if (childProcess) {
        log("Stopping app for update...");
        childProcess.kill();
    }

    // Run update script
    const updateScript = path.join(__dirname, 'scripts', 'update.sh');
    const updateCmd = spawn('sh', [updateScript], { stdio: 'inherit' });

    updateCmd.on('close', (code) => {
        updateInProgress = false;
        if (code === 0) {
            log("Update successful! Restarting app...");
            isSafeMode = false; // Reset safe mode on successful update
            retryCount = 0;
            startApp();
        } else {
            log(`Update failed with code ${code}. Remaining in current state.`);
            // If we were in safe mode, stay in safe mode. 
            // If we were normal, try to restart old app? (Likely broken if git pull half-succeeded)
            // Safer to go to Safe Mode if update fails to be sure user checks logs.
            isSafeMode = true;
        }
    });
}

// Safe Mode HTML
const SAFE_MODE_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Lumina Gallery - Recovery Mode</title>
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
        <h1>⚠️ SYSTEM CRASH DETECTED</h1>
        <p>The application backend has crashed repeatedly.</p>
        <p>Running in <strong>SAFE MODE</strong> (Supervisor).</p>
        <hr style="border-color: #444; margin: 20px 0;">
        <p>1. Check container logs for errors.<br>2. Push a fix to the repository.<br>3. Click below to pull update & restart.</p>
        <button onclick="triggerUpdate()">FORCE SYSTEM UPDATE</button>
        <p id="status" style="margin-top: 15px; font-size: 14px; color: #888;"></p>
    </div>
    <script>
        function triggerUpdate() {
            const btn = document.querySelector('button');
            const stat = document.getElementById('status');
            btn.disabled = true;
            btn.innerText = "UPDATING...";
            stat.innerText = "Pulling from git & rebuilding... this may take a minute.";
            
            fetch('/api/admin/system/update', { method: 'POST' })
                .then(r => r.json())
                .then(d => {
                    stat.innerText = "Command sent: " + d.message + " Reloading in 30s...";
                    setTimeout(() => location.reload(), 30000);
                })
                .catch(e => {
                    stat.innerText = "Error: " + e.message;
                    btn.disabled = false;
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

// Main Supervisor Server
const server = http.createServer((req, res) => {
    // 1. Handle Update Endpoint (Always available)
    if (req.url === '/api/admin/system/update' && req.method === 'POST') {
        return performUpdate(res);
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
