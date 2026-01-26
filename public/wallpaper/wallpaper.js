/**
 * Luvia Gallery - Standalone Wallpaper Renderer
 * Performance-optimized vanilla JS implementation
 */

const CONFIG = {
    interval: 5000, // Carousel interval in ms
    apiEndpoint: '/api/scan/results?random=true&limit=10',
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

/**
 * Initialize the wallpaper
 */
async function init() {
    // 1. Get token from URL
    const urlParams = new URLSearchParams(window.location.search);
    CONFIG.token = urlParams.get('token');

    // 2. Setup Visibility listener for performance
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            resume();
        } else {
            pause();
        }
    });

    // 3. Setup Wallpaper Engine properties listener
    if (window.wallpaperPropertyListener) {
        window.wallpaperPropertyListener.applyUserProperties = (properties) => {
            if (properties.token) {
                CONFIG.token = properties.token.value;
                start();
            }
            if (properties.interval) {
                CONFIG.interval = properties.interval.value * 1000;
            }
        };
    }

    start();
}

/**
 * Start/Restart the fetching and carousel
 */
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
            showOverlay("Authentication Failed", true);
        }
    } catch (e) {
        showOverlay("Server Connection Failed", true);
    }
}

/**
 * Fetch random items from Luvia API
 */
async function fetchItems() {
    try {
        const response = await fetch(`${CONFIG.apiEndpoint}&token=${CONFIG.token}`);
        if (!response.ok) return false;

        const data = await response.json();
        if (data && data.files && data.files.length > 0) {
            CONFIG.items = data.files;
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

/**
 * Start the carousel loop
 */
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
    CONFIG.currentIndex = (CONFIG.currentIndex + 1) % CONFIG.items.length;

    // If we're near the end of the fetched items, refresh the list in background
    if (CONFIG.currentIndex === CONFIG.items.length - 1) {
        fetchItems();
    }

    renderCurrent();
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
    } else {
        media = document.createElement('img');
        media.src = mediaUrl;
    }

    slide.appendChild(media);
    elements.container.appendChild(slide);

    // Fade in
    setTimeout(() => {
        slide.classList.add('active');

        // Remove old slides
        const slides = elements.container.querySelectorAll('.slide');
        if (slides.length > 2) {
            setTimeout(() => {
                elements.container.removeChild(slides[0]);
            }, 1600);
        }
    }, 50);
}

function pause() {
    CONFIG.isPaused = true;
    const videos = document.querySelectorAll('video');
    videos.forEach(v => v.pause());
}

function resume() {
    CONFIG.isPaused = false;
    const videos = document.querySelectorAll('video');
    videos.forEach(v => v.play());
}

function showOverlay(msg, showGuide = false) {
    elements.overlay.classList.remove('hidden');
    elements.status.innerText = msg;
    if (showGuide) {
        elements.guide.classList.remove('hidden');
    } else {
        elements.guide.classList.add('hidden');
    }
}

function hideOverlay() {
    elements.overlay.classList.add('hidden');
}

// Global error handling for better UX
window.onerror = (msg) => {
    console.error(msg);
    // Don't show overlay for every single error, but log it
};

init();
