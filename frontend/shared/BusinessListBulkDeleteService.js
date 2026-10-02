import { apiFetch, ApiError } from "./apiClient.js";
import { generateUUID } from "./idUtils.js";
import {
  beginWorkspaceRequest, finishWorkspaceRequest, assertWorkspaceLeaseCurrent,
  isWorkspaceLeaseCurrent, workspaceChangedError,
} from "../app/workspaceLease.js";
import {
  captureProjectionAuthorizationScope, assertProjectionAuthorizationScopeCurrent,
} from "./PaginatedProjectionStore.js";
import { invalidatePaginatedQueryCache } from "./tableDataUtils.js";
import { clearDeletedBusinessListSelections } from "./BusinessListSelection.js";
import { CLIENT_TABLE_MAP } from "../documents/schemaRuntime.js";

const SESSIONS = new WeakMap();
const DELETE_TABLES = new Set(["kehoach", "goithau", "hopdong", "thongtinmothau"]);
const SERVER_TABLES = new Map(Object.entries(CLIENT_TABLE_MAP).map(([key, value]) => [value, key]));
const RENDERS = ["renderKeHoachTable", "renderGoiThauTable", "renderHopDongTable"];
export const BUSINESS_LIST_BULK_DELETE_LIMIT = 2000;

function fail(message, code) { return new ApiError(message, { code }); }

function assertReady(model) {
  if (globalThis.navigator?.onLine === false) {
    throw fail("Cần kết nối mạng để xác nhận và xóa các dòng đã chọn.", "BULK_DELETE_OFFLINE");
  }
  // The same delete control is unavailable to employees in all three lists.
  // Record/module/assignment authorization remains authoritative on the server.
  if (model?.state?.activerole === "employee") {
    throw fail("Vai trò hiện tại không có thao tác xóa trong danh sách này.", "BULK_DELETE_ROLE");
  }
  if (model?.hasPendingMutationOutboxChanges?.() || model?._workspaceMutations?.size) {
    throw fail("Có thay đổi đang chờ lưu. Hãy hoàn tất đồng bộ rồi thực hiện xóa hàng loạt.", "BULK_DELETE_PENDING_CHANGES");
  }
}

function normalizeRecord(model, table, record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return record;
  const normalized = typeof model.normalizeRecordKeys === "function"
    ? model.normalizeRecordKeys(record, table) : record;
  return { ...normalized, ...(Array.isArray(normalized.allVersions)
    ? { allVersions: normalized.allVersions.map((row) => normalizeRecord(model, table, row)) } : {}) };
}

function responseErrors(data) {
  return Array.isArray(data?.errors) ? data.errors : Array.isArray(data?.fields?.errors) ? data.fields.errors : [];
}

function responseMessage(data, fallback) {
  const errors = responseErrors(data);
  const detail = errors.map((error) => error?.message).filter(Boolean).join("\n");
  return detail || data?.message || data?.error || fallback;
}

/** Read only, uncached preparation. Every request attempt keeps the same tenant. */
export async function createBusinessListBulkDeleteSession(controller, { fetchImpl = globalThis.fetch } = {}) {
  const model = controller?.model;
  if (!model?.state) throw fail("Không tìm thấy danh sách đang mở.", "BULK_DELETE_NO_MODEL");
  const initialRequest = beginWorkspaceRequest(model);
  const initialRole = model.state.activerole;
  try {
    assertReady(model);
    await controller.awaitAuthoritativeMutationBoundary?.();
    if (controller._autoSyncOwner?.promise) await controller._autoSyncOwner.promise;
    if (controller.model !== model || model.state.activerole !== initialRole) throw workspaceChangedError();
    assertWorkspaceLeaseCurrent(model, initialRequest.lease);
    assertReady(model);
  } finally {
    finishWorkspaceRequest(model, initialRequest);
  }
  const request = beginWorkspaceRequest(model);
  const authorization = captureProjectionAuthorizationScope(model);
  let closed = false;
  let sessionState;
  const assertCurrent = () => {
    if (closed || controller.model !== model) throw workspaceChangedError();
    assertWorkspaceLeaseCurrent(model, request.lease);
    const currentAuthorization = captureProjectionAuthorizationScope(model);
    if (["identity", "organization", "role"].some((key) => currentAuthorization[key] !== authorization[key])) {
      throw workspaceChangedError();
    }
    // After a request has actually been sent, a pull may advance the visibility
    // revision. Its exact frozen request can still reconcile by idempotency;
    // the server revalidates any command that has not already committed.
    if (!sessionState?.attempted) assertProjectionAuthorizationScopeCurrent(model, authorization);
    assertReady(model);
  };
  const fencedFetch = (url, options) => {
    assertCurrent();
    // apiFetch rebuilds tenant headers for each retry. Pin the checked lease's
    // tenant at this last synchronous boundary instead of trusting global state.
    const headers = new Headers(options?.headers || {});
    if (authorization.organization) headers.set("X-Active-Org", encodeURIComponent(authorization.organization));
    else headers.delete("X-Active-Org");
    if (url === "/api/sync" && options?.method === "POST") sessionState.attempted = true;
    return fetchImpl(url, { ...options, headers });
  };
  const read = async (url) => {
    assertCurrent();
    const response = await apiFetch(url, {
      signal: request.signal, cache: "no-store", handleHttpErrors: false,
    }, fencedFetch);
    const data = await response.json();
    assertCurrent();
    if (!response.ok || data?.status === "error") {
      throw new ApiError(responseMessage(data, "Chưa thể xác nhận dữ liệu với máy chủ."), {
        status: response.status, code: data?.code || "BULK_DELETE_READ_FAILED",
      });
    }
    return data;
  };
  const session = Object.freeze({
    assertCurrent,
    async readPage(table, params = {}) {
      const query = new URLSearchParams({ table });
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          query.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      }
      const data = await read(`/api/paginate?${query}`);
      if (!Array.isArray(data?.items)) throw fail("Danh sách từ máy chủ chưa đầy đủ.", "BULK_DELETE_INVALID_PAGE");
      return { ...data, items: data.items.map((row) => normalizeRecord(model, table, row)) };
    },
    async readRecord(table, id) {
      const data = await read(`/api/record?${new URLSearchParams({ table, lookup: id, exactId: "1" })}`);
      const record = normalizeRecord(model, table, data?.item);
      if (!record || String(record.id) !== String(id)) {
        throw fail("Một bản ghi đã thay đổi hoặc không còn truy cập được. Hãy tải lại danh sách và chọn lại.", "BULK_DELETE_RECORD_CHANGED");
      }
      return record;
    },
    async readSyncVersion() {
      const data = await read("/api/sync-version");
      if (!/^(0|[1-9]\d*)$/.test(String(data?.syncVersion ?? ""))) {
        throw fail("Chưa thể xác nhận phiên dữ liệu với máy chủ.", "BULK_DELETE_INVALID_REVISION");
      }
      return String(data.syncVersion);
    },
    close() {
      if (closed) return;
      closed = true;
      request.controller.abort();
      finishWorkspaceRequest(model, request);
    },
  });
  sessionState = { controller, model, request, authorization, fencedFetch,
    frozen: null, inFlight: null, result: null, attempted: false, outcomeUncertain: false };
  SESSIONS.set(session, sessionState);
  return session;
}

function freezeCommand(command) {
  const deletions = command?.deletions;
  const expectedSyncVersion = String(command?.expectedSyncVersion ?? command?.baseSyncVersion ?? "");
  if (!Array.isArray(deletions) || !deletions.length || deletions.length > BUSINESS_LIST_BULK_DELETE_LIMIT
    || !/^(0|[1-9]\d*)$/.test(expectedSyncVersion)) {
    throw fail("Phạm vi xóa không hợp lệ hoặc vượt giới hạn một lần xóa.", "BULK_DELETE_INVALID_COMMAND");
  }
  const keys = new Set();
  const rows = deletions.map((row) => {
    const id = String(row?.id || "");
    const key = `${row?.table}:${id}`;
    if (!DELETE_TABLES.has(row?.table) || !id || !Number.isSafeInteger(row.expectedVersion)
      || row.expectedVersion < 1 || keys.has(key)) {
      throw fail("Chưa xác nhận được đầy đủ phiên bản của các bản ghi cần xóa.", "BULK_DELETE_INVALID_COMMAND");
    }
    keys.add(key);
    return Object.freeze({ table: row.table, id, expectedVersion: row.expectedVersion });
  });
  return Object.freeze({ expectedSyncVersion, baseSyncVersion: expectedSyncVersion, deletions: Object.freeze(rows) });
}

function sameWorkspace(state) {
  const authorization = captureProjectionAuthorizationScope(state.model);
  return state.controller.model === state.model && isWorkspaceLeaseCurrent(state.model, state.request.lease)
    && ["identity", "organization", "role"].every((key) => authorization[key] === state.authorization[key]);
}

async function reconcileConfirmedBatch(state, payload, data) {
  const { model, controller } = state;
  if (!sameWorkspace(state)) return { workspaceChanged: true, refreshPending: true };
  const deletions = {};
  for (const row of [...payload.deletions, ...(data.deleteImpacts || []), ...(data.orphanedIds || [])]) {
    const table = SERVER_TABLES.get(row.table) || row.table;
    if (!CLIENT_TABLE_MAP[table] || row.id == null) continue;
    (deletions[table] ||= []).push(String(row.id));
  }
  for (const key of Object.keys(deletions)) deletions[key] = [...new Set(deletions[key])];
  invalidatePaginatedQueryCache(model, null, { abortInFlight: true });
  clearDeletedBusinessListSelections(model, deletions);
  // This is an ACK projection, never a new local mutation or an outbox entry.
  // A cache-write failure cannot undo the already committed server transaction.
  let refreshPending = false;
  try { await model.db?.applySyncChanges?.({ deletions }); }
  catch { refreshPending = true; }
  if (!sameWorkspace(state)) return { workspaceChanged: true, refreshPending: true };
  for (const [table, ids] of Object.entries(deletions)) {
    const removed = new Set(ids);
    if (Array.isArray(model.state[table])) {
      model.state[table] = model.state[table].filter((row) => !removed.has(String(row.id)));
      model.entityIndexes?.invalidate?.(table);
    }
    if (model.currentPage && table in model.currentPage) model.currentPage[table] = 1;
  }
  model.dashboardSummary = data.dashboardSummary || null;
  if (controller.view) controller.view._dashboardAggregateCache = null;
  try {
    const pull = await controller.forceSyncData?.(true, true);
    if (!pull?.ok) refreshPending = true;
  } catch { refreshPending = true; }
  if (!sameWorkspace(state)) return { workspaceChanged: true, refreshPending: true };
  // A full pull intentionally omits paginated table rows. Refresh those lists
  // explicitly even when that pull reports no changed data for their stores.
  const renders = await Promise.allSettled(RENDERS.map((name) => controller.view?.[name]?.()));
  if (renders.some((result) => result.status === "rejected")) refreshPending = true;
  return { refreshPending };
}

/** One atomic server transaction; retries always carry exactly the same body. */
export async function submitBusinessListBulkDelete(session, command) {
  const state = SESSIONS.get(session);
  if (!state) throw fail("Phiên xóa không hợp lệ.", "BULK_DELETE_INVALID_SESSION");
  if (state.result) return state.result;
  if (state.inFlight) return state.inFlight;
  session.assertCurrent();
  const frozen = freezeCommand(command);
  const signature = JSON.stringify(frozen);
  if (state.frozen && state.frozen.signature !== signature) {
    throw fail("Danh sách xóa đã được xác nhận không thể thay đổi khi thử lại.", "BULK_DELETE_COMMAND_CHANGED");
  }
  if (!state.frozen) {
    const id = generateUUID();
    const payload = Object.freeze({ ...frozen, clientMutationId: id, includeDashboardSummary: true });
    state.frozen = { signature, id, payload, body: JSON.stringify(payload) };
  }
  const { id, body, payload } = state.frozen;
  state.inFlight = (async () => {
    let response;
    let data;
    try {
      response = await apiFetch("/api/sync", {
        method: "POST", body, signal: state.request.signal, handleHttpErrors: false,
        headers: { "Content-Type": "application/json", "Idempotency-Key": id },
      }, state.fencedFetch);
      data = await response.json();
    } catch (error) {
      state.outcomeUncertain = true;
      return { ok: false, unknown: true, workspaceChanged: !sameWorkspace(state), error,
        message: "Chưa nhận được kết quả xóa. Thử lại sẽ kiểm tra đúng đợt xóa đã xác nhận." };
    }
    if (!response.ok || data?.status !== "success") {
      const unknown = response.status >= 500 || (response.ok && data?.status !== "error")
        || (state.outcomeUncertain && [401, 403, 408, 429].includes(response.status));
      const result = { ok: false, unknown, status: response.status, errors: responseErrors(data),
        workspaceChanged: !sameWorkspace(state),
        message: unknown ? "Chưa xác nhận được kết quả xóa. Hãy thử lại đúng đợt xóa này."
          : responseMessage(data, "Máy chủ từ chối đợt xóa. Toàn bộ dữ liệu được giữ nguyên.") };
      state.outcomeUncertain = unknown;
      if (!unknown) state.result = result;
      return result;
    }
    let reconciliation;
    state.outcomeUncertain = false;
    try { reconciliation = await reconcileConfirmedBatch(state, payload, data); }
    catch { reconciliation = { refreshPending: true, workspaceChanged: !sameWorkspace(state) }; }
    state.result = { ok: true, data, ...reconciliation };
    return state.result;
  })().finally(() => { state.inFlight = null; });
  return state.inFlight;
}
