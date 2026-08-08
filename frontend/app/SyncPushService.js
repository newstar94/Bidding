import { apiFetch } from "../shared/apiClient.js";
import {
  reportOutboxFailure,
  reportSyncConflict,
} from "../shared/releaseDiagnostics.js";
import {
  getSyncValidationErrors,
  resolveRowVersionConflicts,
} from "./ConflictResolver.js";
import {
  applyDashboardSummaryAfterMutation,
  collectCommittedMutationKeys,
  deleteSuccessMessage,
  mutationAffectsDashboard,
  renderChangedState,
  selectPostCommitRenderKeys,
} from "./SyncRenderCoordinator.js";
import {
  captureWorkspace,
  currentWorkspaceStorage,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";
import {
  hideOfflineBanner,
  showSyncErrorReport,
} from "./SyncPresenter.js";


function categorizeValidationErrors(errors) {
  const categorized = { missing: [], format: [], logic: [], duplicate: [] };
  errors.forEach((error) => {
    const message = error.message || "";
    if (message.includes("không được để trống")) categorized.missing.push(message);
    else if (message.includes("định dạng") || message.includes("không đúng")) categorized.format.push(message);
    else if (["phải sau", "phải bằng", "phải nằm", "không được nhỏ"].some((term) => message.includes(term))) categorized.logic.push(message);
    else if (message.includes("đã tồn tại")) categorized.duplicate.push(message);
    else categorized.format.push(message);
  });
  return categorized;
}

function logValidationErrors(errors, requestId) {
  const categorized = categorizeValidationErrors(errors);
  const lines = ["⚠️ Phát hiện lỗi dữ liệu, không thể đồng bộ:\n"];
  const sections = [
    ["missing", "❌ THIẾU THÔNG TIN BẮT BUỘC:"],
    ["format", "📋 SAI ĐỊNH DẠNG:"],
    ["logic", "⚡ SAI LOGIC NGHIỆP VỤ:"],
    ["duplicate", "🔁 DỮ LIỆU BỊ TRÙNG LẶP:"],
  ];
  sections.forEach(([key, title]) => {
    if (!categorized[key].length) return;
    lines.push(title);
    categorized[key].forEach((message) => lines.push(`  • ${message}`));
    lines.push("");
  });
  console.error(`[Sync Error]\n${lines.join("\n")}`, {
    requestId: requestId || null,
    errors,
  });
}

async function restoreRejectedRecords(controller, rejectedRecords) {
  const changedKeys = new Set();
  for (const rejected of rejectedRecords) {
    let serverRecord = null;
    try {
      serverRecord = await controller.fetchRecordByLookup(
        rejected.type,
        rejected.conflictingId || rejected.id,
      );
    } catch (error) {
      console.error("Failed to restore rejected server record:", error);
    }
    if (Array.isArray(controller.model.state[rejected.type]) && (!serverRecord || String(serverRecord.id) !== rejected.id)) {
      const records = controller.model.state[rejected.type];
      records.splice(0, records.length, ...records.filter(
        (item) => String(item.id) !== rejected.id
      ));
      await controller.model.db?.deleteRecord?.(rejected.type, rejected.id);
    }
    changedKeys.add(rejected.type);
  }
  if (changedKeys.size > 0) {
    await renderChangedState(controller, changedKeys, { isBackground: true });
  }
}

async function applySuccessfulPush(controller, {
  data,
  payload,
  snapshot,
  deferPostCommitRender,
  status,
}) {
  const storage = currentWorkspaceStorage(controller);
  if (data.timestamp) storage.setItem("bf_last_sync_timestamp", data.timestamp);
  if (data.syncVersion !== void 0 && data.syncVersion !== null) {
    storage.setItem("bf_last_sync_version", data.syncVersion.toString());
  }
  if (controller.model) controller.model.syncErrors = [];
  if (typeof controller.model?.clearCommittedMutationBatch === "function") {
    controller.model.clearCommittedMutationBatch(snapshot);
  } else {
    storage.removeItem("bf_local_deletions");
  }
  if (Array.isArray(data.rowVersions) && typeof controller.model?.applyCommittedRowVersions === "function") {
    await controller.model.applyCommittedRowVersions(data.rowVersions);
  }
  let orphanStateChanged = false;
  for (const orphan of Array.isArray(data.orphanedIds) ? data.orphanedIds : []) {
    const stateKey = {
      thong_tin_mo_thau: "thongtinmothau",
      phan_cong_nhan_su: "assignments",
    }[orphan.table] || orphan.table;
    if (!stateKey || !Array.isArray(controller.model.state[stateKey])) continue;
    const before = controller.model.state[stateKey].length;
    controller.model.state[stateKey] = controller.model.state[stateKey].filter(
      (item) => String(item.id) !== String(orphan.id)
    );
    if (controller.model.state[stateKey].length < before) {
      controller.model.persistData(stateKey, { trackMutation: false });
      orphanStateChanged = true;
    }
  }
  const committedKeys = collectCommittedMutationKeys(payload);
  if (applyDashboardSummaryAfterMutation(controller.model, payload, data)) {
    committedKeys.add("dashboardSummary");
    if (controller.view) controller.view._dashboardAggregateCache = null;
  }
  const deletedKeys = new Set(
    (payload.deletions || []).map((item) => item?.table).filter(Boolean)
  );
  deletedKeys.forEach((key) => {
    if (controller.model?.currentPage && Object.prototype.hasOwnProperty.call(controller.model.currentPage, key)) {
      controller.model.currentPage[key] = 1;
    }
  });
  const renderKeys = selectPostCommitRenderKeys(committedKeys, {
    hasDeletions: deletedKeys.size > 0,
    serverStateChanged: orphanStateChanged,
  });
  if (!deferPostCommitRender) await renderChangedState(controller, renderKeys);
  if (Array.isArray(data.deleteImpacts) && data.deleteImpacts.length > 0) {
    controller.view?.showToast?.(
      "Thành công",
      deleteSuccessMessage(payload, data.deleteImpacts),
      "success",
    );
  }
  controller._syncConflict = null;
  hideOfflineBanner();
  controller.updateSyncState({ phase: "serverSaved", online: true, lastSyncedAt: Date.now() });
  return { ok: true, status, data };
}

async function applyFailedPush(controller, { status, data, snapshot }) {
  const validationErrors = getSyncValidationErrors(data);
  if (status === 409 || data.status === "conflict") {
    void reportSyncConflict();
    const resolution = await resolveRowVersionConflicts(controller, { data, snapshot });
    if (resolution.resolved) {
      controller._syncConflict = null;
      controller.updateSyncState({ phase: "idle", online: true, lastSyncedAt: Date.now() });
      return { ok: true, status, data, resolvedConflict: resolution.choice };
    }
    controller._syncConflict = {
      serverSyncVersion: data.currentSyncVersion ?? null,
      message: data.message || data.error || "Server data changed before local sync."
    };
    controller.updateSyncState({ phase: "conflict" });
    if (data.currentSyncVersion !== void 0 && data.currentSyncVersion !== null) {
      currentWorkspaceStorage(controller).setItem(
        "bf_conflict_server_sync_version",
        String(data.currentSyncVersion),
      );
    }
    controller.view?.showToast?.(
      "Cảnh báo",
      "Dữ liệu đã thay đổi trong lúc bạn thao tác. Ứng dụng đang tải lại dữ liệu mới nhất; vui lòng kiểm tra và lưu lại.",
      "warning",
    );
    return { ok: false, status, data, conflict: true };
  }
  if (validationErrors.length > 0) {
    const rejected = typeof controller.model?.discardRejectedMutations === "function"
      ? controller.model.discardRejectedMutations(validationErrors, snapshot)
      : [];
    await restoreRejectedRecords(controller, rejected);
    logValidationErrors(validationErrors, data.requestId);
    showSyncErrorReport(controller, validationErrors, rejected.length);
  } else {
    console.error("[Sync Error]", data.error || data.message || "Đồng bộ thất bại");
    controller.view?.showToast?.("Thất bại", "Không thể lưu thay đổi. Vui lòng thử lại.", "error");
  }
  controller.updateSyncState({
    phase: validationErrors.length > 0 ? "validationRejected" : "error",
    message: validationErrors.length > 0
      ? `${validationErrors.length} lỗi dữ liệu · Nhấn để xem`
      : data.error || data.message || "Lỗi đồng bộ",
  });
  return { ok: false, status, data, validation: validationErrors.length > 0 };
}

export function autoSync() {
  const deferPostCommitRender = this._deferPostCommitRender === true;
  this._deferPostCommitRender = false;
  if (this._autoSyncPromise) {
    this._autoSyncQueued = true;
    return this._autoSyncPromise.then((result) => {
      if (!this._autoSyncQueued) return result;
      this._autoSyncQueued = false;
      return this.autoSync();
    });
  }
  const workspace = captureWorkspace(this);
  if (!workspace.organizationId) {
    return Promise.resolve({ ok: false, error: new Error("No active workspace") });
  }
  const mutationBatch = this.model?.buildMutationSyncPayload?.() || null;
  if (!mutationBatch) {
    this.updateSyncState({ phase: "idle" });
    return Promise.resolve({ ok: true, skipped: true });
  }
  const { payload, snapshot } = mutationBatch;
  this.updateSyncState({ phase: "syncing" });
  if (mutationAffectsDashboard(payload)) payload.includeDashboardSummary = true;
  const request = apiFetch("/api/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Active-Org": encodeURIComponent(workspace.organizationId),
    },
    body: JSON.stringify(payload),
  }).then((response) => response.json().then((data) => ({
    ok: response.ok,
    status: response.status,
    data,
  }))).then(async ({ ok, status, data }) => {
    if (!workspaceIsCurrent(this, workspace)) return { ok: false, stale: true, status, data };
    if (!ok || data.status === "error") {
      return applyFailedPush(this, { status, data, snapshot });
    }
    return applySuccessfulPush(this, {
      data,
      payload,
      snapshot,
      deferPostCommitRender,
      status,
    });
  }).catch((error) => {
    void reportOutboxFailure();
    console.error("Error auto sync:", error);
    this.updateSyncState({ phase: "transportError", message: "Không thể kết nối máy chủ" });
    return { ok: false, error };
  });
  const trackedRequest = request.finally(() => {
    if (this._autoSyncPromise === trackedRequest) this._autoSyncPromise = null;
  });
  this._autoSyncPromise = trackedRequest;
  return trackedRequest;
}
