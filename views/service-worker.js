const CACHE_PREFIX = "biddingflow-assets-";

// Retirement worker: HTTP immutable caching plus N-1 asset retention now own
// release compatibility. Taking control immediately displaces older workers
// that intercepted the secure module graph and could hang post-login startup.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.allSettled(names
        .filter((name) => name.startsWith(CACHE_PREFIX))
        .map((name) => caches.delete(name)));
    } finally {
      await self.clients.claim();
      await self.registration.unregister();
    }
  })());
});
