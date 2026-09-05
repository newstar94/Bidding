import { getJson } from "./apiClient.js";
import {
  assertWorkspaceLeaseCurrent,
  captureWorkspaceLease,
} from "../app/workspaceLease.js";
import { perfNow, reportPerf } from "./perfDiagnostics.js";
import { getAppController } from "../app/controllerRef.js";
import {
  capturePlanBreakdownDraftLocalState,
  rebasePlanBreakdownDraftAfterServerMerge,
} from "../plans/planBreakdownDraft.js";
import {
  assertProjectionAuthorizationScopeCurrent,
  captureProjectionAuthorizationScope,
  normalizedProjectionKey,
  paginatedProjectionStore,
  projectionAuthorizationChangedError,
} from "./PaginatedProjectionStore.js";

const PAGINATION_CACHE_TTL_MS = 30_000;
const TIMELINE_PACKAGE_OPTION_PROJECTION = Object.freeze({
  table: "timeline-package-options",
  query: Object.freeze({ version: 1 }),
});

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
  return overlayPendingPaginatedMutations(model, table, {
    items: entry.items,
    totalItems: entry.totalItems,
    nextCursor: entry.nextCursor,
    hasMore: entry.hasMore,
    cacheHit: true,
    prefetched: Boolean(entry.prefetched),
    stale: !cacheEntryIsFresh(entry),
  }, params);
}

export function timelinePackagePageQuery(planId, search = "") {
  const normalizedPlanId = String(planId || "").trim();
  return {
    page: 1,
    pageSize: 200,
    search: String(search || ""),
    ...(normalizedPlanId ? { keHoachId: normalizedPlanId } : {}),
  };
}

function timelinePackageOptionProjectionKey(model) {
  return normalizedProjectionKey(
    model,
    TIMELINE_PACKAGE_OPTION_PROJECTION.table,
    TIMELINE_PACKAGE_OPTION_PROJECTION.query,
  );
}

function currentTimelinePackageOptionProjection(model) {
  const projection = model?._timelinePackageOptionProjection;
  if (!projection || projection.key !== timelinePackageOptionProjectionKey(model)) return null;
  return projection;
}

function normalizeTimelinePackageOptions(model, records = []) {
  const byId = new Map();
  (Array.isArray(records) ? records : []).forEach((rawRecord) => {
    const normalized = typeof model?.normalizeRecordKeys === "function"
      ? model.normalizeRecordKeys(rawRecord, "goithau")
      : rawRecord;
    const id = String(normalized?.id || "");
    if (!id) return;
    byId.set(id, { ...normalized });
  });
  return [...byId.values()];
}

function currentMutationBatch(model) {
  try {
    return typeof model?.getMutationQueue === "function" ? model.getMutationQueue() : null;
  } catch {
    return null;
  }
}

const PAGINATION_CONTROL_PARAMS = new Set([
  "page", "pageSize", "pagination", "cursor", "sortBy", "sortOrder", "search",
]);
const PAGINATED_SEARCH_FIELDS = Object.freeze({
  kehoach: ["maKeHoach", "tenKeHoach", "tenDuAnDuToan"],
  goithau: ["maGoiThau", "tenGoiThau"],
  chudautu: ["maChuDauTu", "tenChuDauTu", "tenVietTat", "maSoThue"],
  nhathau: ["maNhaThau", "tenNhaThau", "tenVietTat", "maSoThue"],
  chuyengia: ["hoTen", "soChungChi"],
  hopdong: ["soHopDong", "tenHopDong"],
});
const PAGINATED_DATE_FIELDS = Object.freeze({
  kehoach: "ngayPheDuyet",
  goithau: "ngayQuyetDinh",
  hopdong: "ngayKy",
});

function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi");
}

function recordMatchesPendingQuery(record, table, params = {}) {
  const search = normalizedSearchText(params.search).trim();
  if (search) {
    const fields = PAGINATED_SEARCH_FIELDS[table] || [];
    const haystack = normalizedSearchText(fields.map((field) => record?.[field]).join(" "));
    if (!haystack.includes(search)) return false;
  }
  for (const [key, rawValue] of Object.entries(params || {})) {
    if (PAGINATION_CONTROL_PARAMS.has(key)) continue;
    const expected = String(rawValue ?? "").trim();
    if (!expected) continue;
    if (key === "nam" || key === "thang") {
      const dateField = PAGINATED_DATE_FIELDS[table];
      const dateParts = parseYearMonth(dateField ? record?.[dateField] : "");
      if (String(dateParts[key === "nam" ? "year" : "month"] || "") !== expected) {
        return false;
      }
      continue;
    }
    if (String(record?.[key] ?? "") !== expected) return false;
  }
  return true;
}

function pendingRecordRoot(record) {
  return String(record?.rootId || record?.id || "");
}

function newerPendingVersion(left, right) {
  const leftLatest = Number(left?.isLatest ?? left?.is_latest ?? 0);
  const rightLatest = Number(right?.isLatest ?? right?.is_latest ?? 0);
  if (leftLatest !== rightLatest) return rightLatest > leftLatest ? right : left;
  const leftVersion = Number.parseInt(left?.phienBan ?? left?.phien_ban ?? 0, 10) || 0;
  const rightVersion = Number.parseInt(right?.phienBan ?? right?.phien_ban ?? 0, 10) || 0;
  return rightVersion >= leftVersion ? right : left;
}

function latestPendingUpserts(records, normalize) {
  const byRoot = new Map();
  for (const rawRecord of records) {
    const record = normalize(rawRecord);
    const root = pendingRecordRoot(record);
    if (!root) continue;
    byRoot.set(root, byRoot.has(root)
      ? newerPendingVersion(byRoot.get(root), record)
      : record);
  }
  return [...byRoot.values()];
}

/**
 * The server page is the canonical projection, but a just-saved record remains
 * in the durable outbox until the remote acknowledgement arrives. Overlay that
 * narrow, workspace-scoped mutation window so the table never goes blank or
 * shows the previous value immediately after a successful local save.
 */
export function overlayPendingPaginatedMutations(model, table, pageResult, params = {}) {
  const source = pageResult && typeof pageResult === "object" ? pageResult : {};
  const mutationBatch = currentMutationBatch(model);
  const pendingUpserts = Object.values(mutationBatch?.upserts?.[table] || {});
  const pendingPatches = Object.values(mutationBatch?.patches?.[table] || {});
  const pendingDeletes = new Set(
    (mutationBatch?.deletes || [])
      .filter((deletion) => String(deletion?.table || "") === String(table || ""))
      .map((deletion) => String(deletion?.id || ""))
      .filter(Boolean),
  );
  if (!pendingUpserts.length && !pendingPatches.length && !pendingDeletes.size) {
    return source;
  }

  const normalize = (record) => (
    typeof model?.normalizeRecordKeys === "function"
      ? model.normalizeRecordKeys(record, table)
      : record
  );
  const originalItems = Array.isArray(source.items) ? source.items : [];
  const byId = new Map(originalItems
    .map((record) => normalize(record))
    .filter((record) => record?.id !== undefined && record?.id !== null)
    .map((record) => [String(record.id), record]));
  const originalIds = new Set(byId.keys());
  let addedCount = 0;
  let removedCount = 0;

  for (const id of pendingDeletes) {
    if (byId.delete(id)) removedCount += 1;
  }
  for (const patch of pendingPatches) {
    const normalized = normalize(patch);
    const id = String(normalized?.id || "");
    const existing = byId.get(id);
    if (!id || !existing) continue;
    const merged = { ...existing, ...normalized };
    if (recordMatchesPendingQuery(merged, table, params)) byId.set(id, merged);
    else if (byId.delete(id)) removedCount += 1;
  }

  const isFirstPage = !String(params?.cursor || "").trim()
    && Math.max(1, Number(params?.page) || 1) === 1;
  for (const record of latestPendingUpserts(pendingUpserts, normalize)) {
    const id = String(record?.id || "");
    if (!id || pendingDeletes.has(id)) continue;
    const root = pendingRecordRoot(record);
    const lineageEntries = [...byId.entries()].filter(([, candidate]) => (
      pendingRecordRoot(candidate) === root
    ));
    const existedOnPage = byId.has(id) || originalIds.has(id) || lineageEntries.length > 0;
    for (const [candidateId] of lineageEntries) {
      if (candidateId !== id) byId.delete(candidateId);
    }
    if (!recordMatchesPendingQuery(record, table, params)) {
      byId.delete(id);
      if (existedOnPage) removedCount += 1;
      continue;
    }
    if (existedOnPage || isFirstPage) {
      byId.set(id, { ...(byId.get(id) || {}), ...record });
      if (!existedOnPage) addedCount += 1;
    }
  }

  const items = [...byId.values()];
  sortRecords(items, params?.sortBy, params?.sortOrder);
  const pageSize = Number(params?.pageSize);
  const visibleItems = Number.isFinite(pageSize) && pageSize > 0
    ? items.slice(0, pageSize)
    : items;
  return {
    ...source,
    items: visibleItems,
    totalItems: Math.max(0, Number(source.totalItems || 0) + addedCount - removedCount),
    pendingLocal: true,
  };
}

export function timelinePackageIsPendingLocal(model, recordId) {
  const id = String(recordId || "").trim();
  if (!id) return false;
  return Boolean(currentMutationBatch(model)?.upserts?.goithau?.[id]);
}

function overlayPendingTimelinePackageMutations(model, records = []) {
  const byId = new Map(
    normalizeTimelinePackageOptions(model, records)
      .map((record) => [String(record.id), record]),
  );
  const mutationBatch = currentMutationBatch(model);
  normalizeTimelinePackageOptions(
    model,
    Object.values(mutationBatch?.upserts?.goithau || {}),
  ).forEach((record) => byId.set(String(record.id), record));
  Object.values(mutationBatch?.patches?.goithau || {}).forEach((patch) => {
    const id = String(patch?.id || "");
    const existing = byId.get(id);
    if (id && existing) byId.set(id, { ...existing, ...patch });
  });
  (mutationBatch?.deletes || []).forEach((deletion) => {
    if (String(deletion?.table || "") === "goithau") {
      byId.delete(String(deletion?.id || ""));
    }
  });
  return [...byId.values()];
}

function storeTimelinePackageOptionProjection(
  model,
  records = [],
  { overlayPending = true } = {},
) {
  if (!model) return [];
  const items = overlayPending
    ? overlayPendingTimelinePackageMutations(model, records)
    : normalizeTimelinePackageOptions(model, records);
  model._timelinePackageOptionProjection = Object.freeze({
    key: timelinePackageOptionProjectionKey(model),
    items: Object.freeze(items),
  });
  return items;
}

export function getTimelinePackageOptionRecords(model) {
  const current = currentTimelinePackageOptionProjection(model);
  return current ? overlayPendingTimelinePackageMutations(model, current.items) : [];
}

/**
 * Reconcile the timeline's lightweight option projection only from server
 * evidence. A full sync replaces it with the complete authorized reference
 * projection; later deltas merge their authorized package rows and tombstones.
 * It intentionally never fabricates an exact `/api/paginate` response.
 */
export function reconcileTimelinePackageOptionProjection(
  model,
  snapshot = {},
  { allowHydratedSnapshot = false } = {},
) {
  const usesServerPagination = Boolean(
    model?.useServerSidePagination || snapshot?.useServerSidePagination,
  );
  if (!usesServerPagination) {
    if (model) delete model._timelinePackageOptionProjection;
    return [];
  }

  const references = snapshot?.referenceData?.goithau;
  const current = currentTimelinePackageOptionProjection(model);
  const hydratedFallback = !Array.isArray(references)
    && !current
    && allowHydratedSnapshot
    && snapshot?.visibilityToken
    ? model?.state?.goithau || []
    : null;
  if (!Array.isArray(references) && !current && !hydratedFallback) return [];

  const byId = new Map(
    normalizeTimelinePackageOptions(
      model,
      Array.isArray(references) ? references : current?.items || hydratedFallback,
    ).map((record) => [String(record.id), record]),
  );
  if (!Array.isArray(references)) {
    normalizeTimelinePackageOptions(model, snapshot?.goithau || []).forEach((record) => {
      byId.set(String(record.id), record);
    });
  }
  (snapshot?.deletions || []).forEach((deletion) => {
    if (String(deletion?.table || "") === "goithau") {
      byId.delete(String(deletion?.id || ""));
    }
  });
  if (Array.isArray(snapshot?.recordManifest?.goithau)) {
    const allowedIds = new Set(snapshot.recordManifest.goithau.map(String));
    for (const id of byId.keys()) {
      if (!allowedIds.has(id)) byId.delete(id);
    }
  }
  return storeTimelinePackageOptionProjection(model, [...byId.values()]);
}

export function reconcileTimelinePackageOptionPage(
  model,
  planId,
  records = [],
  { replacePlan = false } = {},
) {
  const normalizedPlanId = String(planId || "").trim();
  if (!model?.useServerSidePagination || !normalizedPlanId) return [];
  const current = getTimelinePackageOptionRecords(model);
  const retained = replacePlan
    ? current.filter((record) => (
      String(record?.keHoachId || record?.ke_hoach_id || "") !== normalizedPlanId
    ))
    : current;
  const byId = new Map(
    normalizeTimelinePackageOptions(model, retained)
      .map((record) => [String(record.id), record]),
  );
  normalizeTimelinePackageOptions(model, records).forEach((record) => {
    byId.set(String(record.id), record);
  });
  return storeTimelinePackageOptionProjection(model, [
    ...byId.values(),
  ]);
}

export function invalidateTimelinePackageOptionProjection(model, recordId = "") {
  if (!model) return;
  const normalizedRecordId = String(recordId || "").trim();
  const current = currentTimelinePackageOptionProjection(model);
  if (!normalizedRecordId || !current) {
    delete model._timelinePackageOptionProjection;
    return;
  }
  storeTimelinePackageOptionProjection(
    model,
    current.items.filter((record) => String(record?.id || "") !== normalizedRecordId),
    { overlayPending: false },
  );
}

export function abortPaginatedTableRequests(model, table) {
  if (!model || !table) return;
  const error = projectionAuthorizationChangedError();
  for (const [key, request] of model._paginationRequests || []) {
    if (String(request?.table || "") !== String(table)) continue;
    request?.controller?.abort?.(error);
    if (model._paginationRequests.get(key) === request) {
      model._paginationRequests.delete(key);
    }
  }
}

export function invalidatePaginatedQueryCache(model, table = null) {
  if (!model) return;
  if (!table) delete model._timelinePackageOptionProjection;
  paginatedProjectionStore(model).invalidate(table);
}

export function invalidatePaginatedAuthorizationScope(model) {
  if (!model) return;
  const currentRevision = Number(model.visibilityRevision || 0);
  model.visibilityRevision = Number.isSafeInteger(currentRevision)
    ? currentRevision + 1
    : 1;
  delete model._timelinePackageOptionProjection;
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
      return overlayPendingPaginatedMutations(model, table, result, params);
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
  const appController = getAppController();
  const draftController = appController?.model === model ? appController : null;
  const draftLocalState = capturePlanBreakdownDraftLocalState(
    model,
    draftController?.planBreakdownDraft,
  );
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
  if (draftLocalState) {
    rebasePlanBreakdownDraftAfterServerMerge(
      model,
      draftController.planBreakdownDraft,
      draftLocalState,
      new Set([key]),
    );
  }
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
