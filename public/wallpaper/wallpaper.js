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
    overlayOpacity: parseInt(localStorage.getItem('l_opacity')) || 60,
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

        // Generic Key-Value Matching (Doesn't care about ID names)
        for (const key in properties) {
            const val = properties[key].value;
            const lowKey = key.toLowerCase();

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
            } else if (lowKey.includes('interval')) {
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
            } else if (lowKey.includes('opacity')) {
                CONFIG.overlayOpacity = val;
                localStorage.setItem('l_opacity', val);
                document.body.style.setProperty('--overlay-opacity', val / 100);
            }
        }

        if (needsRestart && CONFIG.token && CONFIG.token !== "YOUR_TOKEN" && CONFIG.token !== "") {
            start();
        }
    }
};

async function init() {
    console.log("[Luvia] Universal Renderer (Auto-Detect) Initialized");

    // Support URL Search Params (Hidamari) - but don't overwrite with empty
    const urlParams = new URLSearchParams(window.location.search);
    const pToken = urlParams.get('token');
    const pServer = urlParams.get('server');
    if (pToken) CONFIG.token = pToken;
    if (pServer) CONFIG.serverUrl = pServer;
    if (urlParams.get('mode')) CONFIG.mode = urlParams.get('mode');
    if (urlParams.get('path')) CONFIG.path = urlParams.get('path');

    if (CONFIG.token && CONFIG.token !== "" && CONFIG.token !== "YOUR_TOKEN" && CONFIG.serverUrl && CONFIG.serverUrl !== "") {
        start();
    } else {
        showOverlay("Welcome to Luvia. Please set Server Address & Token in Wallpaper Engine.", true);
        console.warn("[Luvia] Config incomplete. Waiting for Properties...");
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume();
        else pause();
    });
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
            showOverlay("Fetch failed. Token/Server check?", true);
        }
    } catch (e) {
        console.error("[Luvia] Connection Error:", e);
        showOverlay("Connection Error. Check Server Address.", true);
    }
}

async function fetchItems() {
    try {
        let apiUrl = `${CONFIG.apiEndpoint}?random=true&limit=100&token=${CONFIG.token}`;
        if (CONFIG.mode === 'favorites') apiUrl += '&favorites=true&recursive=true';
        else if (CONFIG.mode === 'folder' && CONFIG.path) apiUrl += `&folder=${encodeURIComponent(CONFIG.path)}&recursive=true`;

        const fullApiUrl = getFullUrl(apiUrl);
        const response = await fetch(fullApiUrl);
        if (!response.ok) return false;

        const data = await response.json();
        if (data && data.files && data.files.length > 0) {
            CONFIG.items = data.files.sort(() => Math.random() - 0.5);
            CONFIG.currentIndex = 0;
            return true;
        }
        return false;
    } catch (e) { throw e; }
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
        fetchItems().then(success => { if (success) renderCurrent(); });
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
        media = document.createElement('video');
        media.className = 'full-content';
        media.muted = true;
        media.autoplay = true;
        media.src = getMediaUrl(item.url);
        media.loop = true;
        media.playsInline = true;
        media.setAttribute('preload', 'auto');
        media.crossOrigin = "anonymous";

        media.oncanplaythrough = onMediaLoaded;
        media.onplay = onMediaLoaded;
        media.onerror = (e) => {
            console.error("[Luvia] Video error:", item.url);
            console.error("[Luvia] Full Request URL:", media.src);
            console.error("[Luvia] Error details:", e);
            onMediaLoaded();
        };

        // Explicitly trigger play with defensive 100ms delay (Rule 8.1 / GPU Crash Guard)
        setTimeout(() => {
            if (media && media.tagName === 'VIDEO') {
                console.log("[Luvia] Defensive play trigger for:", media.src.split('/').pop());
                media.play().catch(err => {
                    console.error("[Luvia] Video Playback Failed!");
                    console.error("[Luvia] DOMException:", err.name, "-", err.message);
                    console.warn("[Luvia] Tips: Check if your server supports HTTPS or if the codec is supported by WE.");
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
