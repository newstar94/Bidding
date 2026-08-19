import { getJson } from "./apiClient.js";
import {
  assertWorkspaceLeaseCurrent,
  captureWorkspaceLease,
} from "../app/workspaceLease.js";

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

export async function loadPaginatedRecords(model, table, params = {}) {
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
  model._paginationRequests ||= new Map();
  model._paginationRequests.get(table)?.abort();
  const controller = new AbortController();
  const lease = captureWorkspaceLease(model, { controller });
  model._paginationRequests.set(table, controller);
  try {
    const data = await getJson(`/api/paginate?${query}`, { signal: controller.signal });
    assertWorkspaceLeaseCurrent(model, lease);
    model._lastPaginatedQueries ||= new Map();
    model._lastPaginatedQueries.set(table, { ...params });
    return {
      items: cachePaginatedRecords(model, table, data?.items || [], lease),
      totalItems: Number(data?.totalItems || 0),
      nextCursor: data?.nextCursor || null,
      hasMore: Boolean(data?.hasMore)
    };
  } finally {
    if (model._paginationRequests.get(table) === controller) {
      model._paginationRequests.delete(table);
    }
  }
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
export function cachePaginatedRecords(model, key, records, workspaceLease = null) {
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
  if (normalized.length > 0) model.entityIndexes?.invalidate?.(key);
  if (normalized.length > 0 && lease.db && typeof lease.db.putRecords === "function") {
    lease.db.putRecords(key, normalized).catch((err) => {
      console.error(`Failed to cache paginated ${key} records:`, err);
    });
  }
  return normalized;
}
