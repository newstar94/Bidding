import { applySyncPayload } from "./syncMergeUtils.js";
import { APP_DEBUG } from "./appConfig.js";
export function collectCommittedMutationKeys(payload = {}) {
  return new Set([
    ...Object.keys(payload.upserts || {}),
    ...(payload.deletions || []).map((item) => item?.table).filter(Boolean)
  ]);
}
const DASHBOARD_SUMMARY_KEYS = new Set([
  "kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "assignments"
]);
const NON_RETRYABLE_WEBSOCKET_CLOSE_CODES = new Set([1000, 4001, 4003, 4401, 4403]);
export function shouldReconnectWebSocket(closeCode) {
  return !NON_RETRYABLE_WEBSOCKET_CLOSE_CODES.has(Number(closeCode));
}
export function mutationAffectsDashboard(payload = {}) {
  return [...collectCommittedMutationKeys(payload)].some((key) => DASHBOARD_SUMMARY_KEYS.has(key));
}
export function applyDashboardSummaryAfterMutation(model, payload = {}, responseData = {}) {
  if (!model || !mutationAffectsDashboard(payload)) return false;
  model.dashboardSummary = responseData.dashboardSummary && responseData.dashboardSummary.counts
    ? responseData.dashboardSummary
    : null;
  return true;
}
export function scheduleBackgroundSync(delay = 500) {
  if (this._backgroundSyncTimer) {
    this._backgroundSyncQueued = true;
    return;
  }
  this._backgroundSyncTimer = setTimeout(async () => {
    this._backgroundSyncTimer = null;
    if (this._backgroundSyncRunning) {
      this._backgroundSyncQueued = true;
      return;
    }
    this._backgroundSyncRunning = true;
    try {
      await this.forceSyncData(true);
    } catch (err) {
      console.error("Background sync failed:", err);
    } finally {
      this._backgroundSyncRunning = false;
      if (this._backgroundSyncQueued) {
        this._backgroundSyncQueued = false;
        this.scheduleBackgroundSync(delay);
      }
    }
  }, delay);
}
export function setupAutoSyncBackground() {
  const checkAndSync = () => {
    this.scheduleBackgroundSync(500);
  };
  window.addEventListener("focus", checkAndSync);
  this.setupWebSocketConnection();
}
function renderChangedState(controller, changedKeys, { isBackground = false } = {}) {
  if (!changedKeys || changedKeys.size === 0 || !controller.view) return Promise.resolve();
  const renderPromises = [];
  const renderIfChanged = (keys, renderFn, requiredElementId = null) => {
    if (keys.some((key) => changedKeys.has(key)) && typeof renderFn === "function" && (!requiredElementId || document.getElementById(requiredElementId))) {
      const renderPromise = Promise.resolve(renderFn.call(controller.view)).catch((err) => {
        console.error(`Failed to render changed state${requiredElementId ? ` for ${requiredElementId}` : ""}:`, err);
      });
      renderPromises.push(renderPromise);
    }
  };
  renderIfChanged(["dashboardSummary", "kehoach", "goithau", "chudautu", "nhathau", "chuyengia", "hopdong", "assignments", "thongtinmothau"], controller.view.renderDashboard, "tab-dashboard");
  renderIfChanged(["kehoach", "chudautu", "goithau"], controller.view.renderKeHoachTable, "tab-kehoach");
  renderIfChanged(["goithau", "kehoach", "chudautu", "nhathau", "thongtinmothau", "assignments"], controller.view.renderGoiThauTable, "tab-goithau");
  renderIfChanged(["chudautu", "kehoach"], controller.view.renderChuDauTuTable, "tab-chudautu");
  renderIfChanged(["nhathau", "goithau", "hopdong", "thongtinmothau"], controller.view.renderNhaThauTable, "tab-nhathau");
  renderIfChanged(["chuyengia", "assignments"], controller.view.renderChuyenGiaTable, "tab-chuyengia");
  renderIfChanged(["hopdong", "goithau", "nhathau", "chudautu"], controller.view.renderHopDongTable, "tab-hopdong");
  if (isBackground && typeof controller.handlePathRouting === "function") {
    requestAnimationFrame(() => {
      controller.handlePathRouting(window.location.pathname, false, true);
    });
  }
  return Promise.all(renderPromises);
}
function showSyncErrorReport(controller, errors) {
  if (!controller || !Array.isArray(errors) || errors.length === 0) return;
  if (controller.model) {
    controller.model.syncErrors = errors;
  }
  if (controller.view && typeof controller.view.showToast === "function") {
    controller.view.showToast(
      "Lỗi đồng bộ",
      `${errors.length} bản ghi chưa hợp lệ. Bấm để xem chi tiết trong hộp thoại.`,
      "error",
      {
        actionLabel: "Xem lỗi",
        onAction: () => {
          if (controller.view && typeof controller.view.customAlert === "function") {
            const detailLines = errors.slice(0, 20).map((err, index) => {
              const table = err.table || "unknown";
              const id = err.id || "";
              const message = err.message || String(err);
              return `${index + 1}. [${table}${id ? `/${id}` : ""}] ${message}`;
            });
            const more = errors.length > 20 ? `
... và ${errors.length - 20} lỗi khác.` : "";
            controller.view.customAlert("Lỗi đồng bộ dữ liệu", detailLines.join("\n") + more, "alert-triangle");
          }
        }
      }
    );
  }
}
const DETAIL_ROUTE_TABLE = {
  "goithau-detail": "goithau",
  "kehoach-detail": "kehoach",
  "hopdong-detail": "hopdong",
  "chudautu-detail": "chudautu",
  "nhathau-detail": "nhathau"
};
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
    return hasMeaningfulValue(item.ownerId) || (completenessFields[tableKey] || []).some((field) => hasMeaningfulValue(item[field]));
  });
}
export async function fetchRecordByLookup(tableKey, lookup) {
  if (!tableKey || !lookup) return null;
  const response = await fetch(`/api/record?table=${encodeURIComponent(tableKey)}&lookup=${encodeURIComponent(lookup)}`, {
    headers: {
      "X-Active-Org": encodeURIComponent(localStorage.getItem("bf_active_org") || "")
    }
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data || !data.item) return null;
  const normalized = typeof this.model.normalizeRecordKeys === "function" ? this.model.normalizeRecordKeys(data.item, tableKey) : data.item;
  const record = { ...normalized, referenceOnly: false };
  if (!Array.isArray(this.model.state[tableKey])) {
    this.model.state[tableKey] = [];
  }
  const idx = this.model.state[tableKey].findIndex((item) => String(item.id) === String(record.id));
  if (idx >= 0) {
    this.model.state[tableKey][idx] = record;
  } else {
    this.model.state[tableKey].push(record);
  }
  if (this.model.db && typeof this.model.db.putRecord === "function") {
    await this.model.db.putRecord(tableKey, record);
  } else if (typeof this.model.persistData === "function") {
    await this.model.persistData(tableKey, { trackMutation: false });
  }
  return record;
}
export function ensureDetailRecordLoaded(tabName, action) {
  const tableKey = DETAIL_ROUTE_TABLE[tabName];
  if (!tableKey || !action || !this.model?.useServerSidePagination) return null;
  if (detailRecordExists(this.model, tableKey, action)) return null;
  const pendingKey = `${tableKey}:${action}`;
  this._pendingDetailRecordLoads = this._pendingDetailRecordLoads || /* @__PURE__ */ new Map();
  if (this._pendingDetailRecordLoads.has(pendingKey)) {
    return this._pendingDetailRecordLoads.get(pendingKey);
  }
  const promise = this.fetchRecordByLookup(tableKey, action).catch((err) => {
    console.error("Failed to fetch detail record:", err);
    return null;
  }).finally(() => {
    this._pendingDetailRecordLoads.delete(pendingKey);
  });
  this._pendingDetailRecordLoads.set(pendingKey, promise);
  return promise;
}
export function autoSync() {
  const mutationBatch = this.model && typeof this.model.buildMutationSyncPayload === "function" ? this.model.buildMutationSyncPayload() : null;
  if (!mutationBatch) {
    return Promise.resolve({ ok: true, skipped: true });
  }
  const { payload, snapshot } = mutationBatch;
  const shouldRefreshDashboardSummary = mutationAffectsDashboard(payload);
  if (shouldRefreshDashboardSummary) {
    payload.includeDashboardSummary = true;
  }
  return fetch("/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Active-Org": encodeURIComponent(localStorage.getItem("bf_active_org") || "")
    },
    body: JSON.stringify(payload)
  }).then((res) => {
    return res.json().then((data) => ({ ok: res.ok, status: res.status, data }));
  }).then(async ({ ok, status, data }) => {
    if (!ok || data.status === "error") {
      if (status === 409 || data.status === "conflict") {
        console.warn("[Sync Conflict]", data.message || data.error || "Server data changed before local sync.");
        if (data.currentSyncVersion !== void 0 && data.currentSyncVersion !== null) {
          localStorage.setItem("bf_conflict_server_sync_version", String(data.currentSyncVersion));
        }
        if (this.view && typeof this.view.showToast === "function") {
          this.view.showToast(
            "Xung đột đồng bộ",
            "Dữ liệu trên máy chủ đã thay đổi. Tải lại dữ liệu mới trước khi đồng bộ tiếp.",
            "warning",
            {
              actionLabel: "Tải lại",
              onAction: () => this.forceSyncData(false, true).catch((err) => console.error("Failed manual conflict refresh:", err))
            }
          );
        }
        if (typeof this.forceSyncData === "function") {
          this.forceSyncData(true).catch((err) => console.error("Failed to refresh after sync conflict:", err));
        }
        return { ok: false, status, data, conflict: true };
      }
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        const rejectedRecords = typeof this.model?.discardRejectedMutations === "function" ? this.model.discardRejectedMutations(data.errors) : [];
        const changedKeys = new Set();
        for (const rejected of rejectedRecords) {
          let serverRecord = null;
          try {
            serverRecord = await this.fetchRecordByLookup(rejected.type, rejected.conflictingId || rejected.id);
          } catch (error) {
            console.error("Failed to restore rejected record from SQLite:", error);
          }
          if (Array.isArray(this.model.state[rejected.type]) && (!serverRecord || String(serverRecord.id) !== rejected.id)) {
            this.model.state[rejected.type] = this.model.state[rejected.type].filter(
              (item) => String(item.id) !== rejected.id
            );
            await this.model.db?.deleteRecord?.(rejected.type, rejected.id);
          }
          changedKeys.add(rejected.type);
        }
        if (changedKeys.size > 0) {
          renderChangedState(this, changedKeys, { isBackground: true });
        }
        const categorized = {
          missing: [],
          format: [],
          logic: [],
          duplicate: []
        };
        data.errors.forEach((err) => {
          const msg = err.message || "";
          if (msg.includes("không được để trống")) {
            categorized.missing.push(msg);
          } else if (msg.includes("định dạng") || msg.includes("không đúng")) {
            categorized.format.push(msg);
          } else if (msg.includes("phải sau") || msg.includes("phải bằng") || msg.includes("phải nằm") || msg.includes("không được nhỏ")) {
            categorized.logic.push(msg);
          } else if (msg.includes("đã tồn tại")) {
            categorized.duplicate.push(msg);
          } else {
            categorized.format.push(msg);
          }
        });
        let msgLines = ["⚠️ Phát hiện lỗi dữ liệu, không thể đồng bộ:\n"];
        if (categorized.missing.length > 0) {
          msgLines.push("❌ THIẾU THÔNG TIN BẮT BUỘC:");
          categorized.missing.forEach((m) => msgLines.push("  • " + m));
          msgLines.push("");
        }
        if (categorized.format.length > 0) {
          msgLines.push("📋 SAI ĐỊNH DẠNG:");
          categorized.format.forEach((m) => msgLines.push("  • " + m));
          msgLines.push("");
        }
        if (categorized.logic.length > 0) {
          msgLines.push("⚡ SAI LOGIC NGHIỆP VỤ:");
          categorized.logic.forEach((m) => msgLines.push("  • " + m));
          msgLines.push("");
        }
        if (categorized.duplicate.length > 0) {
          msgLines.push("🔁 DỮ LIỆU BỊ TRÙNG LẶP:");
          categorized.duplicate.forEach((m) => msgLines.push("  • " + m));
        }
        const fullMsg = msgLines.join("\n");
        console.error("[Sync Error]\n" + fullMsg, data.errors);
        showSyncErrorReport(this, data.errors);
      } else {
        console.error("[Sync Error]", data.error || data.message || "Đồng bộ thất bại");
        if (this.view && typeof this.view.showToast === "function") {
          this.view.showToast("Lỗi đồng bộ", data.error || data.message || "Đồng bộ thất bại", "error");
        }
      }
      return { ok: false, status, data, validation: Array.isArray(data.errors) && data.errors.length > 0 };
    }
    if (data.timestamp) {
      localStorage.setItem("bf_last_sync_timestamp", data.timestamp);
    }
    if (data.syncVersion !== void 0 && data.syncVersion !== null) {
      localStorage.setItem("bf_last_sync_version", data.syncVersion.toString());
    }
    if (this.model && typeof this.model.clearSyncedMutationQueue === "function") {
      this.model.clearSyncedMutationQueue(snapshot);
    } else {
      localStorage.removeItem("bf_local_deletions");
    }
    if (Array.isArray(data.orphanedIds) && data.orphanedIds.length > 0) {
      let stateChanged = false;
      for (const orphan of data.orphanedIds) {
        const { table, id } = orphan;
        const tableToStateKey = {
          "thong_tin_mo_thau": "thongtinmothau",
          "phan_cong_nhan_su": "assignments"
        };
        const stateKey = tableToStateKey.hasOwnProperty(table) ? tableToStateKey[table] : table;
        if (stateKey && Array.isArray(this.model.state[stateKey])) {
          const before = this.model.state[stateKey].length;
          this.model.state[stateKey] = this.model.state[stateKey].filter((item) => String(item.id) !== String(id));
          if (this.model.state[stateKey].length < before) {
            this.model.persistData(stateKey, { trackMutation: false });
            stateChanged = true;
          }
        }
      }
      if (stateChanged) {
        console.info(`[Sync] Đã xóa ${data.orphanedIds.length} record mồ côi khỏi IndexedDB:`, data.orphanedIds);
      }
    }
    const committedKeys = collectCommittedMutationKeys(payload);
    if (applyDashboardSummaryAfterMutation(this.model, payload, data)) {
      committedKeys.add("dashboardSummary");
      if (this.view) this.view._dashboardAggregateCache = null;
    }
    const deletedKeys = new Set((payload.deletions || []).map((item) => item?.table).filter(Boolean));
    deletedKeys.forEach((key) => {
      if (this.model?.currentPage && Object.prototype.hasOwnProperty.call(this.model.currentPage, key)) {
        this.model.currentPage[key] = 1;
      }
    });
    await renderChangedState(this, committedKeys);
    return { ok: true, status, data };
  }).catch((err) => {
    console.error("Error auto sync:", err);
    return { ok: false, error: err };
  });
}
export async function forceSyncData(isBackground = false, forceFull = false, routeOnly = false) {
  const syncBtn = document.getElementById("btn-force-sync");
  const syncIcon = document.getElementById("sync-icon");
  const syncStatusText = document.getElementById("sync-status-text");
  if (syncIcon) syncIcon.classList.add("anim-spin");
  if (syncStatusText) syncStatusText.textContent = "Đang đồng bộ...";
  const hasLocalDataForCurrentRoute = typeof this.hasLocalDataForRoute === "function" ? this.hasLocalDataForRoute(window.location.pathname) : typeof this.hasLocalWorkspaceData === "function" ? this.hasLocalWorkspaceData() : false;
  if (syncStatusText) {
    syncStatusText.textContent = !isBackground && !hasLocalDataForCurrentRoute ? "Đang tải dữ liệu lần đầu..." : "Đang đồng bộ...";
  }
  const shouldShowFullLoader = !isBackground && !hasLocalDataForCurrentRoute && this.view && this.view.showLoader;
  if (shouldShowFullLoader) this.view.showLoader();
  try {
    const lastSyncVersion = localStorage.getItem("bf_last_sync_version");
    const useVersionDelta = !forceFull && lastSyncVersion !== null && lastSyncVersion !== "";
    const since = forceFull ? "0" : localStorage.getItem("bf_last_sync_timestamp") || "0";
    const queryParams = new URLSearchParams(useVersionDelta ? { after_version: lastSyncVersion } : { since });
    const currentTab = typeof this.getTabNameForPath === "function" ? this.getTabNameForPath(window.location.pathname) : "";
    if (currentTab === "dashboard" || currentTab === "superadmin-dashboard") {
      queryParams.set("include_summary", "1");
    }
    if (routeOnly && typeof this.getSyncTableKeysForPath === "function") {
      const routeTables = this.getSyncTableKeysForPath(window.location.pathname);
      if (routeTables.length > 0) queryParams.set("tables", routeTables.join(","));
    }
    const syncQuery = queryParams.toString();
    const response = await fetch("/api/get-all-data?" + syncQuery, {
      headers: {
        "X-Active-Org": encodeURIComponent(localStorage.getItem("bf_active_org") || "")
      }
    });
    if (response.status === 401 || response.status === 403) {
      let errorMsg = "";
      try {
        const data = await response.clone().json();
        errorMsg = data?.error || "";
      } catch (e) {
        errorMsg = "";
      }
      const normalizedMsg = errorMsg.toLowerCase();
      const isAuthError = normalizedMsg.includes("xác thực") || normalizedMsg.includes("phiên") || normalizedMsg.includes("đăng nhập") || normalizedMsg.includes("tài khoản") || normalizedMsg.includes("authentication") || normalizedMsg.includes("session");
      if (isAuthError || isBackground) {
        if (syncStatusText) syncStatusText.textContent = "Cần đăng nhập lại";
        return { ok: false, status: response.status, error: errorMsg };
      }
    }
    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorPayload = await response.clone().json();
        errorDetail = errorPayload?.error || errorPayload?.message || "";
      } catch (e) {
        try {
          errorDetail = (await response.clone().text()).trim();
        } catch (textError) {
          errorDetail = "";
        }
      }
      const detailSuffix = errorDetail ? ` - ${errorDetail}` : "";
      throw new Error(`Không thể đồng bộ dữ liệu: HTTP ${response.status}${detailSuffix}`);
    }
    if (response.ok) {
      const dbData = await response.json();
      const { changedKeys, persistencePromise } = applySyncPayload(this.model, dbData, { useVersionDelta, since });
      await persistencePromise;
      if (!dbData.partial && dbData.syncVersion !== void 0 && dbData.syncVersion !== null) {
        localStorage.setItem("bf_last_sync_version", dbData.syncVersion.toString());
        this.model?.rebasePendingMutationQueue?.(dbData.syncVersion);
      }
      if (!dbData.partial && dbData.timestamp) {
        localStorage.setItem("bf_last_sync_timestamp", dbData.timestamp.toString());
      }
      localStorage.setItem("bf_last_fetch_time", Date.now().toString());
      await renderChangedState(this, changedKeys, { isBackground });
      this.updateSyncStatusDisplay(Date.now());
      if (!isBackground) {
        const cleanPath = window.location.pathname.startsWith("/") ? window.location.pathname.substring(1) : window.location.pathname;
        const parts = cleanPath.split("/").filter(Boolean);
        const urlTab = parts[0] || "";
        const detailTabs = ["goithau-detail", "kehoach-detail", "hopdong-detail", "chudautu-detail", "nhathau-detail"];
        const isDetailTab = detailTabs.some((t) => this.routeMap[t] === urlTab);
        if (isDetailTab && parts[1]) {
          this.handlePathRouting(window.location.pathname, false, true);
        }
      }
      if (isBackground && this.model && typeof this.model.hydrateRemainingStorageKeysIdle === "function") {
        this.model.hydrateRemainingStorageKeysIdle();
      }
      if (routeOnly && typeof this.scheduleBackgroundSync === "function") {
        this.scheduleBackgroundSync(900);
      }
    }
  } catch (err) {
    console.error("Failed to sync data from SQLite:", err);
    if (syncStatusText) syncStatusText.textContent = "Lỗi đồng bộ";
    const banner = document.getElementById("offline-indicator-banner");
    if (banner) {
      banner.innerHTML = `<i data-lucide="alert-triangle"></i> Lỗi đồng bộ. Máy chủ không phản hồi.`;
      if (window.lucide) {
        window.lucide.createIcons({ root: banner });
      }
      banner.classList.add("visible");
      setTimeout(() => {
        if (navigator.onLine) {
          banner.classList.remove("visible");
        } else {
          banner.innerHTML = `<i data-lucide="wifi-off"></i> Mất kết nối internet. Bạn đang làm việc offline.`;
          if (window.lucide) {
            window.lucide.createIcons({ root: banner });
          }
        }
      }, 5e3);
    }
  } finally {
    if (syncIcon) syncIcon.classList.remove("anim-spin");
    if (shouldShowFullLoader && this.view && this.view.hideLoader) this.view.hideLoader();
  }
}
export function updateSyncStatusDisplay(timestamp) {
  const syncStatusText = document.getElementById("sync-status-text");
  if (!syncStatusText) return;
  const timeStr = new Date(timestamp).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  syncStatusText.textContent = `Đồng bộ (${timeStr})`;
}
export function setupWebSocketConnection() {
  if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  if (this._wsReconnectTimer) {
    clearTimeout(this._wsReconnectTimer);
    this._wsReconnectTimer = null;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/sync`;
  const debug = APP_DEBUG;
  if (debug) console.log("Connecting to WebSocket sync server:", wsUrl);
  const ws = new WebSocket(wsUrl);
  this.ws = ws;
  ws.onopen = () => {
    if (debug) console.log("WebSocket connection established. Sending auth...");
    this._wsRetryDelay = 5e3;
    ws.send(JSON.stringify({
      action: "auth"
    }));
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "ping") {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "pong" }));
        }
        return;
      }
      if (msg.event === "db_changed") {
        if (debug) console.log("Database changed event received from WebSocket. Triggering Delta Sync...");
        this.scheduleBackgroundSync(300);
      }
    } catch (e) {
      console.error("Error handling WebSocket message:", e);
    }
  };
  ws.onclose = (event) => {
    if (this.ws === ws) {
      this.ws = null;
    }
    if (!shouldReconnectWebSocket(event.code)) {
      if (this._wsReconnectTimer) {
        clearTimeout(this._wsReconnectTimer);
        this._wsReconnectTimer = null;
      }
      this._wsRetryDelay = 5e3;
      if (debug) {
        console.warn(`WebSocket connection closed permanently for this session (code: ${event.code || "unknown"}). A new login is required before reconnecting.`);
      }
      return;
    }
    const currentDelay = this._wsRetryDelay || 5e3;
    const nextDelay = Math.min(6e4, Math.round(currentDelay * 1.5));
    this._wsRetryDelay = nextDelay;
    if (debug) console.log(`WebSocket connection closed (code: ${event.code || "unknown"}, reason: ${event.reason || "none"}). Reconnecting in ${Math.round(nextDelay / 1e3)}s...`);
    if (this._wsReconnectTimer) {
      clearTimeout(this._wsReconnectTimer);
    }
    this._wsReconnectTimer = setTimeout(() => {
      this._wsReconnectTimer = null;
      this.setupWebSocketConnection();
    }, nextDelay);
  };
  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    ws.close();
  };
}
