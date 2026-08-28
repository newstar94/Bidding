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

function storedVisibilityToken(model) {
  try {
    return String(model?.workspaceStorage?.getItem?.("bf_visibility_token") ?? "");
  } catch {
    return "";
  }
}

function projectionWorkspaceKey(model) {
  return String(model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "");
}

export function projectionAuthorizationVisibilityToken(model) {
  const persistedToken = storedVisibilityToken(model);
  const observation = model?._paginatedProjectionVisibility;
  if (observation?.workspaceKey !== projectionWorkspaceKey(model)) return persistedToken;
  // If another tab advances storage to a third fingerprint, prefer that newer
  // persisted observation. A route-only response deliberately remains ahead
  // of its persisted cursor until workspace-wide reconciliation completes.
  if (
    persistedToken !== observation.persistedToken
    && persistedToken !== observation.token
  ) return persistedToken;
  return String(observation.token || "");
}

export function observeProjectionAuthorizationVisibilityToken(model, token) {
  const normalizedToken = String(token || "");
  const changed = projectionAuthorizationVisibilityToken(model) !== normalizedToken;
  model._paginatedProjectionVisibility = Object.freeze({
    workspaceKey: projectionWorkspaceKey(model),
    token: normalizedToken,
    persistedToken: storedVisibilityToken(model),
  });
  return changed;
}

export function captureProjectionAuthorizationScope(model) {
  return Object.freeze({
    identity: String(model?.state?.activeuser?.id || model?.workspaceScope?.userId || ""),
    organization: String(model?.workspaceScope?.organizationId || ""),
    role: String(model?.state?.activerole || ""),
    visibilityRevision: String(model?.visibilityRevision ?? ""),
    permissionRevision: String(model?.permissionRevision ?? ""),
    assignmentRevision: String(model?.assignmentRevision ?? ""),
    recordScopeRevision: String(model?.recordScopeRevision ?? ""),
    visibilityToken: projectionAuthorizationVisibilityToken(model),
  });
}

function scopeRevision(scope) {
  return [
    scope?.visibilityRevision,
    scope?.permissionRevision,
    scope?.assignmentRevision,
    scope?.recordScopeRevision,
    scope?.visibilityToken,
  ].map((value) => String(value ?? "")).join(".");
}

export function projectionAuthorizationScopeIsCurrent(model, capturedScope) {
  if (!capturedScope) return false;
  const currentScope = captureProjectionAuthorizationScope(model);
  return Object.keys(currentScope).every((key) => (
    currentScope[key] === capturedScope[key]
  ));
}

export function projectionAuthorizationChangedError() {
  const error = new Error("Authorization scope changed before the paginated request completed");
  error.name = "AbortError";
  error.code = "PAGINATION_AUTHORIZATION_SCOPE_CHANGED";
  return error;
}

function projectionScopeDisposedError(reason = null) {
  if (reason instanceof Error) return reason;
  const error = new Error("Paginated projection scope was disposed");
  error.name = "AbortError";
  error.code = "PAGINATION_PROJECTION_SCOPE_DISPOSED";
  return error;
}

export function assertProjectionAuthorizationScopeCurrent(model, capturedScope) {
  if (!projectionAuthorizationScopeIsCurrent(model, capturedScope)) {
    throw projectionAuthorizationChangedError();
  }
  return capturedScope;
}

function projectionLease(model, lease = {}) {
  if (lease?.projectionAuthorizationScope) return lease;
  return Object.freeze({
    ...lease,
    projectionAuthorizationScope: captureProjectionAuthorizationScope(model),
  });
}

function projectionScopeSegments(model, table, lease = {}) {
  const authorizationScope = lease?.projectionAuthorizationScope
    || captureProjectionAuthorizationScope(model);
  const identity = authorizationScope.identity;
  const organization = authorizationScope.organization || String(lease.scope || "");
  const generation = String(lease.token || model?.getWorkspaceToken?.() || model?.workspaceScope?.key || "");
  const role = authorizationScope.role;
  return [
    PAGINATED_PROJECTION_SCHEMA,
    encodeURIComponent(identity),
    encodeURIComponent(organization),
    encodeURIComponent(role),
    encodeURIComponent(scopeRevision(authorizationScope)),
    encodeURIComponent(generation),
    encodeURIComponent(String(table || "")),
  ];
}

export function normalizedProjectionKey(model, table, query = {}, lease = {}) {
  return [
    ...projectionScopeSegments(model, table, lease),
    encodeURIComponent(JSON.stringify(canonical(query))),
  ].join(":");
}

export function projectionKeyMatchesScopeAndTable(key, model, table, lease = {}) {
  const prefix = `${projectionScopeSegments(model, table, lease).join(":")}:`;
  return String(key || "").startsWith(prefix);
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
    const capturedLease = projectionLease(this.model, lease);
    if (!projectionAuthorizationScopeIsCurrent(
      this.model,
      capturedLease.projectionAuthorizationScope,
    )) return null;
    const key = this.key(table, query, capturedLease);
    const entry = this.cache.get(key);
    if (!entry) return null;
    this.cache.delete(key);
    this.cache.set(key, entry);
    return { ...entry, key, stale: now - Number(entry.fetchedAt || 0) >= this.ttlMs };
  }

  setValue(table, query, value, lease = {}) {
    const capturedLease = projectionLease(this.model, lease);
    assertProjectionAuthorizationScopeCurrent(
      this.model,
      capturedLease.projectionAuthorizationScope,
    );
    const key = this.key(table, query, capturedLease);
    this.cache.delete(key);
    this.cache.set(key, { ...value, key });
    while (this.cache.size > this.maxEntries) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return key;
  }

  query(table, query, loader, { lease = {}, prefetch = false } = {}) {
    const capturedLease = projectionLease(this.model, lease);
    const key = this.key(table, query, capturedLease);
    const cached = this.read(table, query, capturedLease);
    if (cached && !cached.stale) return Promise.resolve({ ...cached, cacheHit: true });
    const existing = this.flights.get(key);
    if (existing?.controller?.signal?.aborted) {
      if (this.flights.get(key) === existing) this.flights.delete(key);
    } else if (existing?.promise) {
      return existing.promise;
    }
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => loader({ signal: controller.signal, cached }))
      .then((value) => {
        if (controller.signal.aborted) {
          throw projectionScopeDisposedError(controller.signal.reason);
        }
        assertProjectionAuthorizationScopeCurrent(
          this.model,
          capturedLease.projectionAuthorizationScope,
        );
        this.setValue(table, query, {
          ...value,
          fetchedAt: Date.now(),
          prefetched: prefetch,
        }, capturedLease);
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
    const error = projectionScopeDisposedError();
    for (const flight of this.flights.values()) flight?.controller?.abort?.(error);
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
