const STORE_BY_MODEL = new WeakMap();
export const PAGINATED_PROJECTION_SCHEMA = "v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value === undefined ? null : value;
}

function scopeRevision(model) {
  return [
    model?.visibilityRevision,
    model?.permissionRevision,
    model?.assignmentRevision,
    model?.recordScopeRevision,
    model?.workspaceStorage?.getItem?.("bf_visibility_token"),
  ].map((value) => String(value ?? "")).join(".");
}

export function normalizedProjectionKey(model, table, query = {}, lease = {}) {
  const identity = String(model?.state?.activeuser?.id || model?.workspaceScope?.userId || "");
  const organization = String(model?.workspaceScope?.organizationId || lease.scope || "");
  const generation = String(lease.token || model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "");
  const role = String(model?.state?.activerole || "");
  return [
    PAGINATED_PROJECTION_SCHEMA,
    encodeURIComponent(identity),
    encodeURIComponent(organization),
    encodeURIComponent(role),
    encodeURIComponent(scopeRevision(model)),
    encodeURIComponent(generation),
    encodeURIComponent(String(table || "")),
    encodeURIComponent(JSON.stringify(canonical(query))),
  ].join(":");
}

export class PaginatedProjectionStore {
  constructor(model, { ttlMs = 30_000, maxEntries = 96 } = {}) {
    if (!model) throw new TypeError("PaginatedProjectionStore requires a model.");
    this.model = model;
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
  }

  get cache() {
    this.model._paginatedQueryCache ||= new Map();
    return this.model._paginatedQueryCache;
  }

  get flights() {
    this.model._paginationRequests ||= new Map();
    return this.model._paginationRequests;
  }

  key(table, query = {}, lease = {}) {
    return normalizedProjectionKey(this.model, table, query, lease);
  }

  read(table, query = {}, lease = {}, now = Date.now()) {
    const key = this.key(table, query, lease);
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { ...entry, key, stale: now - Number(entry.fetchedAt || 0) >= this.ttlMs };
  }

  setValue(table, query, value, lease = {}) {
    const key = this.key(table, query, lease);
    this.cache.delete(key);
    this.cache.set(key, { ...value, key });
    while (this.cache.size > this.maxEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return key;
  }

  query(table, query, loader, { lease = {}, prefetch = false } = {}) {
    const key = this.key(table, query, lease);
    const cached = this.read(table, query, lease);
    if (cached && !cached.stale) return Promise.resolve({ ...cached, cacheHit: true });
    const existing = this.flights.get(key);
    if (existing?.promise) return existing.promise;
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => loader({ signal: controller.signal, cached }))
      .then((value) => {
        this.setValue(table, query, {
          ...value,
          fetchedAt: Date.now(),
          prefetched: prefetch,
        }, lease);
        return value;
      })
      .finally(() => {
        if (this.flights.get(key)?.promise === promise) this.flights.delete(key);
      });
    this.flights.set(key, { controller, promise });
    return promise;
  }

  warm(table, query, loader, options = {}) {
    return this.query(table, query, loader, { ...options, prefetch: true });
  }

  revalidate(table, query, loader, options = {}) {
    this.invalidate(table, { query, lease: options.lease });
    return this.query(table, query, loader, options);
  }

  invalidate(table = null, { query = null, lease = {} } = {}) {
    if (!table) {
      this.cache.clear();
      return;
    }
    if (query) {
      this.cache.delete(this.key(table, query, lease));
      return;
    }
    const tableMarker = `:${encodeURIComponent(String(table))}:`;
    for (const key of [...this.cache.keys()]) {
      if (key.includes(tableMarker)) this.cache.delete(key);
    }
  }

  disposeWorkspace() {
    for (const flight of this.flights.values()) flight?.controller?.abort?.("Projection scope disposed");
    this.flights.clear();
    this.cache.clear();
  }
}

export function paginatedProjectionStore(model) {
  let store = STORE_BY_MODEL.get(model);
  if (!store) {
    store = new PaginatedProjectionStore(model);
    STORE_BY_MODEL.set(model, store);
  }
  return store;
}
