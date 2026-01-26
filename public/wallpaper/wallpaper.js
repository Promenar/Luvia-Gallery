/**
 * Luvia Gallery - Standalone Wallpaper Renderer (Optimized)
 */

const CONFIG = {
    interval: 5000,
    mode: 'random', // 'random', 'folder', 'favorites'
    path: '',       // folder path
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

    if (window.wallpaperPropertyListener) {
        window.wallpaperPropertyListener.applyUserProperties = (properties) => {
            if (properties.token) { CONFIG.token = properties.token.value; start(); }
            if (properties.interval) {
                CONFIG.interval = properties.interval.value * 1000;
                if (carouselTimer) setupCarousel();
            }
            if (properties.mode) { CONFIG.mode = properties.mode.value; start(); }
        };
    }

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
        let url = `${CONFIG.apiEndpoint}?random=true&limit=20&token=${CONFIG.token}`;

        if (CONFIG.mode === 'favorites') {
            url += '&favorites=true&recursive=true';
        } else if (CONFIG.mode === 'folder' && CONFIG.path) {
            url += `&folder=${encodeURIComponent(CONFIG.path)}&recursive=true`;
        }

        const response = await fetch(url);
        if (!response.ok) return false;

        const data = await response.json();
        if (data && data.files && data.files.length > 0) {
            CONFIG.items = data.files;
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
        // Refresh items when we reach the end
        fetchItems().then(() => {
            renderCurrent();
        });
    } else {
        renderCurrent();
    }
}

function renderCurrent() {
    const item = CONFIG.items[CONFIG.currentIndex];
    if (!item) return;

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
    } else {
        media = document.createElement('img');
        media.src = mediaUrl;
    }

    slide.appendChild(media);
    elements.container.appendChild(slide);

    // GHOSTING FIX: Transition logic
    const oldSlides = elements.container.querySelectorAll('.slide:not(.active)');
    const currentActive = elements.container.querySelector('.slide.active');

    setTimeout(() => {
        if (currentActive) {
            currentActive.classList.remove('active');
            currentActive.classList.add('exit');
        }
        slide.classList.add('active');

        // Cleanup DOM
        setTimeout(() => {
            const slidesToRemove = elements.container.querySelectorAll('.exit, .slide:not(.active)');
            slidesToRemove.forEach(s => {
                if (s !== slide) elements.container.removeChild(s);
            });
        }, 1600);
    }, 50);
}

function pause() {
    CONFIG.isPaused = true;
    document.querySelectorAll('video').forEach(v => v.pause());
}

function resume() {
    CONFIG.isPaused = false;
    document.querySelectorAll('video').forEach(v => v.play());
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
