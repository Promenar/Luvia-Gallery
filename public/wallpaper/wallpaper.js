/**
 * Luvia Gallery - Advanced Wallpaper Engine Renderer (Universal + Auto-Detection)
 * Fixes: Text property rendering, generic property matching, storage fallback.
 */

const CONFIG = {
    serverUrl: localStorage.getItem('l_server') || '',
    token: localStorage.getItem('l_token') || '',
    mode: localStorage.getItem('l_mode') || 'random',
    path: localStorage.getItem('l_path') || '',
    interval: parseInt(localStorage.getItem('l_interval')) || 30000,
    showInfo: localStorage.getItem('l_info') !== 'false',
    showVideos: localStorage.getItem('l_videos') !== 'false',
    scalingMode: localStorage.getItem('l_scaling') || 'cover',
    overlayOpacity: parseInt(localStorage.getItem('l_opacity')) || 60,
    blurAmount: parseInt(localStorage.getItem('l_blur')) || 0,
    apiEndpoint: '/api/scan/results',
    isPaused: false,
    items: [],
    currentIndex: 0
};

const elements = {
    container: document.getElementById('wallpaper-container'),
    overlay: document.getElementById('overlay'),
    infoOverlay: document.getElementById('info-overlay'),
    itemName: document.getElementById('item-name'),
    itemFolder: document.getElementById('item-folder'),
    status: document.getElementById('status-msg'),
    guide: document.getElementById('setup-guide')
};

/**
 * HELPER: URL Construction
 */
function getFullUrl(relativePath) {
    let base = (CONFIG.serverUrl || '').trim();

    // Fallback: If serverUrl is empty, try to get from localStorage (last resort)
    if (!base) base = (localStorage.getItem('l_server') || '').trim();

    if (base && base !== '') {
        if (!base.startsWith('http')) base = 'http://' + base;
        if (base.endsWith('/')) base = base.slice(0, -1);
    } else {
        // Return blank to avoid resolving relative to file:// on local disk
        console.warn("[Luvia] No server URL configured.");
        return '';
    }

    const cleanRelative = relativePath.startsWith('/') ? relativePath : '/' + relativePath;
    return `${base}${cleanRelative}`;
}

function getMediaUrl(itemUrl) {
    if (!itemUrl) return '';
    const baseUrl = getFullUrl(itemUrl);
    if (!baseUrl || baseUrl === '') return ''; // BLOCK Relative fallback
    // Avoid double tokens by cleaning up first
    const cleanBase = baseUrl.split('?token=')[0].split('&token=')[0];
    const connector = cleanBase.includes('?') ? '&' : '?';
    return `${cleanBase}${connector}token=${encodeURIComponent(CONFIG.token)}`;
}

/**
 * WALLPAPER ENGINE PROPERTY LISTENER (GENERIC MATCHING)
 */
window.wallpaperPropertyListener = {
    applyUserProperties: function (properties) {
        console.log("[Luvia] Properties Received:", Object.keys(properties));
        let needsRestart = false;

        for (const key in properties) {
            const val = properties[key].value;
            const lowKey = key.toLowerCase();
            console.log(`[Luvia] Property: ${key} = ${val}`);

            if (lowKey.includes('server')) {
                if (CONFIG.serverUrl !== val) {
                    CONFIG.serverUrl = val;
                    localStorage.setItem('l_server', val);
                    needsRestart = true;
                }
            } else if (lowKey.includes('token')) {
                if (CONFIG.token !== val) {
                    CONFIG.token = val;
                    localStorage.setItem('l_token', val);
                    needsRestart = true;
                }
            } else if (lowKey.includes('path')) {
                if (CONFIG.path !== val) {
                    CONFIG.path = val;
                    localStorage.setItem('l_path', val);
                    if (CONFIG.mode === 'folder') needsRestart = true;
                }
            } else if (lowKey.includes('mode')) {
                if (CONFIG.mode !== val) {
                    CONFIG.mode = val;
                    localStorage.setItem('l_mode', val);
                    needsRestart = true;
                }
            } else if (lowKey.includes('freq')) {
                const ms = val * 1000;
                if (CONFIG.interval !== ms) {
                    CONFIG.interval = ms;
                    localStorage.setItem('l_interval', ms);
                    if (carouselTimer) { clearInterval(carouselTimer); startCarousel(); }
                }
            } else if (lowKey.includes('info')) {
                CONFIG.showInfo = val;
                localStorage.setItem('l_info', val);
                elements.infoOverlay.classList.toggle('hidden', !val);
            } else if (lowKey.includes('videos')) {
                if (CONFIG.showVideos !== val) {
                    CONFIG.showVideos = val;
                    localStorage.setItem('l_videos', val);
                    needsRestart = true;
                }
            } else if (lowKey.includes('opacity')) {
                console.log("[Luvia] Opacity update detected:", val);
                CONFIG.overlayOpacity = val;
                localStorage.setItem('l_opacity', val);
                document.body.style.setProperty('--overlay-opacity', val / 100);
            } else if (lowKey.includes('scaling')) {
                CONFIG.scalingMode = val;
                localStorage.setItem('l_scaling', val);
                document.body.style.setProperty('--media-fit', val);
            } else if (lowKey.includes('blur')) {
                console.log("[Luvia] Blur update detected:", val);
                CONFIG.blurAmount = val;
                localStorage.setItem('l_blur', val);
                const thumbBlurVal = val > 0 ? val : 40;
                document.body.style.setProperty('--blur-amount', `${val}px`);
                document.body.style.setProperty('--thumb-blur', `${thumbBlurVal}px`);
            }
        }

        if (needsRestart && CONFIG.token && CONFIG.token !== "YOUR_TOKEN" && CONFIG.token !== "") {
            start();
        }
    }
};




async function init() {
    // ✨ Load Error Manager Module
    const script = document.createElement('script');
    script.src = 'error-manager.js';
    script.onload = () => {
        console.log("[Luvia] Error Manager Loaded");
        window.ErrorManager.init();

        // Auto-check on load (Show report if errors exist from previous scan)
        window.ErrorManager.checkAndOpen();

        // Manual Trigger: Shift + E
        document.addEventListener('keydown', (e) => {
            if (e.shiftKey && (e.key === 'E' || e.key === 'e')) {
                console.log("[Luvia] Manual trigger: Error Manager");
                window.ErrorManager.checkAndOpen().then(shown => {
                    if (!shown) showOverlay("No errors found in last scan.", true);
                    else hideOverlay();
                });
            }
        });
    };
    document.head.appendChild(script);

    console.log("[Luvia] Universal Renderer Initializing...");
    console.log("[Luvia] Current URL:", window.location.href);

    // --- NUCLEAR CACHE CLEANUP (Bypass SW Persistence) ---
    // NO PROTOCOL RESTRICTION: Even on file://, we must try to unregister leftover SWs from previous Luvia sessions
    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.unregister();
                console.log("[Luvia] Old Service Worker unregistered.");
            }
        } catch (err) {
            console.warn("[Luvia] SW Cleanup Error (Caught):", err.message);
        }
    }
    // Clean caches if they exist
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            for (let key of keys) {
                await caches.delete(key);
                console.log("[Luvia] Cache storage cleared:", key);
            }
        } catch (err) { }
    }

    // Check browser video capabilities
    checkCapabilities();

    // Support URL Search Params (Hidamari / Manual Call)
    const urlParams = new URLSearchParams(window.location.search);
    const pToken = urlParams.get('token') || urlParams.get('API_TOKEN') || urlParams.get('l_token');
    const pServer = urlParams.get('server') || urlParams.get('serverUrl') || urlParams.get('ServerAddress') || urlParams.get('l_server');

    if (pToken) {
        console.log("[Luvia] Config: Token found in URL");
        CONFIG.token = pToken;
    }
    if (pServer) {
        console.log("[Luvia] Config: Server found in URL");
        CONFIG.serverUrl = pServer;
    } else {
        // HIDAMARI / WEB AUTO-DETECT: If no server param, use current origin or relative base
        if (window.location.protocol.startsWith('http')) {
            console.log("[Luvia] Config: Path fallback to origin -", window.location.origin);
            CONFIG.serverUrl = window.location.origin;
        } else {
            // WE Fallback check: if already set by localStorage, don't clear it
            console.log("[Luvia] Config: No server in URL, keeping current:", CONFIG.serverUrl || 'EMPTY');
        }
    }

    // Optional params
    const pPath = urlParams.get('path') || urlParams.get('folder');
    if (pPath) CONFIG.path = pPath;
    const pInterval = urlParams.get('interval');
    if (pInterval) {
        CONFIG.interval = parseInt(pInterval) * 1000;
        console.log("[Luvia] Config: Interval set from URL -", CONFIG.interval, "ms");
    }
    const pInfo = urlParams.get('info');
    if (pInfo) {
        CONFIG.showInfo = pInfo !== 'false';
        elements.infoOverlay.classList.toggle('hidden', !CONFIG.showInfo);
    }
    const pVideos = urlParams.get('videos');
    if (pVideos) {
        CONFIG.showVideos = pVideos !== 'false';
        console.log("[Luvia] Config: Video visibility set from URL -", CONFIG.showVideos);
    }
    const pScaling = urlParams.get('scaling');
    if (pScaling) {
        CONFIG.scalingMode = pScaling;
        document.body.style.setProperty('--media-fit', pScaling);
    }

    // Apply styles
    document.body.style.setProperty('--media-fit', CONFIG.scalingMode);
    document.body.style.setProperty('--overlay-opacity', CONFIG.overlayOpacity / 100);
    const thumbBlurVal = CONFIG.blurAmount > 0 ? CONFIG.blurAmount : 40;
    document.body.style.setProperty('--blur-amount', `${CONFIG.blurAmount}px`);
    document.body.style.setProperty('--thumb-blur', `${thumbBlurVal}px`);

    console.log("[Luvia] Final Init Config:", { server: CONFIG.serverUrl ? "SET" : "EMPTY", token: CONFIG.token ? "SET" : "EMPTY", mode: CONFIG.mode, interval: CONFIG.interval, videos: CONFIG.showVideos });

    if (CONFIG.token && CONFIG.token !== "" && CONFIG.token !== "YOUR_TOKEN" && CONFIG.serverUrl && CONFIG.serverUrl !== "") {
        start();
    } else {
        showOverlay("Welcome to Luvia. Please set Server Address & Token in Wallpaper Engine.", true);
        console.warn("[Luvia] Config incomplete. Waiting for Properties...");
    }

    // --- NETWORK RECOVERY HANDLING ---
    window.addEventListener('online', () => {
        console.log("[Luvia] Network restored. Checking if reload is needed...");
        if (CONFIG.items.length === 0 && CONFIG.token && CONFIG.serverUrl) {
            console.log("[Luvia] No items loaded, triggering auto-reload...");
            start();
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume();
        else pause();
    }); // End event listener

    // ✨ Scan Status Monitoring (Auto-Show Reports)
    monitorScanStatus();
}

let _isScanning = false;
async function monitorScanStatus() {
    setInterval(async () => {
        if (!CONFIG.serverUrl || !CONFIG.token) return;
        try {
            const res = await fetch(`${CONFIG.serverUrl}/api/scan/status?token=${CONFIG.token}`);
            if (res.ok) {
                const data = await res.json();
                const status = data.status || 'idle';

                if (status === 'scanning' || status === 'processing') {
                    _isScanning = true;
                    // Optional: Update some UI indicator?
                } else if (status === 'idle' && _isScanning) {
                    _isScanning = false;
                    console.log("[Luvia] Scan finished. Checking for errors...");
                    if (window.ErrorManager) {
                        window.ErrorManager.checkAndOpen();
                    }
                }
            }
        } catch (e) { /* quiet failure */ }
    }, 2000);
}

async function start() {
    if (!CONFIG.token || CONFIG.token === "" || CONFIG.token === "YOUR_TOKEN") {
        showOverlay("Waiting for API Token...", true);
        return;
    }

    showOverlay(`Loading from: ${CONFIG.serverUrl || 'Default'}`);

    try {
        const success = await fetchItems();
        if (success) {
            hideOverlay();
            startCarousel();
        } else {
            showOverlay("Fetch failed. No items found or invalid response.", true);
        }
    } catch (e) {
        console.error("[Luvia] Connection Error:", e);
        showOverlay("Connection Error. Checking network...", true);

        // Optional: Simple retry after 5s if still offline or connection failed
        setTimeout(() => {
            if (CONFIG.items.length === 0) {
                console.log("[Luvia] Retrying initial load...");
                start();
            }
        }, 10000);
    }
}

async function fetchItems() {
    try {
        let apiUrl = `${CONFIG.apiEndpoint}?random=true&limit=100&token=${CONFIG.token}`;
        if (CONFIG.mode === 'favorites') apiUrl += '&favorites=true&recursive=true';
        else if (CONFIG.mode === 'folder' && CONFIG.path) apiUrl += `&folder=${encodeURIComponent(CONFIG.path)}&recursive=true`;

        const fullApiUrl = getFullUrl(apiUrl);
        if (!fullApiUrl) return false;

        const response = await fetch(fullApiUrl);
        if (!response.ok) {
            console.error("[Luvia] API Response Error:", response.status);
            return false;
        }

        const data = await response.json();
        if (data && data.files && data.files.length > 0) {
            let filtered = data.files;
            if (CONFIG.showVideos === false) {
                filtered = data.files.filter(f => f.mediaType !== 'video');
                console.log("[Luvia] Video filtering ACTIVE, kept", filtered.length, "images");
            }
            CONFIG.items = filtered.sort(() => Math.random() - 0.5);
            CONFIG.currentIndex = 0;
            return true;
        }
        return false;
    } catch (e) {
        console.error("[Luvia] Fetch Exception:", e.message);
        throw e;
    }
}

let carouselTimer = null;
function startCarousel() {
    if (carouselTimer) clearInterval(carouselTimer);
    renderCurrent();
    carouselTimer = setInterval(() => { if (!CONFIG.isPaused) next(); }, CONFIG.interval);
}

function next() {
    CONFIG.currentIndex++;
    if (CONFIG.currentIndex >= CONFIG.items.length) {
        fetchItems().then(success => {
            if (success) renderCurrent();
            else {
                console.warn("[Luvia] Failed to refresh item list, will retry on next interval.");
                // Keep currentIndex at the end so it tries again next time
                CONFIG.currentIndex = CONFIG.items.length;
            }
        }).catch(err => {
            console.error("[Luvia] Error refreshing items in next():", err.message);
            CONFIG.currentIndex = CONFIG.items.length;
        });
    } else {
        renderCurrent();
    }
}

function renderCurrent() {
    const item = CONFIG.items[CONFIG.currentIndex];
    if (!item) return;

    if (CONFIG.showInfo) {
        elements.itemName.textContent = item.name;
        elements.itemFolder.textContent = item.folderPath || 'Library Root';
        elements.infoOverlay.classList.remove('hidden');
    }

    const oldSlides = elements.container.querySelectorAll('.slide');
    oldSlides.forEach(oldSlide => {
        oldSlide.classList.remove('active');
        oldSlide.classList.add('exit');
        const v = oldSlide.querySelector('video');
        if (v) setTimeout(() => { v.pause(); v.src = ""; v.load(); v.remove(); }, 1600);
    });

    const slide = document.createElement('div');
    slide.className = 'slide';

    const thumb = document.createElement('img');
    thumb.className = 'thumb-placeholder';
    thumb.src = getMediaUrl(item.thumbnailUrl);
    slide.appendChild(thumb);

    let media;
    let hasTriggeredLoad = false;

    // Safety timeout: If media takes > 5s to load, force show it anyway to prevent "stuck at thumb"
    const loadTimeout = setTimeout(() => {
        if (!hasTriggeredLoad) {
            console.warn("[Luvia] Media load timeout, forcing display...");
            onMediaLoaded();
        }
    }, 5000);

    const onMediaLoaded = () => {
        if (hasTriggeredLoad) return;
        hasTriggeredLoad = true;
        clearTimeout(loadTimeout);

        console.log("[Luvia] Media loaded successfully");
        media.classList.add('loaded');
        thumb.classList.add('fade-out');
        setTimeout(() => { if (slide.contains(thumb)) slide.removeChild(thumb); }, 1600);
    };

    if (item.mediaType === 'video') {
        const videoUrl = getMediaUrl(item.url);
        media = document.createElement('video');
        media.className = 'full-content';
        media.muted = true;
        media.autoplay = true;
        media.loop = true;
        media.playsInline = true;
        media.setAttribute('preload', 'auto');
        media.crossOrigin = "anonymous";

        // Use source tag for better MIME/Codec hint to WE
        const source = document.createElement('source');
        source.src = videoUrl;

        // Map common extensions to types
        const ext = (item.url || '').split('.').pop().toLowerCase();
        const typeMap = { 'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime', 'm4v': 'video/x-m4v' };
        source.type = typeMap[ext] || 'video/mp4';

        media.appendChild(source);

        media.oncanplaythrough = onMediaLoaded;
        media.onplaying = onMediaLoaded;
        media.onplay = onMediaLoaded;
        media.onerror = (e) => {
            console.error("[Luvia] Video error:", item.url);
            console.error("[Luvia] Full Request URL:", videoUrl);
            console.warn("[Luvia] Possible Cause: Unsecured HTTPS (Self-signed), Missing Codec (H.265 in WE), or Network Block.");
            onMediaLoaded();
        };

        // Explicitly trigger play with defensive 100ms delay (Rule 8.1 / GPU Crash Guard)
        setTimeout(() => {
            if (media && media.tagName === 'VIDEO') {
                // RACE CONDITION GUARD: If wallpaper was paused while waiting for timeout
                if (CONFIG.isPaused) {
                    console.log("[Luvia] Playback aborted: Wallpaper is currently paused.");
                    return;
                }

                media.play().catch(err => {
                    if (err.name === 'AbortError') {
                        console.log("[Luvia] Playback Aborted (Normal race condition).");
                        return;
                    }
                    console.error("[Luvia] Video Playback Failed!");
                    console.error("[Luvia] DOMException:", err.name, "-", err.message);
                    if (err.name === 'NotSupportedError') {
                        console.error("[Luvia] CRITICAL: The browser claims it cannot play this video. This almost certainly means it's H.265/HEVC which Wallpaper Engine (CEF) doesn't support.");
                    }
                });
            }
        }, 100);
    } else {
        media = document.createElement('img');
        media.className = 'full-content';
        media.src = getMediaUrl(item.url);
        media.onload = onMediaLoaded;
        media.onerror = onMediaLoaded;
    }

    slide.appendChild(media);
    elements.container.appendChild(slide);

    requestAnimationFrame(() => { requestAnimationFrame(() => { slide.classList.add('active'); }); });

    // Clean up registry to prevent DOM bloating and memory leaks
    setTimeout(() => {
        const deadSlides = elements.container.querySelectorAll('.exit');
        deadSlides.forEach(s => {
            if (elements.container.contains(s)) {
                // Explicitly stop all media before removal
                const mediaElems = s.querySelectorAll('video, img');
                mediaElems.forEach(m => {
                    if (m.tagName === 'VIDEO') {
                        m.pause();
                        m.src = "";
                        // m.load(); // REMOVED: causes decoder reallocation crash on some CEF builds
                    }
                    m.remove();
                });
                elements.container.removeChild(s);
            }
        });

        // Final sanity check: if container has too many slides, force flush
        if (elements.container.children.length > 5) {
            console.warn("[Luvia] Slide accumulation detected, flushing container...");
            while (elements.container.children.length > 2) {
                elements.container.removeChild(elements.container.firstChild);
            }
        }
    }, 2500);
}

// Global Crash Guard
window.onerror = function (message, source, lineno, colno, error) {
    console.error(`[Luvia] Runtime Crash Caught: ${message} at ${lineno}:${colno}`);
    // Optional: auto-reload on crash if critical?
    // location.reload();
    return false;
};

function checkCapabilities() {
    const v = document.createElement('video');
    const caps = {
        'H.264 (mp4)': v.canPlayType('video/mp4; codecs="avc1.42E01E"'),
        'H.265 (hevc)': v.canPlayType('video/mp4; codecs="hvc1"'),
        'WebM (vp8)': v.canPlayType('video/webm; codecs="vp8, vorbis"'),
        'WebM (vp9)': v.canPlayType('video/webm; codecs="vp9"')
    };
    console.log("[Luvia] Environment Capabilities:", caps);

    if (caps['H.265 (hevc)'] === '') {
        console.warn("[Luvia] ALERT: This environment DOES NOT support H.265 (HEVC). Videos in this format will fail.");
    }
}

function pause() { CONFIG.isPaused = true; document.querySelectorAll('video').forEach(v => v.pause()); }
function resume() {
    CONFIG.isPaused = false;
    document.querySelectorAll('video').forEach(v => { if (v.closest('.slide.active')) v.play().catch(() => { }); });
}

function showOverlay(msg, showGuide = false) {
    elements.overlay.classList.remove('hidden');
    elements.status.innerText = msg;
    if (showGuide) elements.guide.classList.remove('hidden');
}

function hideOverlay() { elements.overlay.classList.add('hidden'); }

init();
