const CACHE_PREFIX = "biddingflow-assets-";
const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "unversioned";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID.replace(/[^a-zA-Z0-9_-]/g, "-").slice(-80)}`;
const HASHED_ASSET = /^\/dist\/assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|css)$/;

async function initialHashedAssets() {
  const response = await fetch("/dist/.vite/manifest.json", { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(`Service worker manifest request failed: HTTP ${response.status}`);
  }
  const manifest = await response.json();
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Service worker manifest is invalid");
  }
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
    for (const asset of [...(item.css || []), ...(item.assets || [])]) {
      const assetPathname = `/dist/${String(asset || "").replace(/^\/+/, "")}`;
      if (HASHED_ASSET.test(assetPathname)) assets.push(assetPathname);
    }
    pending.push(...(item.imports || []));
  }
  const uniqueAssets = [...new Set(assets)];
  if (!uniqueAssets.length) {
    throw new Error("Service worker manifest has no precache assets");
  }
  return uniqueAssets;
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const assets = await initialHashedAssets();
    try {
      await (await caches.open(CACHE_NAME)).addAll(assets);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
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
