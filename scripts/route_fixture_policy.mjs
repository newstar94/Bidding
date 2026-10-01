// Fixture-only mirror of SecurityHeadersMiddleware's existing cache policy.
// Keep the eight-character filename hash rule distinct from manifest validation
// (which accepts eight or more characters), as production currently does.
const DIST_CONTENT_HASHED_ASSET = /^\/dist\/assets\/.+-[A-Za-z0-9_-]{8}\.(?:js|css|png|webp|woff2|woff|ttf)(?![\s\S])/;
const CONTENT_HASH_VERSION = /^[0-9a-f]{64}(?![\s\S])/;
const FRONTEND_ASSET_PATH = /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+(?![\s\S])/;

export function routeFixtureCacheControl(requestUrl, statusCode = 200) {
  const url = new URL(requestUrl, "http://route-fixture.invalid");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/") || pathname.startsWith("/ws/")) {
    return "no-store, no-cache, must-revalidate";
  }
  if (DIST_CONTENT_HASHED_ASSET.test(pathname)
    || (CONTENT_HASH_VERSION.test(url.searchParams.getAll("v").at(-1) || "")
      && /\.(?:js|css|png|webp|woff2|woff|ttf)(?![\s\S])/.test(pathname))) {
    return [200, 206, 304].includes(statusCode)
      ? "public, max-age=31536000, immutable"
      : "no-store";
  }
  if (/\.(?:js|css)(?![\s\S])/.test(pathname)) {
    return "public, max-age=0, must-revalidate";
  }
  // Production does not override cache headers for other unversioned paths.
  return null;
}

export function resolveLandingFixturePreloads(manifest, assetExists) {
  if (typeof assetExists !== "function") {
    throw new Error("Landing fixture preload resolution requires an asset existence check");
  }
  const entry = (key) => {
    const value = manifest?.[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Invalid landing fixture manifest entry: ${key}`);
    }
    return value;
  };
  const asset = (value) => {
    if (typeof value !== "string" || !FRONTEND_ASSET_PATH.test(value)) {
      throw new Error(`Unsafe or unhashed landing fixture asset: ${String(value)}`);
    }
    if (!assetExists(value)) {
      throw new Error(`Missing landing fixture asset: ${value}`);
    }
    return value;
  };
  const fontFiles = [];
  for (const subset of ["latin", "vietnamese"]) {
    const key = `views/vendor/fonts/plus-jakarta-sans-${subset}.woff2`;
    if (manifest?.[key] == null) continue;
    const file = asset(entry(key).file);
    if (!file.endsWith(".woff2")) {
      throw new Error("Landing fixture font preload must reference WOFF2");
    }
    fontFiles.push(file);
  }
  const pending = ["frontend/app/app.js", "frontend/landing/LandingPage.js"];
  const visited = new Set();
  const moduleFiles = [];
  while (pending.length) {
    const key = pending.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const value = entry(key);
    moduleFiles.push(asset(value.file));
    const imports = value.imports ?? [];
    if (!Array.isArray(imports) || imports.some((imported) => typeof imported !== "string")) {
      throw new Error(`Invalid landing fixture static imports: ${key}`);
    }
    for (const imported of imports) {
      if (!Object.hasOwn(manifest, imported)) {
        throw new Error(`Missing landing fixture static import: ${imported}`);
      }
      pending.push(imported);
    }
  }
  return { fontFiles, moduleFiles: [...new Set(moduleFiles)] };
}

export function landingFixturePreloadTags(preloads, assetOrigin = "") {
  const prefix = assetOrigin.replace(/\/$/, "");
  return [
    ...preloads.moduleFiles.map((file) => (
      `<link rel="modulepreload" href="${prefix}/dist/${file}">`
    )),
    ...preloads.fontFiles.map((file) => (
      `<link rel="preload" href="${prefix}/dist/${file}" as="font" type="font/woff2" crossorigin>`
    )),
  ].join("\n");
}
