const CACHE_NAME = "biddingflow-shell-v10";
const APP_SHELL = [
  "/",
  "/css/variables.css?v=6.16",
  "/css/base.css",
  "/css/components.css?v=6.16",
  "/css/views.css?v=6.16",
  "/css/toast.css",
  "/vendor/fonts/plus-jakarta-sans-latin.woff2",
  "/vendor/fonts/plus-jakarta-sans-vietnamese.woff2",
  "/vendor/lucide/lucide.min.js?v=1.21.0.1"
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting())
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws/") || url.pathname.startsWith("/uploads/")) return;
  if (url.pathname === "/") {
    return;
  }
  // appbundle.js has a stable name. Let the browser perform HTTP revalidation
  // so a deployment never boots a stale bundle from the service-worker cache.
  if (url.pathname === "/dist/assets/appbundle.js") return;
  if (url.pathname.endsWith(".css") || url.pathname.startsWith("/dist/") || url.pathname.startsWith("/vendor/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request).then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
  }
});
