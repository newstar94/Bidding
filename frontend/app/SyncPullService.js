import { trustedHTML } from "../shared/trustedTypes.js";
import { apiFetch } from "../shared/apiClient.js";
import { applyServerSnapshot } from "./syncMergeUtils.js";
import { getActiveOrganizationId } from "./workspaceState.js";
import {
  commitSyncCursor,
  fetchDeltaSnapshot,
  readSyncCursor,
} from "./syncCursor.js";
import {
  captureWorkspace,
  currentWorkspaceStorage,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";
import { renderChangedState } from "./SyncRenderCoordinator.js";
import { hideOfflineBanner } from "./SyncPresenter.js";
import {
  assertWorkspaceLeaseCurrent,
  beginWorkspaceRequest,
  finishWorkspaceRequest,
} from "./workspaceLease.js";


const DETAIL_ROUTE_TABLE = {
  "goithau-detail": "goithau",
  "kehoach-detail": "kehoach",
  "hopdong-detail": "hopdong",
  "chudautu-detail": "chudautu",
  "nhathau-detail": "nhathau"
};

const ACTIONABLE_PENDING_SYNC_PHASES = new Set([
  "conflict",
  "error",
  "storageError",
  "transportError",
  "validationRejected",
]);

function beginPullProgress(controller, { isBackground, syncIcon, syncStatusText }) {
  const preserveActionablePhase = isBackground && ACTIONABLE_PENDING_SYNC_PHASES.has(
    String(controller?._syncUxState?.phase || ""),
  );
  if (preserveActionablePhase) return true;
  controller.updateSyncState({ phase: "syncing" });
  syncIcon?.classList.add("anim-spin");
  if (syncStatusText) syncStatusText.textContent = "Đang đồng bộ...";
  return false;
}

function updatePullProgressLabel(syncStatusText, {
  preserveActionablePhase,
  isBackground,
  hasLocalDataForCurrentRoute,
}) {
  if (!syncStatusText || preserveActionablePhase) return;
  syncStatusText.textContent = !isBackground && !hasLocalDataForCurrentRoute
    ? "Đang tải dữ liệu lần đầu..."
    : "Đang đồng bộ...";
}

function updatePullFailureState(controller, syncStatusText, {
  preserveActionablePhase,
  message,
}) {
  if (preserveActionablePhase) return;
  if (syncStatusText) syncStatusText.textContent = message;
  controller.updateSyncState({ phase: "error", message });
}

export function finalizePulledSyncState(controller, timestamp = Date.now()) {
  const localMutationsPending = Boolean(
    controller?.model?.buildMutationSyncPayload?.(),
  );
  const currentPhase = String(controller?._syncUxState?.phase || "");
  // A background pull can finish after an interrupted mutation has already
  // reported a recoverable failure. Keep that actionable state visible until
  // the user explicitly retries, rather than replacing it with a generic
  // local-pending label.
  if (localMutationsPending && ACTIONABLE_PENDING_SYNC_PHASES.has(currentPhase)) {
    return true;
  }
  controller?.updateSyncState?.(localMutationsPending
    ? {
        phase: "localPending",
        online: true,
        message: "Đã lưu cục bộ · Chờ đồng bộ",
      }
    : {
        phase: "serverSaved",
        online: true,
        lastSyncedAt: timestamp,
      });
  return localMutationsPending;
}

export function detailRecordExists(model, tableKey, lookup) {
  const needle = String(decodeURIComponent(lookup || "")).toLowerCase();
  const cleanNeedle = needle.replace(/[\/-]/g, "");
  const list = Array.isArray(model.state[tableKey]) ? model.state[tableKey] : [];
  const completenessFields = {
    goithau: ["giaGoiThau", "hinhThucLuaChon"],
    kehoach: ["tenDuAnDuToan", "pheDuyet"],
    hopdong: ["ngayKy", "giaTri"],
    chudautu: ["diaChi", "daiDienCdt"],
    nhathau: ["diaChi", "nguoiDaiDien"]
  };
  const hasMeaningfulValue = (value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== void 0 && value !== null && value !== "";
  };
  return list.some((item) => {
    const isMatch = (() => {
      if (String(item.id || "").toLowerCase() === needle) return true;
      if (tableKey === "goithau" && String(item.maGoiThau || "").toLowerCase() === needle) return true;
      if (tableKey === "kehoach" && encodeURIComponent(String(item.maKeHoach || "")).toLowerCase() === needle) return true;
      if (tableKey === "hopdong" && String(item.soHopDong || "").toLowerCase().replace(/[\/-]/g, "") === cleanNeedle) return true;
      if (tableKey === "chudautu" && String(item.maChuDauTu || "").toLowerCase() === needle) return true;
      if (tableKey === "nhathau" && String(item.maNhaThau || "").toLowerCase() === needle) return true;
      return false;
    })();
    if (!isMatch) return false;
    if (item.referenceOnly === true) return false;
    if (item.referenceOnly === false) return true;
    return hasMeaningfulValue(item.organizationId)
      || (completenessFields[tableKey] || []).some((field) => hasMeaningfulValue(item[field]));
  });
}

export function storeFetchedRecord(model, tableKey, record) {
  if (!model || !tableKey || !record?.id) return null;
  if (!Array.isArray(model.state[tableKey])) model.state[tableKey] = [];
  const index = model.state[tableKey].findIndex(
    (item) => String(item.id) === String(record.id),
  );
  if (index >= 0) model.state[tableKey][index] = record;
  else model.state[tableKey].push(record);
  model.entityIndexes?.invalidate?.(tableKey);
  return record;
}

export async function fetchRecordByLookup(tableKey, lookup) {
  if (!tableKey || !lookup) return null;
  const model = this.model;
  const request = beginWorkspaceRequest(model);
  try {
    const response = await apiFetch(`/api/record?table=${encodeURIComponent(tableKey)}&lookup=${encodeURIComponent(lookup)}`, {
      headers: { "X-Active-Org": encodeURIComponent(getActiveOrganizationId()) },
      signal: request.signal,
    });
    assertWorkspaceLeaseCurrent(model, request.lease);
    if (!response.ok) return null;
    const data = await response.json();
    assertWorkspaceLeaseCurrent(model, request.lease);
    if (!data || !data.item) return null;
    const normalized = typeof model.normalizeRecordKeys === "function"
      ? model.normalizeRecordKeys(data.item, tableKey)
      : data.item;
    const record = { ...normalized, referenceOnly: false };
    storeFetchedRecord(model, tableKey, record);
    if (request.lease.db && typeof request.lease.db.putRecord === "function") {
      await request.lease.db.putRecord(tableKey, record);
      assertWorkspaceLeaseCurrent(model, request.lease);
      model.markStorageTablesRecovered?.([tableKey]);
    } else if (request.lease.db && typeof model.persistData === "function") {
      await model.persistData(tableKey, { trackMutation: false });
      assertWorkspaceLeaseCurrent(model, request.lease);
      model.markStorageTablesRecovered?.([tableKey]);
    }
    return record;
  } finally {
    finishWorkspaceRequest(model, request);
  }
}

export function ensureDetailRecordLoaded(tabName, action) {
  const tableKey = DETAIL_ROUTE_TABLE[tabName];
  if (!tableKey || !action || !this.model?.useServerSidePagination) return null;
  if (detailRecordExists(this.model, tableKey, action)) return null;
  const pendingKey = `${tableKey}:${action}`;
  this._pendingDetailRecordLoads ||= new Map();
  if (this._pendingDetailRecordLoads.has(pendingKey)) {
    return this._pendingDetailRecordLoads.get(pendingKey);
  }
  const promise = this.fetchRecordByLookup(tableKey, action).catch((error) => {
    console.error("Failed to fetch detail record:", error);
    return null;
  }).finally(() => {
    this._pendingDetailRecordLoads.delete(pendingKey);
  });
  this._pendingDetailRecordLoads.set(pendingKey, promise);
  return promise;
}

async function settleOutboxBeforeAuthoritativePull(controller) {
  let status = controller.model?.getMutationOutboxStatus?.();
  if (status?.state === "pending" && typeof controller.model?.flushMutationOutbox === "function") {
    try {
      await controller.model.flushMutationOutbox();
    } catch {
      // Status below carries the bounded durability failure without exposing queue contents.
    }
    status = controller.model?.getMutationOutboxStatus?.();
  }
  if (status?.trusted !== false) return null;
  const error = controller.model?.getMutationOutboxFailure?.()
    || Object.assign(new Error("Mutation outbox durability is degraded"), {
      code: status.code || "OUTBOX_DURABILITY_PENDING",
    });
  controller.updateSyncState?.({
    phase: "storageError",
    message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
  });
  return { ok: false, error, storageDegraded: true };
}

async function executeForceSyncData(isBackground = false, forceFull = false, routeOnly = false) {
  const workspace = captureWorkspace(this);
  if (!workspace.organizationId) return { ok: false, error: "No active workspace" };
  const outboxFailure = await settleOutboxBeforeAuthoritativePull(this);
  if (outboxFailure) return outboxFailure;
  const pullKey = workspace.token || workspace.organizationId;
  this._workspacePullGenerations ||= new Map();
  const pullGeneration = (this._workspacePullGenerations.get(pullKey) || 0) + 1;
  this._workspacePullGenerations.set(pullKey, pullGeneration);
  const pullIsCurrent = () => (
    workspaceIsCurrent(this, workspace)
    && this._workspacePullGenerations.get(pullKey) === pullGeneration
  );
  const storage = currentWorkspaceStorage(this);
  const syncIcon = document.getElementById("sync-icon");
  const syncStatusText = document.getElementById("sync-status-text");
  const preserveActionablePhase = beginPullProgress(this, {
    isBackground,
    syncIcon,
    syncStatusText,
  });
  const hasLocalDataForCurrentRoute = typeof this.hasLocalDataForRoute === "function"
    ? this.hasLocalDataForRoute(window.location.pathname)
    : typeof this.hasLocalWorkspaceData === "function"
      ? this.hasLocalWorkspaceData()
      : false;
  updatePullProgressLabel(syncStatusText, {
    preserveActionablePhase,
    isBackground,
    hasLocalDataForCurrentRoute,
  });
  const shouldShowFullLoader = !isBackground && !hasLocalDataForCurrentRoute
    && this.view && this.view.showLoader;
  if (shouldShowFullLoader) this.view.showLoader();
  try {
    const { useVersionDelta, since, query, visibilityToken } = readSyncCursor(storage, { forceFull });
    const queryParams = new URLSearchParams(query);
    const currentTab = typeof this.getTabNameForPath === "function"
      ? this.getTabNameForPath(window.location.pathname)
      : "";
    if (currentTab === "dashboard" || currentTab === "superadmin-dashboard") {
      queryParams.set("include_summary", "1");
    }
    if (routeOnly && typeof this.getSyncTableKeysForPath === "function") {
      const routeTables = this.getSyncTableKeysForPath(window.location.pathname);
      if (routeTables.length > 0) queryParams.set("tables", routeTables.join(","));
    }
    const requestHeaders = { "X-Active-Org": encodeURIComponent(workspace.organizationId) };
    let dbData = null;
    let response;
    if (useVersionDelta && !routeOnly) {
      const delta = await fetchDeltaSnapshot(apiFetch, {
        afterVersion: query.after_version,
        visibilityToken,
        headers: requestHeaders,
      });
      response = delta.response;
      dbData = delta.snapshot;
    } else {
      response = await apiFetch(`/api/get-all-data?${queryParams.toString()}`, {
        headers: requestHeaders,
      });
    }
    if (response.status === 409 && !forceFull) {
      let resyncPayload = null;
      try { resyncPayload = await response.clone().json(); } catch { resyncPayload = null; }
      if (["FULL_SYNC_REQUIRED", "SYNC_VISIBILITY_RESET_REQUIRED"].includes(resyncPayload?.code) || resyncPayload?.requiresFullSync) {
        storage.removeItem("bf_last_sync_version");
        storage.removeItem("bf_last_sync_timestamp");
        storage.removeItem("bf_visibility_token");
        return this.forceSyncData(isBackground, true, routeOnly);
      }
    }
    if (response.status === 401 || response.status === 403) {
      let errorMsg = "";
      try { errorMsg = (await response.clone().json())?.error || ""; } catch { errorMsg = ""; }
      const normalized = errorMsg.toLowerCase();
      const isAuthError = ["xác thực", "phiên", "đăng nhập", "tài khoản", "authentication", "session"]
        .some((term) => normalized.includes(term));
      if (isAuthError || isBackground) {
        updatePullFailureState(this, syncStatusText, {
          preserveActionablePhase,
          message: "Cần đăng nhập lại",
        });
        return { ok: false, status: response.status, error: errorMsg };
      }
    }
    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorPayload = await response.clone().json();
        errorDetail = errorPayload?.error || errorPayload?.message || "";
      } catch {
        try { errorDetail = (await response.clone().text()).trim(); } catch { errorDetail = ""; }
      }
      throw new Error(`Không thể đồng bộ dữ liệu: HTTP ${response.status}${errorDetail ? ` - ${errorDetail}` : ""}`);
    }
    dbData ||= await response.json();
    if (!pullIsCurrent()) {
      return { ok: false, stale: true, superseded: true };
    }
    const { changedKeys, deletionsByTable, persistencePromise } = applyServerSnapshot(
      this.model,
      dbData,
      { useVersionDelta, since },
    );
    await persistencePromise;
    this.model?.markStorageTablesRecovered?.(changedKeys);
    if (!pullIsCurrent()) {
      return { ok: false, stale: true, superseded: true };
    }
    this.model?.acknowledgeServerDeletions?.(deletionsByTable);
    const committedCursor = commitSyncCursor(storage, dbData);
    if (committedCursor.syncVersion !== null) {
      this.model?.rebaseMutationBatch?.(committedCursor.syncVersion);
    }
    await renderChangedState(this, changedKeys, { isBackground });
    if (!isBackground) {
      const cleanPath = window.location.pathname.startsWith("/")
        ? window.location.pathname.substring(1)
        : window.location.pathname;
      const parts = cleanPath.split("/").filter(Boolean);
      const detailTabs = ["goithau-detail", "kehoach-detail", "hopdong-detail", "chudautu-detail", "nhathau-detail"];
      if (detailTabs.some((tab) => this.routeMap[tab] === (parts[0] || "")) && parts[1]) {
        this.handlePathRouting(window.location.pathname, false, true);
      }
    }
    if (isBackground && typeof this.model?.hydrateRemainingStorageKeysIdle === "function") {
      this.model.hydrateRemainingStorageKeysIdle();
    }
    if (routeOnly && typeof this.scheduleBackgroundSync === "function") {
      this.scheduleBackgroundSync(900);
    }
    hideOfflineBanner();
    const localMutationsPending = finalizePulledSyncState(this);
    return { ok: true, data: dbData, localMutationsPending };
  } catch (error) {
    if (!pullIsCurrent()) {
      return { ok: false, stale: true, superseded: true };
    }
    console.error("Failed to sync data from server:", error);
    updatePullFailureState(this, syncStatusText, {
      preserveActionablePhase,
      message: "Lỗi đồng bộ",
    });
    const banner = document.getElementById("offline-indicator-banner");
    if (banner) {
      banner.hidden = false;
      banner.innerHTML = trustedHTML('<i data-lucide="alert-triangle"></i> Lỗi đồng bộ. Máy chủ không phản hồi.');
      if (window.lucide) window.lucide.createIcons({ root: banner });
      banner.classList.add("visible");
      setTimeout(() => {
        if (navigator.onLine) {
          banner.classList.remove("visible");
          banner.hidden = true;
        } else {
          banner.hidden = false;
          banner.innerHTML = trustedHTML('<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.');
          if (window.lucide) window.lucide.createIcons({ root: banner });
        }
      }, 5e3);
    }
    return { ok: false, error };
  } finally {
    if (pullIsCurrent()) {
      if (!preserveActionablePhase) syncIcon?.classList.remove("anim-spin");
      if (shouldShowFullLoader && this.view && this.view.hideLoader) this.view.hideLoader();
    }
  }
}

function pullFlightKey(workspace) {
  return String(workspace?.token || workspace?.organizationId || "");
}

export function forceSyncData(isBackground = false, forceFull = false, routeOnly = false) {
  const workspace = captureWorkspace(this);
  if (!workspace.organizationId) {
    return Promise.resolve({ ok: false, error: "No active workspace" });
  }
  const key = pullFlightKey(workspace);
  this._workspacePullFlights ||= new Map();
  let flights = this._workspacePullFlights.get(key);
  if (!flights) {
    flights = new Set();
    this._workspacePullFlights.set(key, flights);
  }

  const activePush = this._autoSyncPromise;
  const run = Promise.resolve(activePush)
    .catch(() => null)
    .then(() => {
      if (!workspaceIsCurrent(this, workspace)) {
        return { ok: false, stale: true, superseded: true };
      }
      return executeForceSyncData.call(this, isBackground, forceFull, routeOnly);
    });
  let tracked;
  tracked = run.finally(() => {
    flights.delete(tracked);
    if (flights.size === 0 && this._workspacePullFlights?.get(key) === flights) {
      this._workspacePullFlights.delete(key);
    }
  });
  flights.add(tracked);
  return tracked;
}
