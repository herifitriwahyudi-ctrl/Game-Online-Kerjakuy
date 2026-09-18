// ===== FRUIT CRUSH SERVICE WORKER v2 =====
// HTML: network-only (jangan di-cache agar selalu fresh)
// JS/CSS: network-first
// Gambar: cache-first

const CACHE_NAME = 'fruitcrush-v2.0.0';
const RUNTIME_CACHE = 'fruitcrush-runtime-v2.0.0';

const PRECACHE_URLS = [
    './manifest.json'
];

self.addEventListener('install', (event) => {
    console.log('[SW] Installing v2...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    console.log('[SW] Activating v2...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') return;

    // Skip Firebase, Google API
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('google.com') ||
        url.hostname.includes('firebase')) {
        return;
    }

    if (!url.protocol.startsWith('http')) return;

    // ⚠️ HTML → NETWORK ONLY (jangan di-cache)
    if (request.headers.get('accept')?.includes('text/html') ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('/')) {
        event.respondWith(
            fetch(request).catch(() => caches.match('./index.html'))
        );
        return;
    }

    // ⚠️ JS & CSS → NETWORK FIRST (biar selalu dapat versi terbaru)
    if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const clone = response.clone();
                        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Gambar → cache first
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot)$/)) {
        event.respondWith(
            caches.match(request).then((cached) => {
                if (cached) return cached;
                return fetch(request).then((response) => {
                    if (!response || response.status !== 200 || response.type === 'opaque') {
                        return response;
                    }
                    const clone = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                    return response;
                }).catch(() => cached);
            })
        );
        return;
    }

    event.respondWith(fetch(request).catch(() => caches.match(request)));
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
    }
});

console.log('[SW] Loaded v2');
