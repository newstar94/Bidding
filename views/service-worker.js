const CACHE_PREFIX = "biddingflow-assets-";
const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "unversioned";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, "-").slice(-80)}`;
const HASHED_ASSET = /^\/dist\/assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

async function initialHashedAssets() {
  const response = await fetch("/dist/.vite/manifest.json", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return [];
  const manifest = await response.json();
  const entryKey = "frontend/app/app.js";
  const pending = [entryKey];
  const visited = new Set();
  const assets = [];
  while (pending.length) {
    const key = pending.pop();
    if (!key || visited.has(key) || !manifest[key]) continue;
    visited.add(key);
    const item = manifest[key];
    const pathname = `/dist/${String(item.file || "").replace(/^\/+/, "")}`;
    if (HASHED_ASSET.test(pathname)) assets.push(pathname);
    pending.push(...(item.imports || []));
  }
  return [...new Set(assets)];
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const assets = await initialHashedAssets();
    if (assets.length) await (await caches.open(CACHE_NAME)).addAll(assets);
    await self.skipWaiting();
  })().catch(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET"
    || url.origin !== self.location.origin
    || !HASHED_ASSET.test(url.pathname)
  ) return;

  const responseAndCacheWrite = (async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return { response: cached, cacheWrite: Promise.resolve() };
    const response = await fetch(request);
    const cacheWrite = response.ok && response.type === "basic"
      ? cache.put(request, response.clone())
      : Promise.resolve();
    return { response, cacheWrite };
  })();
  event.respondWith(responseAndCacheWrite.then(({ response }) => response));
  event.waitUntil(responseAndCacheWrite
    .then(({ cacheWrite }) => cacheWrite)
    .catch(() => undefined));
});
