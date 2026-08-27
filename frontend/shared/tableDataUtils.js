import { getJson } from "./apiClient.js";
import {
  assertWorkspaceLeaseCurrent,
  captureWorkspaceLease,
} from "../app/workspaceLease.js";
import { perfNow, reportPerf } from "./perfDiagnostics.js";

const PAGINATION_CACHE_TTL_MS = 30_000;

function stableQueryKey(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, Array.isArray(value) ? value.map(String) : String(value)])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(JSON.stringify(value))}`)
    .join("&");
}

function paginationCacheFor(model) {
  model._paginatedQueryCache ||= new Map();
  return model._paginatedQueryCache;
}

function paginationCacheKey(model, table, params, lease) {
  const activeRole = String(model?.state?.activerole || "");
  return `${lease.token || lease.scope || "workspace"}:${encodeURIComponent(activeRole)}:${table}:${stableQueryKey(params)}`;
}

function cacheEntryIsFresh(entry, now = Date.now()) {
  return Boolean(entry && now - entry.fetchedAt < PAGINATION_CACHE_TTL_MS);
}

export function getCachedPaginatedRecords(model, table, params = {}) {
  const lease = captureWorkspaceLease(model);
  const entry = paginationCacheFor(model).get(paginationCacheKey(model, table, params, lease));
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
  const cache = model?._paginatedQueryCache;
  if (!(cache instanceof Map)) return;
  if (!table) {
    cache.clear();
    return;
  }
  const suffix = `:${table}:`;
  [...cache.keys()].forEach((key) => {
    if (key.includes(suffix)) cache.delete(key);
  });
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
  const lease = captureWorkspaceLease(model, { controller });
  const requestKey = `${lease.token}:${normalizedPlanId}`;
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
      assertWorkspaceLeaseCurrent(model, lease);
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

export async function loadPaginatedRecords(model, table, params = {}, { prefetch = false } = {}) {
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
  const lease = captureWorkspaceLease(model);
  const key = paginationCacheKey(model, table, params, lease);
  const cached = getCachedPaginatedRecords(model, table, params);
  if (cached && !cached.stale) {
    reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: false, duration: Math.round(perfNow() - startedAt), cacheHit: true, prefetched: cached.prefetched });
    return cached;
  }
  model._paginationRequests ||= new Map();
  const existing = model._paginationRequests.get(key);
  if (existing?.promise) {
    const result = await existing.promise;
    reportPerf({ phase: "paginated-data", tabName: model?.state?.activetab || null, query: table, cold: true, duration: Math.round(perfNow() - startedAt), cacheHit: false, prefetched: false, inFlightDeduped: true });
    return { ...result, cacheHit: false, inFlightDeduped: true };
  }
  [...model._paginationRequests.entries()]
    .filter(([requestKey]) => {
      const activeRole = encodeURIComponent(String(model?.state?.activerole || ""));
      return requestKey.startsWith(`${lease.token || lease.scope || "workspace"}:${activeRole}:${table}:`)
        && requestKey !== key;
    })
    .forEach(([, request]) => request?.controller?.abort?.());
  const controller = new AbortController();
  const requestLease = captureWorkspaceLease(model, { controller });
  const requestPromise = (async () => {
    try {
      const data = await getJson(`/api/paginate?${query}`, { signal: controller.signal });
      assertWorkspaceLeaseCurrent(model, requestLease);
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
      paginationCacheFor(model).set(key, {
        ...result,
        fetchedAt: Date.now(),
        prefetched: prefetch,
      });
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
  model._paginationRequests.set(key, { controller, lease: requestLease, promise: requestPromise });
  return requestPromise;
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
  assertWorkspaceLeaseCurrent(model, lease);
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
