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

function staleWorkspaceResult(extra = {}) {
  return {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
    ...extra,
  };
}

async function restoreRejectedRecords(controller, rejectedRecords, workspace) {
  const changedKeys = new Set();
  for (const rejected of rejectedRecords) {
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    let serverRecord = null;
    try {
      serverRecord = await controller.fetchRecordByLookup(
        rejected.type,
        rejected.conflictingId || rejected.id,
      );
    } catch (error) {
      console.error("Failed to restore rejected server record:", error);
    }
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    if (Array.isArray(controller.model.state[rejected.type]) && (!serverRecord || String(serverRecord.id) !== rejected.id)) {
      const records = controller.model.state[rejected.type];
      records.splice(0, records.length, ...records.filter(
        (item) => String(item.id) !== rejected.id
      ));
      await controller.model.db?.deleteRecord?.(rejected.type, rejected.id);
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
    }
    changedKeys.add(rejected.type);
  }
  if (changedKeys.size > 0) {
    await renderChangedState(controller, changedKeys, { isBackground: true });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult();
  }
  return { ok: true };
}

export async function applySuccessfulPush(controller, {
  data,
  payload,
  snapshot,
  deferPostCommitRender,
  status,
  workspace = captureWorkspace(controller),
}) {
  if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  const storage = workspace.storage || currentWorkspaceStorage(controller);
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
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
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
      await controller.model.persistData(stateKey, { trackMutation: false });
      if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
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
  if (!deferPostCommitRender) {
    await renderChangedState(controller, renderKeys);
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  }
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

export async function applyFailedPush(controller, {
  status,
  data,
  snapshot,
  workspace = captureWorkspace(controller),
}) {
  if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
  const validationErrors = getSyncValidationErrors(data);
  if (status === 409 && data?.code === "IDEMPOTENCY_KEY_REUSED") {
    const renewed = controller.model?.renewMutationBatchIdentity?.() === true;
    if (renewed) await controller.model?.flushMutationOutbox?.();
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    controller._syncConflict = null;
    controller.updateSyncState({
      phase: "localPending",
      online: true,
      message: "Đang làm mới yêu cầu đồng bộ · Thay đổi cục bộ vẫn được giữ lại",
    });
    controller.view?.showToast?.(
      "Đang khôi phục đồng bộ",
      "Ứng dụng đã giữ nguyên thay đổi cục bộ và đang đối chiếu lại dữ liệu máy chủ.",
      "warning",
    );
    return {
      ok: false,
      status,
      data,
      idempotencyKeyReused: true,
      retryable: renewed,
    };
  }
  const hasRowVersionConflict = validationErrors.some(
    (error) => error?.code === "ROW_VERSION_CONFLICT",
  );
  if (
    (status === 409 || data.status === "conflict")
    && hasRowVersionConflict
    && typeof controller.model?.quarantineMutationBatch === "function"
  ) {
    const recoveryDraft = await controller.model.quarantineMutationBatch({ data, snapshot });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    if (recoveryDraft?.id) {
      controller._syncConflict = null;
      controller.updateSyncState({
        phase: "recoveryPending",
        online: true,
        message: "Có bản nháp phục hồi cần xử lý",
      });
      controller.view?.showToast?.(
        "Đã giữ bản nháp phục hồi",
        "Dữ liệu máy chủ chưa bị thay đổi. Bạn có thể tiếp tục làm việc và áp lại bản nháp sau.",
        "warning",
      );
      return {
        ok: false,
        status,
        data,
        conflictQuarantined: true,
        recoveryDraftId: recoveryDraft.id,
      };
    }
  }
  if (status === 409 || data.status === "conflict") {
    void reportSyncConflict({
      workspaceKey: workspace.workspaceKey,
      correlationId: data.requestId,
    });
    const resolution = await resolveRowVersionConflicts(controller, { data, snapshot });
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
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
      (workspace.storage || currentWorkspaceStorage(controller)).setItem(
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
      ? controller.model.discardRejectedMutations(
        validationErrors,
        snapshot,
        { fallbackToBatch: true },
      )
      : [];
    await controller.model?.flushMutationOutbox?.();
    if (!workspaceIsCurrent(controller, workspace)) return staleWorkspaceResult({ status, data });
    const restoreResult = await restoreRejectedRecords(controller, rejected, workspace);
    if (restoreResult?.workspaceChanged || !workspaceIsCurrent(controller, workspace)) {
      return staleWorkspaceResult({ status, data });
    }
    logValidationErrors(validationErrors, data.requestId);
    showSyncErrorReport(controller, validationErrors, rejected.length);
  } else {
    console.error("[Sync Error]", data.error || data.message || "Đồng bộ thất bại");
    controller.view?.showToast?.("Thất bại", "Không thể lưu thay đổi. Vui lòng thử lại.", "error");
  }
  controller.updateSyncState({
    phase: validationErrors.length > 0
      ? "validationRejected"
      : "error",
    message: validationErrors.length > 0
      ? `${validationErrors.length} lỗi dữ liệu`
      : data.error || data.message || "Lỗi đồng bộ",
  });
  return { ok: false, status, data, validation: validationErrors.length > 0 };
}

export function autoSync(options = {}) {
  const workspace = captureWorkspace(this);
  const workspaceToken = String(workspace.token || workspace.organizationId || "");
  const deferPostCommitRender = this._deferPostCommitRender === true;
  this._deferPostCommitRender = false;
  if (options.startupReconciliation !== true) {
    const startupState = this.getStartupReconciliationState?.();
    if (startupState?.phase === "CONFLICT") {
      return Promise.resolve({
        ok: false,
        conflict: true,
        reconciliationRequired: true,
      });
    }
    if (startupState?.phase === "SYNC_ERROR") {
      return Promise.resolve({ ok: false, reconciliationRequired: true });
    }
    if (["LOCAL_READY", "RECONCILING"].includes(startupState?.phase)) {
      const barrier = startupState?.promise || this._startupReconciliationPromise;
      if (barrier) {
        return Promise.resolve(barrier).then(() => {
          if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
          const settledPhase = this.getStartupReconciliationState?.().phase;
          if (settledPhase === "RECONCILED") return this.autoSync(options);
          return {
            ok: false,
            conflict: settledPhase === "CONFLICT",
            reconciliationRequired: true,
          };
        });
      }
      return Promise.resolve({ ok: false, reconciliationRequired: true });
    }
  }
  const activeSync = this._autoSyncOwner;
  if (activeSync?.workspaceToken === workspaceToken && activeSync.promise) {
    activeSync.queued = true;
    this._autoSyncQueued = true;
    return activeSync.promise.then((result) => {
      if (!activeSync.queued || result?.ok !== true) {
        activeSync.queued = false;
        if (this._autoSyncOwner === activeSync) this._autoSyncQueued = false;
        return result;
      }
      activeSync.queued = false;
      if (this._autoSyncOwner === activeSync) this._autoSyncQueued = false;
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      return this.autoSync(options);
    });
  }
  const pullKey = String(workspace.token || workspace.organizationId || "");
  const activePulls = [...(this._workspacePullFlights?.get(pullKey) || [])];
  if (activePulls.length > 0) {
    return Promise.allSettled(activePulls).then(() => {
      if (!workspaceIsCurrent(this, workspace)) {
        return { ok: false, workspaceChanged: true, code: "WORKSPACE_CHANGED" };
      }
      return this.autoSync(options);
    });
  }
  const activeRepair = this._syncRepairOwner;
  if (activeRepair?.workspaceToken === workspaceToken && activeRepair.promise) {
    return activeRepair.promise;
  }
  if (!workspace.organizationId) {
    return Promise.resolve({ ok: false, error: new Error("No active workspace") });
  }
  const outboxStatus = this.model?.getMutationOutboxStatus?.();
  if (outboxStatus?.state === "pending" && typeof this.model?.flushMutationOutbox === "function") {
    return this.model.flushMutationOutbox().then(() => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      const settledStatus = this.model?.getMutationOutboxStatus?.();
      if (settledStatus?.trusted !== false) return this.autoSync();
      const error = Object.assign(new Error("Mutation outbox durability is pending"), {
        code: settledStatus?.code || "OUTBOX_DURABILITY_PENDING",
      });
      return { ok: false, error, storageDegraded: true };
    }).catch((error) => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      this.updateSyncState?.({
        phase: "storageError",
        message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
      });
      return { ok: false, error, storageDegraded: true };
    });
  }
  if (outboxStatus?.trusted === false) {
    const error = this.model?.getMutationOutboxFailure?.()
      || Object.assign(new Error("Mutation outbox durability is degraded"), {
        code: outboxStatus.code || "OUTBOX_DURABILITY_PENDING",
      });
    this.updateSyncState?.({
      phase: "storageError",
      message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
    });
    return Promise.resolve({ ok: false, error, storageDegraded: true });
  }
  if (
    options.skipDuplicatePlanRepair !== true
    && typeof this.model?.repairPendingDuplicatePlanVersions === "function"
  ) {
    const repair = this.model.repairPendingDuplicatePlanVersions();
    if (repair) {
      const repairOwner = { workspaceToken, promise: null };
      const trackedRepair = Promise.resolve(repair).then(() => {
        if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
        if (this._syncRepairOwner === repairOwner) {
          this._syncRepairOwner = null;
          if (this._syncRepairPromise === trackedRepair) this._syncRepairPromise = null;
        }
        if (deferPostCommitRender) this._deferPostCommitRender = true;
        return this.autoSync({ skipDuplicatePlanRepair: true });
      }).catch((error) => {
        if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
        this.updateSyncState?.({
          phase: "storageError",
          message: "Không thể sửa hàng đợi đồng bộ cục bộ",
        });
        return { ok: false, error, storageDegraded: true };
      }).finally(() => {
        if (this._syncRepairOwner === repairOwner) {
          this._syncRepairOwner = null;
          if (this._syncRepairPromise === trackedRepair) this._syncRepairPromise = null;
        }
      });
      repairOwner.promise = trackedRepair;
      this._syncRepairOwner = repairOwner;
      this._syncRepairPromise = trackedRepair;
      return trackedRepair;
    }
  }
  const mutationBatch = this.model?.buildMutationSyncPayload?.() || null;
  const preparedOutboxStatus = this.model?.getMutationOutboxStatus?.();
  if (preparedOutboxStatus?.state === "pending" && typeof this.model?.flushMutationOutbox === "function") {
    return this.model.flushMutationOutbox().then(() => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      return this.autoSync(options);
    }).catch((error) => {
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      this.updateSyncState?.({
        phase: "storageError",
        message: "Không thể xác nhận thay đổi cục bộ · Thử khôi phục bộ nhớ trước khi đồng bộ",
      });
      return { ok: false, error, storageDegraded: true };
    });
  }
  if (!mutationBatch) {
    const localMutationsPending = Boolean(this.model?.hasPendingMutationOutboxChanges?.());
    this.updateSyncState(localMutationsPending
      ? { phase: "localPending" }
      : { phase: "idle" });
    return Promise.resolve(localMutationsPending
      ? { ok: true, skipped: true, localMutationsPending: true }
      : { ok: true, skipped: true });
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
    if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult({ status, data });
    if (!ok || data.status === "error") {
      return applyFailedPush(this, { status, data, snapshot, workspace });
    }
    return applySuccessfulPush(this, {
      data,
      payload,
      snapshot,
      deferPostCommitRender,
      status,
      workspace,
    });
  }).catch((error) => {
    void reportOutboxFailure({
      workspaceKey: workspace.workspaceKey,
      correlationId: error?.requestId,
    });
    console.error("Automatic sync transport failed; structured diagnostic submitted.");
    if (!workspaceIsCurrent(this, workspace)) {
      return staleWorkspaceResult({ error });
    }
    this.updateSyncState({ phase: "transportError", message: "Không thể kết nối máy chủ" });
    return { ok: false, error };
  });
  const syncOwner = { workspaceToken, promise: null, queued: false };
  const trackedRequest = request.finally(() => {
    if (this._autoSyncOwner === syncOwner) {
      this._autoSyncOwner = null;
      this._autoSyncQueued = false;
    }
  });
  let completion;
  completion = trackedRequest.then(async (result) => {
    if (
      result?.conflictQuarantined === true
      && options.startupReconciliation !== true
      && typeof this.forceSyncData === "function"
      && workspaceIsCurrent(this, workspace)
    ) {
      const pullResult = await this.forceSyncData(false, true);
      if (!workspaceIsCurrent(this, workspace)) return staleWorkspaceResult();
      return {
        ...result,
        authoritativeRefresh: pullResult?.ok === true,
        refreshResult: pullResult,
      };
    }
    return result;
  }).finally(() => {
    if (this._autoSyncPromise === completion) this._autoSyncPromise = null;
  });
  syncOwner.promise = completion;
  this._autoSyncOwner = syncOwner;
  this._autoSyncPromise = completion;
  return completion;
}
