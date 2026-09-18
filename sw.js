// ===== FRUIT CRUSH SERVICE WORKER =====
const CACHE_NAME = 'fruitcrush-v1.0.0';
const RUNTIME_CACHE = 'fruitcrush-runtime-v1.0.0';

// File yang di-cache saat install
const PRECACHE_URLS = [
    './',
    './index.html',
    './login.html',
    './pembayaran.html',
    './qris.html',
    './admin.html',
    './firebase-config.js',
    './manifest.json'
];

// ===== INSTALL =====
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Precaching app shell');
                // Cache satu-satu agar tidak gagal total kalau ada file hilang
                return Promise.all(
                    PRECACHE_URLS.map(url =>
                        cache.add(url).catch(err => console.warn('[SW] Skip cache:', url, err))
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ===== ACTIVATE =====
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
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

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET
    if (request.method !== 'GET') return;

    // Skip Firebase Auth / Firestore / Google APIs — biar tidak nge-cache data dinamis
    if (url.hostname.includes('googleapis.com') ||
        url.hostname.includes('firebaseio.com') ||
        url.hostname.includes('firebaseapp.com') ||
        url.hostname.includes('gstatic.com') ||
        url.hostname.includes('google.com')) {
        return;
    }

    // Skip chrome-extension, etc
    if (!url.protocol.startsWith('http')) return;

    // HTML — network first (biar selalu update)
    if (request.headers.get('accept')?.includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const clone = response.clone();
                    caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
        );
        return;
    }

    // Asset statis (gambar, css, js, font) — cache first
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff|woff2|ttf)$/)) {
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

    // Default — network with cache fallback
    event.respondWith(
        fetch(request)
            .then((response) => {
                const clone = response.clone();
                caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
                return response;
            })
            .catch(() => caches.match(request))
    );
});

// ===== MESSAGE =====
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
    }
});

console.log('[SW] Loaded');
