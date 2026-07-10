const CACHE_NAME = 'biddingflow-shell-v4';
const APP_SHELL = [
    '/',
    '/style.css?v=6.13',
    '/css/variables.css',
    '/css/base.css',
    '/css/components.css',
    '/css/views.css',
    '/css/toast.css',
    '/vendor/lucide/lucide.min.js?v=1.21.0',
    '/dist/controllers/app.bundle.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
            .catch(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') || url.pathname.startsWith('/uploads/')) return;

    if (url.pathname === '/') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response && response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    if (url.pathname.endsWith('.css') || url.pathname.startsWith('/dist/') || url.pathname.startsWith('/vendor/')) {
        event.respondWith(
            caches.match(request).then(cached => {
                const network = fetch(request)
                    .then(response => {
                        if (response && response.ok) {
                            const clone = response.clone();
                            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
                        }
                        return response;
                    })
                    .catch(() => cached);
                return cached || network;
            })
        );
    }
});
