import {
  captureWorkspace,
  workspaceIsCurrent,
} from "./SyncWorkspaceContext.js";
import { showSyncErrorDetails } from "./SyncPresenter.js";


const ACTIONABLE_PENDING_PHASES = new Set([
  "conflict",
  "error",
  "storageError",
  "transportError",
  "validationRejected",
]);

function isSyncConflict(result) {
  if (result?.idempotencyKeyReused || result?.reloadUnsafe) return false;
  // A quarantined receipt has no local write left to replay.  When it asks
  // for a reload, pull the server snapshot immediately instead of opening a
  // local conflict-resolution workflow.
  if (result?.conflictQuarantined && !result?.reloadRequired) return false;
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
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  // Conflict drafts are no longer a user-facing feature.  Any retired local
  // receipt is discarded and the next full pull establishes the server row as
  // the only visible value.
  controller.model?.discardAllConflictRecoveryDrafts?.();
  const refreshed = await controller.forceSyncData?.(
    false,
    true,
    false,
    { skipFlush: true },
  );
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  if (refreshed?.ok) {
    controller.view?.showToast?.(
      "Đã tải dữ liệu máy chủ",
      "Bản ghi xung đột đã được thay bằng dữ liệu mới nhất trên máy chủ.",
      "info",
    );
    return { ok: false, conflict: true, serverReloaded: true, data: refreshed.data };
  }
  controller.view?.showToast?.(
    "Dữ liệu đã thay đổi trên máy chủ",
    "Không thể tải lại ngay dữ liệu máy chủ. Vui lòng thử đồng bộ lại.",
    "warning",
  );
  return { ok: false, conflict: true, reloadRequired: true, reloadFailed: true };
}

export async function resolvePendingSyncConflict(
  controller,
  initialResult,
  workspace = captureWorkspace(controller),
) {
  if (!controller || !isSyncConflict(initialResult)) return initialResult;
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  controller.model?.discardAllConflictRecoveryDrafts?.();
  const refreshed = await controller.forceSyncData?.(
    false,
    true,
    false,
    { skipFlush: true },
  );
  if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
  if (refreshed?.ok) {
    controller.view?.showToast?.(
      "Đã tải dữ liệu máy chủ",
      "Bản ghi xung đột đã được thay bằng dữ liệu mới nhất trên máy chủ.",
      "info",
    );
    return {
      ...initialResult,
      conflictCleared: true,
      serverReloaded: true,
      data: refreshed.data,
    };
  }
  controller.view?.showToast?.(
    "Dữ liệu đã thay đổi trên máy chủ",
    "Không thể tải lại ngay dữ liệu máy chủ. Vui lòng thử đồng bộ lại.",
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
    if (controller._rejectedRecordRestoration?.workspaceToken === workspaceToken
      || controller._terminalRejectionRecovery?.workspace?.token === workspace.token) {
      const restored = await controller.autoSync();
      if (!syncWorkspaceIsCurrent(controller, workspace)) return workspaceChangedResult();
      if (!restored?.ok) return restored;
    }
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
      void runManualSyncRetry(this);
      return;
    }
    void runManualSyncRetry(this);
  });
  this.model.onMutationBatchChanged = ({ pendingCount }) => {
    this._pendingMutationCount = Math.max(0, Number(pendingCount) || 0);
    if (pendingCount && shouldShowLocalPending(this._syncUxState?.phase)) {
      this.updateSyncState({ phase: "localPending" });
    }
    // Startup reconciliation owns the first push/pull barrier.  A mutation
    // staged while its authoritative reads are held must remain local until
    // that barrier observes it; scheduling the ordinary 80ms auto-sync here
    // can submit the same outbox batch a second time after the startup push
    // has already completed (notably in Chromium).
    const startupPhase = this.getStartupReconciliationState?.().phase;
    if (pendingCount && (
      this._startupReconciliationPromise
      || ["LOCAL_READY", "RECONCILING"].includes(startupPhase)
    )) return;
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
    if (online && this._pendingMutationCount > 0) {
      void this.autoSync({ retryAfterReconnect: true });
    }
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

function assertExportSyncBoundary(controller, result, workspace, activeRole) {
  if (!syncWorkspaceIsCurrent(controller, workspace)) {
    throw new Error("Tổ chức đang làm việc đã thay đổi. Vui lòng xuất lại.");
  }
  if (String(controller.model.state?.activerole || "").trim().toLowerCase() !== activeRole) {
    throw new Error("Vai trò đang làm việc đã thay đổi. Vui lòng xuất lại.");
  }
  if (!result?.ok) {
    if (result?.conflict || result?.status === 409) {
      throw new Error("Dữ liệu đã thay đổi trên máy chủ. Vui lòng giải quyết xung đột trước khi xuất tệp.");
    }
    throw new Error("Không thể xác nhận dữ liệu với máy chủ trước khi xuất tệp.");
  }
  if (result.requiredActiveRole) {
    throw new Error("Thay đổi chưa được đồng bộ. Vui lòng chuyển sang vai trò Quản lý để đồng bộ trước khi xuất tệp.");
  }
  if (result.localMutationsPending === true
    || controller.model.hasPendingMutationOutboxChanges?.()
    || controller.model.buildMutationSyncPayload()) {
    throw new Error("Thay đổi cục bộ chưa được máy chủ xác nhận. Vui lòng đồng bộ trước khi xuất tệp.");
  }
}

export async function prepareExportSnapshot() {
  if (!this.model || typeof this.model.buildMutationSyncPayload !== "function") {
    throw new Error("Không thể xác nhận dữ liệu với máy chủ.");
  }
  const workspace = captureWorkspace(this);
  const activeRole = String(this.model.state?.activerole || "").trim().toLowerCase();
  const syncResult = await this.autoSync();
  assertExportSyncBoundary(this, syncResult, workspace, activeRole);
  if (typeof this.forceSyncData !== "function") {
    throw new Error("Không thể xác nhận dữ liệu với máy chủ trước khi xuất tệp.");
  }
  // A push ACK does not advance the pull cursor, and route bootstrap can be
  // partial. Await a complete workspace pull before selecting an export version.
  const pullResult = await this.forceSyncData(false, false);
  assertExportSyncBoundary(this, pullResult, workspace, activeRole);
  const snapshotVersion = pullResult?.data?.syncVersion;
  if (pullResult?.data?.partial === true) {
    throw new Error("Chưa có phiên bản dữ liệu đã cam kết để xuất tệp.");
  }
  if (snapshotVersion === void 0 || snapshotVersion === null || !/^\d+$/.test(String(snapshotVersion))) {
    throw new Error("Chưa có phiên bản dữ liệu đã cam kết để xuất tệp.");
  }
  return String(snapshotVersion);
}
