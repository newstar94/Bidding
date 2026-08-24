import {
  captureWorkspace,
  currentWorkspaceStorage,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";
import { showSyncErrorDetails } from "./SyncPresenter.js";
import { openConflictCenter } from "./ConflictCenter.js";


const ACTIONABLE_PENDING_PHASES = new Set([
  "conflict",
  "error",
  "storageError",
  "transportError",
  "validationRejected",
]);

function isSyncConflict(result) {
  if (result?.conflictQuarantined || result?.idempotencyKeyReused) return false;
  return Boolean(result?.conflict || result?.status === 409);
}

function syncWorkspaceIsCurrent(controller, workspace) {
  if (!workspace?.token && !workspace?.organizationId) return true;
  return workspaceIsCurrent(controller, workspace);
}

function workspaceChangedResult() {
  return { ok: false, stale: true, workspaceChanged: true, code: "WORKSPACE_CHANGED" };
}

async function resolveConflictRecoveryDraft(
  controller,
  workspace = captureWorkspace(controller),
) {
  const draft = controller.model?.getConflictRecoveryDrafts?.()[0] || null;
  if (!draft) return null;
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  controller.view?.showToast?.(
    "Dữ liệu đã thay đổi trên máy chủ",
    "Mở Trung tâm xung đột để xem và xác nhận từng thay đổi.",
    "warning",
  );
  return { ok: false, conflict: true, reloadRequired: true, recoveryDraftId: draft.id };
}

export async function resolvePendingSyncConflict(
  controller,
  initialResult,
  workspace = captureWorkspace(controller),
) {
  if (!controller || !isSyncConflict(initialResult)) return initialResult;
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  controller.view?.showToast?.(
    "Dữ liệu đã thay đổi trên máy chủ",
    "Mở Trung tâm xung đột để xem và xác nhận từng thay đổi.",
    "warning",
  );
  return { ...initialResult, conflictCleared: false, reloadRequired: true };
}

export function shouldShowLocalPending(currentPhase) {
  return !ACTIONABLE_PENDING_PHASES.has(String(currentPhase || ""));
}

/** @internal Diagnostic/test projection of sync activity state. */
export function getSyncActivitySnapshot(controller) {
  const outboxStatus = controller?.model?.getMutationOutboxStatus?.() || {};
  const sendableMutation = controller?.model?.buildMutationSyncPayload?.() || null;
  const hasRawPendingMutation = Boolean(
    controller?.model?.hasPendingMutationOutboxChanges?.(),
  );
  const hasPendingMutations = Number(controller?._pendingMutationCount || 0) > 0
    || hasRawPendingMutation
    || Boolean(sendableMutation);
  const hasTemporarilyUnsendableMutation = hasRawPendingMutation && !sendableMutation;
  const hasActivePull = [...(controller?._workspacePullFlights?.values?.() || [])]
    .some((flights) => Number(flights?.size || 0) > 0);
  return {
    settled: !controller?._autoSyncPromise
      && !controller?._manualSyncPromise
      && !controller?._startupReconciliationPromise
      && !controller?._syncImmediateTimer
      && !controller?._autoSyncQueued
      && !controller?._deferImmediateSync
      && !controller?._backgroundSyncRunning
      && !hasActivePull
      && Number(controller?.model?._workspaceMutations?.size || 0) === 0
      && outboxStatus.state !== "pending"
      && !hasTemporarilyUnsendableMutation,
    phase: String(controller?._syncUxState?.phase || "idle"),
    hasPendingMutations,
  };
}

export function runManualSyncRetry(controller) {
  if (!controller) return Promise.resolve({ ok: false });
  const workspace = captureWorkspace(controller);
  const workspaceToken = String(workspace.token || workspace.organizationId || "");
  const activeRetry = controller._manualSyncOwner;
  if (activeRetry?.workspaceToken === workspaceToken && activeRetry.promise) {
    return activeRetry.promise;
  }
  const run = (async () => {
    if (Array.isArray(controller.model?.syncErrors) && controller.model.syncErrors.length > 0) {
      showSyncErrorDetails(controller, controller.model.syncErrors);
      return { ok: false, validation: true };
    }
    if (controller.model?.hasMutationOutboxDurabilityFailure?.()) {
      try {
        await controller.model.recoverMutationOutbox?.();
      } catch (error) {
        console.error("Mutation outbox recovery failed:", error);
      }
      if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
      if (controller.model.hasMutationOutboxDurabilityFailure()) {
        controller.updateSyncState({
          phase: "storageError",
          message: "Chưa thể khôi phục thay đổi cục bộ · Vui lòng thử lại",
        });
        return { ok: false, storageDegraded: true };
      }
    }
    if (controller.model?.hasStorageReadFailures?.()) {
      const refreshed = await controller.forceSyncData(false, true);
      if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
      return refreshed;
    }
    const startupPhase = controller.getStartupReconciliationState?.().phase;
    if (startupPhase === "CONFLICT") {
      return resolvePendingSyncConflict(controller, {
        ok: false,
        conflict: true,
        status: 409,
        reconciliationRequired: true,
      }, workspace);
    }
    if (startupPhase && startupPhase !== "RECONCILED") {
      const reconciled = await controller.reconcileInitialRouteData?.();
      if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
      if (reconciled) return { ok: true, reconciled: true };
      if (controller.getStartupReconciliationState?.().phase === "OFFLINE_LOCAL") {
        return { ok: false, offline: true };
      }
      return { ok: false, reconciliationRequired: true };
    }
    const hasActiveMutations = Boolean(
      controller.model?.hasPendingMutationOutboxChanges?.()
      || controller.model?.buildMutationSyncPayload?.(),
    );
    if (Number(controller.model?.getConflictRecoveryCount?.() || 0) > 0 && !hasActiveMutations) {
      return resolveConflictRecoveryDraft(controller, workspace);
    }
    const pushed = await controller.autoSync();
    if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
    if (pushed?.ok) {
      const verified = await controller.forceSyncData(false, false);
      if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
      return verified;
    }
    if (isSyncConflict(pushed)) return resolvePendingSyncConflict(controller, pushed, workspace);
    return pushed;
  })();
  const retryOwner = { workspaceToken, promise: null };
  const tracked = run.finally(() => {
    if (controller._manualSyncOwner === retryOwner) {
      controller._manualSyncOwner = null;
      if (controller._manualSyncPromise === tracked) controller._manualSyncPromise = null;
    }
  });
  retryOwner.promise = tracked;
  controller._manualSyncOwner = retryOwner;
  controller._manualSyncPromise = tracked;
  return tracked;
}


export function setupSyncUx() {
  if (this._syncUxInstalled) return;
  this._syncUxInstalled = true;
  const button = document.getElementById("btn-force-sync");
  button?.addEventListener("click", () => {
    if (Number(this.model?.getConflictRecoveryCount?.() || 0) > 0) {
      void openConflictCenter(this);
      return;
    }
    void runManualSyncRetry(this);
  });
  this.model.onMutationBatchChanged = ({ pendingCount }) => {
    this._pendingMutationCount = Math.max(0, Number(pendingCount) || 0);
    if (pendingCount && shouldShowLocalPending(this._syncUxState?.phase)) {
      this.updateSyncState({ phase: "localPending" });
    }
    if (!pendingCount || this._syncImmediateTimer || this._deferImmediateSync) return;
    const scheduledWorkspaceToken = this.model?.getWorkspaceToken?.() || "";
    this._syncImmediateTimer = setTimeout(() => {
      this._syncImmediateTimer = null;
      if (scheduledWorkspaceToken
        && this.model?.isWorkspaceCurrent?.(scheduledWorkspaceToken) === false) return;
      void this.autoSync();
    }, 80);
  };
  this._removeStorageHydrationListener = this.model.addStorageHydrationListener?.((event) => {
    if (event.state === "failed") {
      this.updateSyncState({
        phase: "storageError",
        message: "Không thể đọc dữ liệu cục bộ · Nhấn để tải lại từ máy chủ",
      });
      return;
    }
    if (event.recovered && !this.model.hasStorageReadFailures?.()) {
      this.updateSyncState({ phase: "idle", message: "" });
    }
  });
  const updateOnline = () => {
    const online = navigator.onLine;
    this.updateSyncState({ online });
    if (online && this.getStartupReconciliationState?.().phase === "OFFLINE_LOCAL") {
      void this.reconcileInitialRouteData?.();
      return;
    }
    if (online && this._pendingMutationCount > 0) void this.autoSync();
  };
  window.addEventListener("online", updateOnline);
  window.addEventListener("offline", updateOnline);
  window.addEventListener("pagehide", () => {
    this._wsPageSuspended = true;
    this.disconnectWebSocket?.(false);
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted && !this._wsPageSuspended) return;
    this._wsPageSuspended = false;
    if (navigator.onLine) this.setupWebSocketConnection?.();
  });
  document.addEventListener("input", (event) => {
    const modal = event.target?.closest?.(".modal-overlay.active");
    if (modal && event.isTrusted !== false) modal.dataset.bfUnsaved = "true";
  }, true);
  document.addEventListener("submit", (event) => {
    const modal = event.target?.closest?.(".modal-overlay");
    if (modal) delete modal.dataset.bfUnsaved;
  }, true);
  window.addEventListener("beforeunload", (event) => {
    const hasUnsavedForm = Boolean(
      document.querySelector(".modal-overlay.active[data-bf-unsaved='true']")
    );
    if (!hasUnsavedForm) return;
    event.preventDefault();
    event.returnValue = "";
  });
  this.updateSyncState();
  if (this.model?.hasStorageReadFailures?.()) {
    this.updateSyncState({
      phase: "storageError",
      message: "Không thể đọc dữ liệu cục bộ · Nhấn để tải lại từ máy chủ",
    });
  }
}

export async function prepareExportSnapshot() {
  if (!this.model || typeof this.model.buildMutationSyncPayload !== "function") {
    throw new Error("Không thể xác nhận dữ liệu với máy chủ.");
  }
  const syncResult = await this.autoSync();
  if (!syncResult?.ok) {
    if (syncResult?.conflict || syncResult?.status === 409) {
      throw new Error("Dữ liệu đã thay đổi trên máy chủ. Vui lòng giải quyết xung đột trước khi xuất tệp.");
    }
    throw new Error("Không thể xác nhận dữ liệu với máy chủ trước khi xuất tệp.");
  }
  let snapshotVersion = syncResult?.data?.syncVersion;
  if (snapshotVersion === void 0 || snapshotVersion === null || snapshotVersion === "") {
    snapshotVersion = currentWorkspaceStorage(this).getItem("bf_last_sync_version");
  }
  if (snapshotVersion === void 0 || snapshotVersion === null || !/^\d+$/.test(String(snapshotVersion))) {
    throw new Error("Chưa có phiên bản dữ liệu đã cam kết để xuất tệp.");
  }
  return String(snapshotVersion);
}
