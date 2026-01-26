/**
 * Luvia Gallery - Standalone Wallpaper Renderer (Anti-Ghosting Version)
 */

const CONFIG = {
    interval: 30000, // Default 30s
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
    console.log("[Luvia] Renderer Init");
    const urlParams = new URLSearchParams(window.location.search);
    CONFIG.token = urlParams.get('token');

    // Support more params from URL
    const mode = urlParams.get('mode');
    if (mode) CONFIG.mode = mode;

    const pathParam = urlParams.get('path');
    if (pathParam) CONFIG.path = pathParam;

    const intervalParam = urlParams.get('interval');
    if (intervalParam) CONFIG.interval = parseInt(intervalParam) * 1000;

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
            // Shuffle on client side too for extra randomness
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
    if (carouselTimer) clearInterval(carouselTimer);

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
 * CORE RE-RENDER LOGIC (Anti-Ghosting)
 */
function renderCurrent() {
    const item = CONFIG.items[CONFIG.currentIndex];
    if (!item) return;

    // 1. CLEANUP PREVIOUS SLIDES (Hard Cleanup)
    // We do this immediately to stop all video/audio playback
    const oldSlides = elements.container.querySelectorAll('.slide');
    oldSlides.forEach(oldSlide => {
        const videos = oldSlide.querySelectorAll('video');
        videos.forEach(v => {
            v.pause();
            v.src = ""; // Release memory/stream
            v.load();
            v.remove();
        });
        // We don't remove the slide yet to allow for a slight crossfade, 
        // but we ensure its media is dead or fading.
        oldSlide.classList.remove('active');
        oldSlide.classList.add('exit');
    });

    // 2. CREATE NEW SLIDE
    const slide = document.createElement('div');
    slide.className = 'slide';

    const mediaUrl = `${item.url.startsWith('/') ? '' : '/'}${item.url}?token=${CONFIG.token}`;

    let media;
    if (item.mediaType === 'video') {
        media = document.createElement('video');
        media.src = mediaUrl;
        media.autoplay = true;
        media.muted = true;
        media.loop = true;
        media.playsInline = true;
        media.setAttribute('webkit-playsinline', 'true');
    } else {
        media = document.createElement('img');
        media.src = mediaUrl;
    }

    slide.appendChild(media);
    elements.container.appendChild(slide);

    // 3. TRIGGER ANIMATION
    // Small delay to ensure browser registers the new element for transition
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            slide.classList.add('active');
        });
    });

    // 4. FINAL CLEANUP (Remove Old DOM elements)
    setTimeout(() => {
        const deadSlides = elements.container.querySelectorAll('.exit');
        deadSlides.forEach(s => {
            if (elements.container.contains(s)) {
                elements.container.removeChild(s);
            }
        });
        console.log("[Luvia] DOM Cleaned. Items in container:", elements.container.children.length);
    }, 2000);
}

function pause() {
    CONFIG.isPaused = true;
    document.querySelectorAll('video').forEach(v => v.pause());
}

function resume() {
    CONFIG.isPaused = false;
    document.querySelectorAll('video').forEach(v => {
        if (v.closest('.slide.active')) v.play();
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

// Start everything
init();
