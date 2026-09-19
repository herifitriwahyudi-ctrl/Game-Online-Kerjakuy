/* =========================================================
   SERVICE WORKER — FRUIT CRUSH SPECIAL
   Versi: 4.0.0
   Strategi:
   - App Shell (HTML lokal)  : Network First + fallback cache
   - Assets statis (gambar)  : Cache First
   - Firebase SDK (CDN)      : Cache First (immutable)
   - Firestore/Auth API      : Network Only (JANGAN di-cache)
   ========================================================= */

const SW_VERSION = 'v3.0.0';
const CACHE_APP    = `fruitcrush-app-${SW_VERSION}`;
const CACHE_STATIC = `fruitcrush-static-${SW_VERSION}`;
const CACHE_CDN    = `fruitcrush-cdn-${SW_VERSION}`;

// Halaman HTML lokal (app shell)
const APP_SHELL = [
    './',
    './index.html',
    './login.html',
    './pembayaran.html',
    './qris.html',
    './admin.html',
    './firebase-config.js',
    './manifest.json'
];

// Aset statis lokal (opsional — kalau tidak ada, tidak error)
const STATIC_ASSETS = [
    './qris.png',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './favicon.ico'
];

// CDN Firebase SDK (immutable, aman di-cache lama)
const CDN_ASSETS = [
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js'
];

// Domain yang TIDAK BOLEH di-cache (network only)
const NETWORK_ONLY_HOSTS = [
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'firebaselogging-pa.googleapis.com',
    'firebaseio.com'
];

// =========================================================
// INSTALL
// =========================================================
self.addEventListener('install', (event) => {
    console.log(`[SW ${SW_VERSION}] install`);
    event.waitUntil((async () => {
        const appCache = await caches.open(CACHE_APP);
        // App shell wajib — kalau gagal, install gagal
        await appCache.addAll(APP_SHELL).catch((err) => {
            console.warn('[SW] app shell partial fail:', err);
        });

        const staticCache = await caches.open(CACHE_STATIC);
        // Static assets opsional — pakai allSettled biar tidak gagal total
        await Promise.allSettled(
            STATIC_ASSETS.map((url) =>
                staticCache.add(url).catch(() => {
                    console.warn('[SW] static skip:', url);
                })
            )
        );

        const cdnCache = await caches.open(CACHE_CDN);
        await Promise.allSettled(
            CDN_ASSETS.map((url) =>
                cdnCache.add(url).catch(() => {
                    console.warn('[SW] cdn skip:', url);
                })
            )
        );

        // Aktifkan SW baru segera
        await self.skipWaiting();
    })());
});

// =========================================================
// ACTIVATE — bersihkan cache lama
// =========================================================
self.addEventListener('activate', (event) => {
    console.log(`[SW ${SW_VERSION}] activate`);
    event.waitUntil((async () => {
        const keys = await caches.keys();
        const validKeys = [CACHE_APP, CACHE_STATIC, CACHE_CDN];
        await Promise.all(
            keys
                .filter((k) => !validKeys.includes(k))
                .map((k) => {
                    console.log('[SW] hapus cache lama:', k);
                    return caches.delete(k);
                })
        );
        // Ambil kontrol semua tab
        await self.clients.claim();
    })());
});

// =========================================================
// FETCH — routing
// =========================================================
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Hanya handle GET
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 1. Network only untuk API Firebase (jangan di-cache!)
    if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
        return; // biarkan browser handle langsung
    }

    // 2. Cache First untuk CDN Firebase SDK
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('firebasejs')) {
        event.respondWith(cacheFirst(req, CACHE_CDN));
        return;
    }

    // 3. Cache First untuk gambar / font / icon
    if (
        req.destination === 'image' ||
        req.destination === 'font' ||
        /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname)
    ) {
        event.respondWith(cacheFirst(req, CACHE_STATIC));
        return;
    }

    // 4. Network First untuk HTML / JS / CSS lokal (biar update cepat)
    if (
        url.origin === self.location.origin &&
        (req.destination === 'document' ||
         req.destination === 'script' ||
         req.destination === 'style' ||
         req.mode === 'navigate')
    ) {
        event.respondWith(networkFirst(req, CACHE_APP));
        return;
    }

    // 5. Default: network first, fallback cache
    event.respondWith(networkFirst(req, CACHE_APP));
});

// =========================================================
// STRATEGI: Cache First
// =========================================================
async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;

    try {
        const response = await fetch(request);
        // Simpan hanya response valid
        if (response && response.status === 200 && response.type !== 'opaque') {
            cache.put(request, response.clone()).catch(() => {});
        } else if (response && response.type === 'opaque') {
            // Opaque response tetap di-cache (untuk cross-origin tanpa CORS)
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        // Fallback: coba cache lain
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        // Terakhir: kembalikan response error minimal
        return new Response('Offline — resource tidak tersedia', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

// =========================================================
// STRATEGI: Network First (fallback ke cache)
// =========================================================
async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response && response.status === 200) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch (err) {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;

        // Fallback khusus navigasi → arahkan ke index.html (biar tetap bisa main offline)
        if (request.mode === 'navigate') {
            const fallback = await cache.match('./index.html');
            if (fallback) return fallback;
        }

        return new Response('Offline — halaman tidak tersedia', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

// =========================================================
// MESSAGE — komunikasi dengan halaman
// =========================================================
self.addEventListener('message', (event) => {
    const data = event.data || {};

    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }

    if (data.type === 'CLEAR_CACHE') {
        event.waitUntil((async () => {
            const keys = await caches.keys();
            await Promise.all(keys.map((k) => caches.delete(k)));
            event.source && event.source.postMessage({ type: 'CACHE_CLEARED' });
        })());
        return;
    }

    if (data.type === 'GET_VERSION') {
        event.source && event.source.postMessage({
            type: 'SW_VERSION',
            version: SW_VERSION
        });
    }
});

// =========================================================
// PUSH NOTIFICATION (opsional — siap dipakai nanti)
// =========================================================
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let payload = {};
    try { payload = event.data.json(); } catch (e) { payload = { title: 'Fruit Crush', body: event.data.text() }; }

    event.waitUntil(
        self.registration.showNotification(payload.title || 'Fruit Crush', {
            body: payload.body || '',
            icon: './icon-192.png',
            badge: './icon-192.png',
            data: payload.data || {}
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil((async () => {
        const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of allClients) {
            if ('focus' in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })());
});

console.log(`[SW] loaded ${SW_VERSION}`);
