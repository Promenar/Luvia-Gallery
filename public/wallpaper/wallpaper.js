/**
 * Luvia Gallery - Standalone Wallpaper Renderer (Stabilized Version)
 * Fixes: Video looping/ghosting and duplicate triggers.
 */

const CONFIG = {
    interval: 30000,
    mode: 'random',
    path: '',
    apiEndpoint: '/api/scan/results',
    token: null,
    items: [],
    currentIndex: 0,
    isPaused: false
};

const elements = {
    container: document.getElementById('wallpaper-container'),
    overlay: document.getElementById('overlay'),
    status: document.getElementById('status-msg'),
    guide: document.getElementById('setup-guide')
};

async function init() {
    console.log("[Luvia] Stabilized Renderer Init");
    const urlParams = new URLSearchParams(window.location.search);
    CONFIG.token = urlParams.get('token');

    const mode = urlParams.get('mode');
    if (mode) CONFIG.mode = mode;

    const pathParam = urlParams.get('path');
    if (pathParam) CONFIG.path = pathParam;

    const intervalParam = urlParams.get('interval');
    if (intervalParam) {
        const val = parseInt(intervalParam);
        if (!isNaN(val) && val > 0) CONFIG.interval = val * 1000;
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') resume();
        else pause();
    });

    start();
}

async function start() {
    if (!CONFIG.token) {
        showOverlay("Token Missing", true);
        return;
    }

    showOverlay("Fetching Media...");

    try {
        const success = await fetchItems();
        if (success) {
            hideOverlay();
            setupCarousel();
        } else {
            showOverlay("No media found for this config", true);
        }
    } catch (e) {
        showOverlay("Server Connection Failed", true);
    }
}

async function fetchItems() {
    try {
        let url = `${CONFIG.apiEndpoint}?random=true&limit=50&token=${CONFIG.token}`;

        if (CONFIG.mode === 'favorites') {
            url += '&favorites=true&recursive=true';
        } else if (CONFIG.mode === 'folder' && CONFIG.path) {
            url += `&folder=${encodeURIComponent(CONFIG.path)}&recursive=true`;
        }

        const response = await fetch(url);
        if (!response.ok) return false;

        const data = await response.json();
        if (data && data.files && data.files.length > 0) {
            CONFIG.items = data.files.sort(() => Math.random() - 0.5);
            CONFIG.currentIndex = 0;
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

let carouselTimer = null;
function setupCarousel() {
    // Clear any existing timer to prevent overlapping loops
    if (carouselTimer) {
        clearInterval(carouselTimer);
        carouselTimer = null;
    }

    renderCurrent();

    carouselTimer = setInterval(() => {
        if (!CONFIG.isPaused) {
            next();
        }
    }, CONFIG.interval);
}

function next() {
    CONFIG.currentIndex++;

    if (CONFIG.currentIndex >= CONFIG.items.length) {
        fetchItems().then(() => {
            renderCurrent();
        });
    } else {
        renderCurrent();
    }
}

/**
 * CORE RENDER LOGIC
 */
function renderCurrent() {
    const item = CONFIG.items[CONFIG.currentIndex];
    if (!item) return;

    // 1. HARD CLEANUP
    const oldSlides = elements.container.querySelectorAll('.slide');
    oldSlides.forEach(oldSlide => {
        const videos = oldSlide.querySelectorAll('video');
        videos.forEach(v => {
            v.oncanplaythrough = null; // Remove listeners
            v.onplay = null;
            v.pause();
            v.src = "";
            v.load();
            v.remove();
        });
        oldSlide.classList.remove('active');
        oldSlide.classList.add('exit');
    });

    // 2. PREPARE NEW SLIDE
    const slide = document.createElement('div');
    slide.className = 'slide';

    const tokenSuffix = `token=${CONFIG.token}`;
    const fullUrl = `${item.url.startsWith('/') ? '' : '/'}${item.url}${item.url.includes('?') ? '&' : '?'}${tokenSuffix}`;
    const thumbUrl = `${item.thumbnailUrl.startsWith('/') ? '' : '/'}${item.thumbnailUrl}${item.thumbnailUrl.includes('?') ? '&' : '?'}${tokenSuffix}`;

    const thumb = document.createElement('img');
    thumb.className = 'thumb-placeholder';
    thumb.src = thumbUrl;
    slide.appendChild(thumb);

    let media;
    let hasTriggeredLoad = false;

    const onMediaLoaded = () => {
        if (hasTriggeredLoad) return;
        hasTriggeredLoad = true;
        handleMediaTransition(media, thumb);
    };

    if (item.mediaType === 'video') {
        media = document.createElement('video');
        media.className = 'full-content';
        media.src = fullUrl;
        media.autoplay = true;
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.setAttribute('webkit-playsinline', 'true');

        // Use multiple events to ensure trigger in different browsers/kernels
        media.oncanplaythrough = onMediaLoaded;
        media.onplay = onMediaLoaded;

        // Fallback for some Linux WebKit versions that struggle with canplaythrough
        setTimeout(() => {
            if (!hasTriggeredLoad && media && media.readyState >= 2) {
                onMediaLoaded();
            }
        }, 2000);
    } else {
        media = document.createElement('img');
        media.className = 'full-content';
        media.src = fullUrl;
        media.onload = onMediaLoaded;
    }

    slide.appendChild(media);
    elements.container.appendChild(slide);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            slide.classList.add('active');
        });
    });

    // Cleanup DOM
    setTimeout(() => {
        const deadSlides = elements.container.querySelectorAll('.exit');
        deadSlides.forEach(s => {
            if (elements.container.contains(s)) {
                elements.container.removeChild(s);
            }
        });
    }, 2500);
}

function handleMediaTransition(media, thumb) {
    if (media.classList.contains('loaded')) return;

    media.classList.add('loaded');
    if (thumb) {
        thumb.classList.add('fade-out');
        setTimeout(() => {
            if (thumb.parentNode) thumb.parentNode.removeChild(thumb);
        }, 1200);
    }
}

function pause() {
    CONFIG.isPaused = true;
    document.querySelectorAll('video').forEach(v => v.pause());
}

function resume() {
    CONFIG.isPaused = false;
    document.querySelectorAll('video').forEach(v => {
        if (v.closest('.slide.active')) {
            v.play().catch(e => console.warn("Play failed", e));
        }
    });
}

function showOverlay(msg, showGuide = false) {
    elements.overlay.classList.remove('hidden');
    elements.status.innerText = msg;
    if (showGuide) elements.guide.classList.remove('hidden');
}

function hideOverlay() {
    elements.overlay.classList.add('hidden');
}

init();
