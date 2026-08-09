const cachesByWorkspace = new Map();
const MAX_ENTRIES_PER_WORKSPACE = 256;
const MAX_WORKSPACE_CACHES = 4;

function resolveWorkspaceKey(context) {
  if (typeof context === "string") return context.trim();
  return String(context?.workspaceScope?.key || context?.key || "").trim();
}

function getWorkspaceCache(context, { create = false } = {}) {
  const workspaceKey = resolveWorkspaceKey(context);
  if (!workspaceKey) return null;
  let cache = cachesByWorkspace.get(workspaceKey);
  if (cache) {
    cachesByWorkspace.delete(workspaceKey);
    cachesByWorkspace.set(workspaceKey, cache);
  }
  if (!cache && create) {
    while (cachesByWorkspace.size >= MAX_WORKSPACE_CACHES) {
      cachesByWorkspace.delete(cachesByWorkspace.keys().next().value);
    }
    cache = new Map();
    cachesByWorkspace.set(workspaceKey, cache);
  }
  return cache || null;
}

function entryKey(namespace, key) {
  return `${namespace}:${String(key)}`;
}

export function setWorkspaceRenderCacheEntry(context, namespace, key, value, options = {}) {
  if (!namespace || key === null || key === undefined || key === "") return false;
  const cache = getWorkspaceCache(context, { create: true });
  if (!cache) return false;
  const cacheKey = entryKey(namespace, key);
  if (cache.has(cacheKey)) cache.delete(cacheKey);
  cache.set(cacheKey, {
    owner: String(options.owner || ""),
    value,
  });
  while (cache.size > MAX_ENTRIES_PER_WORKSPACE) {
    cache.delete(cache.keys().next().value);
  }
  return true;
}

export function getWorkspaceRenderCacheEntry(context, namespace, key) {
  const cache = getWorkspaceCache(context);
  const cacheKey = entryKey(namespace, key);
  const entry = cache?.get(cacheKey);
  if (!entry) return null;
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  return entry.value;
}

export function beginWorkspaceRender(context, owner) {
  const ownerKey = String(owner || "").trim();
  if (!ownerKey) return false;
  const cache = getWorkspaceCache(context);
  if (!cache) return true;
  for (const [key, entry] of cache) {
    if (entry.owner === ownerKey) cache.delete(key);
  }
  return true;
}

export function clearWorkspaceRenderCaches(context) {
  const workspaceKey = resolveWorkspaceKey(context);
  if (!workspaceKey) return false;
  return cachesByWorkspace.delete(workspaceKey);
}
