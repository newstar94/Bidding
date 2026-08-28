import { getJson } from "./apiClient.js";
import {
  assertWorkspaceLeaseCurrent,
  captureWorkspaceLease,
} from "../app/workspaceLease.js";
import { perfNow, reportPerf } from "./perfDiagnostics.js";
import {
  assertProjectionAuthorizationScopeCurrent,
  captureProjectionAuthorizationScope,
  paginatedProjectionStore,
  projectionAuthorizationChangedError,
} from "./PaginatedProjectionStore.js";

const PAGINATION_CACHE_TTL_MS = 30_000;

function paginationCacheKey(model, table, params, lease) {
  return paginatedProjectionStore(model).key(table, params, lease);
}

function capturePaginatedLease(model, options = {}) {
  const lease = captureWorkspaceLease(model, options);
  return Object.freeze({
    ...lease,
    projectionAuthorizationScope: captureProjectionAuthorizationScope(model),
  });
}

function assertPaginatedLeaseCurrent(model, lease) {
  assertWorkspaceLeaseCurrent(model, lease);
  assertProjectionAuthorizationScopeCurrent(model, lease?.projectionAuthorizationScope);
  return lease;
}

function cacheEntryIsFresh(entry, now = Date.now()) {
  return Boolean(entry && now - entry.fetchedAt < PAGINATION_CACHE_TTL_MS);
}

function normalizedCancellationOwner(owner) {
  if (owner === undefined || owner === null) return "";
  return String(owner).trim();
}

function paginationSupersededError() {
  const error = new Error("Paginated request superseded by its owner");
  error.name = "AbortError";
  error.code = "PAGINATION_SUPERSEDED";
  return error;
}

function waitForOwnedPaginationRequest(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason instanceof Error
      ? signal.reason
      : paginationSupersededError());
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback(value);
    };
    const onAbort = () => finish(
      reject,
      signal.reason instanceof Error ? signal.reason : paginationSupersededError(),
    );
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function consumePaginationRequest(request, cancellationOwner) {
  if (!cancellationOwner) {
    request.unownedConsumers = Number(request.unownedConsumers || 0) + 1;
    return Promise.resolve(request.promise).finally(() => {
      request.unownedConsumers = Math.max(0, Number(request.unownedConsumers || 0) - 1);
    });
  }

  request.ownerConsumers ||= new Map();
  const existing = request.ownerConsumers.get(cancellationOwner);
  if (existing?.promise) return existing.promise;

  const controller = new AbortController();
  const consumer = { controller, promise: null };
  consumer.promise = waitForOwnedPaginationRequest(request.promise, controller.signal)
    .finally(() => {
      if (request.ownerConsumers?.get(cancellationOwner) === consumer) {
        request.ownerConsumers.delete(cancellationOwner);
      }
    });
  request.ownerConsumers.set(cancellationOwner, consumer);
  return consumer.promise;
}

function cancelSupersededPaginationRequests(
  model,
  table,
  lease,
  currentKey,
  cancellationOwner,
) {
  if (!cancellationOwner || !(model?._paginationRequests instanceof Map)) return;
  for (const [requestKey, request] of model._paginationRequests.entries()) {
    if (
      requestKey === currentKey
      || String(request?.table || "") !== String(table || "")
      || request?.lease?.token !== lease.token
      || request?.lease?.scope !== lease.scope
      || request?.lease?.db !== lease.db
      || request?.lease?.state !== lease.state
    ) continue;
    const consumer = request?.ownerConsumers?.get?.(cancellationOwner);
    if (!consumer) continue;
    request.ownerConsumers.delete(cancellationOwner);
    const error = paginationSupersededError();
    consumer.controller?.abort?.(error);
    if (
      request.ownerConsumers.size === 0
      && Number(request.unownedConsumers || 0) === 0
    ) {
      request.controller?.abort?.(error);
      if (model._paginationRequests.get(requestKey) === request) {
        model._paginationRequests.delete(requestKey);
      }
    }
  }
}

export function getCachedPaginatedRecords(model, table, params = {}, capturedLease = null) {
  const lease = capturedLease || capturePaginatedLease(model);
  const entry = paginatedProjectionStore(model).read(table, params, lease);
  if (!entry) return null;
  return {
    items: entry.items,
    totalItems: entry.totalItems,
    nextCursor: entry.nextCursor,
    hasMore: entry.hasMore,
    cacheHit: true,
    prefetched: Boolean(entry.prefetched),
    stale: !cacheEntryIsFresh(entry),
  };
}

export function invalidatePaginatedQueryCache(model, table = null) {
  if (!model) return;
  paginatedProjectionStore(model).invalidate(table);
}

export function invalidatePaginatedAuthorizationScope(model) {
  if (!model) return;
  const currentRevision = Number(model.visibilityRevision || 0);
  model.visibilityRevision = Number.isSafeInteger(currentRevision)
    ? currentRevision + 1
    : 1;
  paginatedProjectionStore(model).disposeWorkspace();
  if (model._planPackageHydrationRequests instanceof Map) {
    for (const request of model._planPackageHydrationRequests.values()) {
      request?.controller?.abort?.(projectionAuthorizationChangedError());
    }
    model._planPackageHydrationRequests.clear();
  }
}

const PLAN_SCOPED_PACKAGE_CHILD_TABLES = new Set([
  "goithauhanghoa",
  "thongtinmothau",
  "hanghoaduthaunhathau",
  "assignments",
]);

export function parseYearMonth(dateStr) {
  if (!dateStr) return { year: null, month: null };
  const cleaned = String(dateStr).replace(/\s*-\s*/, " ").trim();
  if (cleaned.match(/^\d{4}-\d{2}-\d{2}/)) {
    return {
      year: cleaned.substring(0, 4),
      month: parseInt(cleaned.substring(5, 7), 10).toString()
    };
  }
  if (cleaned.match(/^\d{2}\/\d{2}\/\d{4}/)) {
    const parts = cleaned.split(" ")[0].split("/");
    return {
      year: parts[2],
      month: parseInt(parts[1], 10).toString()
    };
  }
  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      year: parsed.getFullYear().toString(),
      month: (parsed.getMonth() + 1).toString()
    };
  }
  return { year: null, month: null };
}
export function collectYearMonthOptions(records, getDate) {
  const years = new Set();
  const months = new Set();
  (records || []).forEach((record) => {
    const parsed = parseYearMonth(getDate(record));
    if (parsed.year) years.add(parsed.year);
    if (parsed.month) months.add(parsed.month);
  });
  return {
    years: [...years].sort((a, b) => Number(b) - Number(a)),
    months: [...months].sort((a, b) => Number(b) - Number(a))
  };
}

export function matchesYearMonth(value, year = "", month = "") {
  if (!year && !month) return true;
  const parsed = parseYearMonth(value);
  if (!parsed.year || !parsed.month) return false;
  return (!year || parsed.year === String(year)) && (!month || parsed.month === String(month));
}

export function paginateRecords(records, currentPage, pageSize) {
  const startIndex = (Math.max(1, Number(currentPage) || 1) - 1) * pageSize;
  return (records || []).slice(startIndex, startIndex + pageSize);
}

function normalizedSearch(value) {
  return String(value || "").toLocaleLowerCase("vi");
}

export function paginatedSearchHasChanged(model, table, search) {
  if (!model?.useServerSidePagination) return true;
  const previousSearch = model._lastPaginatedQueries?.get(table)?.search;
  if (previousSearch === undefined) return true;
  return normalizedSearch(previousSearch) !== normalizedSearch(search);
}

/**
 * Load every package row owned by one plan version, including historical
 * package versions. The normal package list endpoint only returns `is_latest`
 * rows from the latest plans, so plan snapshot/version workflows must never
 * rely on whatever package rows happen to be cached locally.
 */
export async function hydratePlanPackageRecords(model, planId) {
  const normalizedPlanId = String(planId || "").trim();
  if (!model?.useServerSidePagination || !normalizedPlanId) return [];

  model._planPackageHydrationRequests ||= new Map();
  const controller = new AbortController();
  const lease = capturePaginatedLease(model, { controller });
  const requestKey = paginationCacheKey(model, "goithau", {
    hydrationPlanId: normalizedPlanId,
  }, lease);
  const existing = model._planPackageHydrationRequests.get(requestKey);
  if (existing) return existing.promise || existing;

  const request = (async () => {
    const hydrated = [];
    let cursor = "";
    do {
      const query = new URLSearchParams({
        table: "goithau",
        pageSize: "200",
        pagination: "cursor",
        sortBy: "id",
        sortOrder: "asc",
        keHoachId: normalizedPlanId,
      });
      if (cursor) query.set("cursor", cursor);
      const data = await getJson(`/api/paginate?${query}`, { signal: controller.signal });
      assertPaginatedLeaseCurrent(model, lease);
      hydrated.push(...cachePaginatedRecords(model, "goithau", data?.items || [], lease));
      const nextCursor = String(data?.nextCursor || "");
      if (!data?.hasMore || !nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    } while (cursor);
    return hydrated;
  })().finally(() => {
    if (model._planPackageHydrationRequests.get(requestKey)?.promise === request) {
      model._planPackageHydrationRequests.delete(requestKey);
    }
  });

  model._planPackageHydrationRequests.set(requestKey, { controller, lease, promise: request });
  return request;
}

/**
 * `cancellationOwner` identifies one UI request sequence. A newer query only
 * supersedes an older consumer with the same owner, table and workspace;
 * authorization changes fence every predecessor request separately.
 */
export async function loadPaginatedRecords(
  model,
  table,
  params = {},
  { prefetch = false, cancellationOwner: rawCancellationOwner = "" } = {},
) {
  const startedAt = perfNow();
  // Plan aggregate workflows often start by loading package-owned child rows.
  // Hydrate their parent package snapshots first; otherwise a newly-created plan
  // version can silently inherit zero packages when the browser cache is cold.
  if (PLAN_SCOPED_PACKAGE_CHILD_TABLES.has(table) && params?.keHoachId) {
    await hydratePlanPackageRecords(model, params.keHoachId);
  }

  const query = new URLSearchParams({ table });
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const paginatedLease = capturePaginatedLease(model);
  const key = paginationCacheKey(model, table, params, paginatedLease);
  const cancellationOwner = normalizedCancellationOwner(rawCancellationOwner);
  model._paginationRequests ||= new Map();
  cancelSupersededPaginationRequests(
    model,
    table,
    paginatedLease,
    key,
    cancellationOwner,
  );
  const cached = getCachedPaginatedRecords(model, table, params, paginatedLease);
  if (cached && !cached.stale) {
    reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: false, duration: Math.round(perfNow() - startedAt), cacheHit: true, prefetched: cached.prefetched });
    return cached;
  }
  const existing = model._paginationRequests.get(key);
  if (existing?.controller?.signal?.aborted) {
    if (model._paginationRequests.get(key) === existing) {
      model._paginationRequests.delete(key);
    }
  } else if (existing?.promise) {
    const result = await consumePaginationRequest(existing, cancellationOwner);
    reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: true, duration: Math.round(perfNow() - startedAt), cacheHit: false, prefetched: false, inFlightDeduped: true });
    return { ...result, cacheHit: false, inFlightDeduped: true };
  }
  const controller = new AbortController();
  const requestLease = Object.freeze({
    ...paginatedLease,
    controller,
    signal: controller.signal,
  });
  const requestPromise = (async () => {
    try {
      const data = await getJson(`/api/paginate?${query}`, { signal: controller.signal });
      assertPaginatedLeaseCurrent(model, requestLease);
      const result = {
        items: cachePaginatedRecords(model, table, data?.items || [], requestLease, {
          preserveQueryCache: true,
        }),
        totalItems: Number(data?.totalItems || 0),
        nextCursor: data?.nextCursor || null,
        hasMore: Boolean(data?.hasMore),
        cacheHit: false,
        prefetched: prefetch,
        inFlightDeduped: false,
      };
      paginatedProjectionStore(model).setValue(table, params, {
        ...result,
        fetchedAt: Date.now(),
        prefetched: prefetch,
      }, requestLease);
      if (!prefetch) {
        model._lastPaginatedQueries ||= new Map();
        model._lastPaginatedQueries.set(table, { ...params });
      }
      reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: true, duration: Math.round(perfNow() - startedAt), cacheHit: false, prefetched: prefetch });
      return result;
    } catch (error) {
      const canUseStaleCache = cached?.stale
        && error?.name !== "AbortError"
        && error?.code !== "WORKSPACE_CHANGED"
        && (error?.code === "NETWORK_ERROR"
          || error?.code === "REQUEST_TIMEOUT"
          || (typeof navigator !== "undefined" && navigator.onLine === false));
      if (!canUseStaleCache) throw error;
      console.warn(`Could not revalidate paginated ${table}; using stale workspace cache:`, error);
      reportPerf({
        phase: "paginated-data",
        tabName: model?.state?.activetab || null,
        query: table,
        cold: false,
        duration: Math.round(perfNow() - startedAt),
        cacheHit: true,
        prefetched: Boolean(cached.prefetched),
        stale: true,
        revalidationFailed: true,
      });
      return { ...cached, revalidationFailed: true };
    } finally {
      if (model._paginationRequests.get(key)?.controller === controller) {
        model._paginationRequests.delete(key);
      }
    }
  })();
  const request = {
    controller,
    lease: requestLease,
    promise: requestPromise,
    table: String(table || ""),
  };
  model._paginationRequests.set(key, request);
  return consumePaginationRequest(request, cancellationOwner);
}

export function prefetchPaginatedRecords(model, table, params = {}) {
  return loadPaginatedRecords(model, table, params, { prefetch: true }).catch((error) => {
    if (error?.name !== "AbortError") {
      reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: true, duration: 0, cacheHit: false, prefetched: true, error: error?.code || error?.message || "failed" });
      console.warn(`Could not prefetch paginated ${table}:`, error);
    }
    return null;
  });
}
export function sortRecords(records, field, order = "asc") {
  if (!field) return records;
  const direction = order === "desc" ? -1 : 1;
  records.sort((a, b) => {
    let valA = a[field] ?? "";
    let valB = b[field] ?? "";
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA < valB) return -1 * direction;
    if (valA > valB) return 1 * direction;
    return 0;
  });
  return records;
}
export function cachePaginatedRecords(
  model,
  key,
  records,
  workspaceLease = null,
  { preserveQueryCache = false } = {},
) {
  const lease = workspaceLease || captureWorkspaceLease(model);
  if (lease?.projectionAuthorizationScope) {
    assertPaginatedLeaseCurrent(model, lease);
  } else {
    assertWorkspaceLeaseCurrent(model, lease);
  }
  const normalized = (typeof model?.normalizeRecordKeys === "function"
    ? (records || []).map((record) => model.normalizeRecordKeys(record, key))
    : records || []
  ).map((record) => ({ ...record, referenceOnly: false }));
  if (!Array.isArray(lease.state[key])) {
    lease.state[key] = [];
  }
  normalized.forEach((record) => {
    const index = lease.state[key].findIndex((item) => String(item.id) === String(record.id));
    if (index >= 0) {
      lease.state[key][index] = record;
    } else {
      lease.state[key].push(record);
    }
  });
  if (normalized.length > 0) {
    model.entityIndexes?.invalidate?.(key, { notify: !preserveQueryCache });
  }
  if (normalized.length > 0 && lease.db && typeof lease.db.putRecords === "function") {
    lease.db.putRecords(key, normalized).catch((err) => {
      console.error(`Failed to cache paginated ${key} records:`, err);
    });
  }
  return normalized;
}
