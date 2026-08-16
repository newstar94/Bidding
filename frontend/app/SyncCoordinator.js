import { currentWorkspaceStorage } from "./SyncWorkspaceContext.js";
import { showSyncErrorDetails } from "./SyncPresenter.js";


const ACTIONABLE_PENDING_PHASES = new Set([
  "conflict",
  "error",
  "storageError",
  "transportError",
  "validationRejected",
]);

function isSyncConflict(result) {
  return Boolean(result?.conflict || result?.status === 409);
}

export async function resolvePendingSyncConflict(controller, initialResult) {
  if (!controller || !isSyncConflict(initialResult)) return initialResult;

  let result = initialResult;
  const rebased = typeof controller.forceSyncData === "function"
    ? await controller.forceSyncData(false, true)
    : { ok: false };
  if (rebased?.ok && typeof controller.autoSync === "function") {
    result = await controller.autoSync();
    if (result?.ok) {
      await controller.forceSyncData?.(false, false);
      controller.view?.showToast?.(
        "Đã xử lý xung đột",
        "Thay đổi cục bộ đã được đồng bộ sau khi tải lại phiên bản mới nhất từ máy chủ.",
        "success",
      );
      return { ...result, conflictCleared: true, retried: true };
    }
  }

  const pendingMutation = controller.model?.buildMutationSyncPayload?.();
  if (!pendingMutation || !isSyncConflict(result)) return result;
  const discard = Boolean(await controller.view?.customConfirm?.(
    "Không thể tự động xử lý xung đột",
    "Các thay đổi cục bộ vẫn xung đột sau khi tải lại dữ liệu máy chủ. "
      + "Bạn có thể bỏ riêng hàng đợi thay đổi cục bộ này và tải lại dữ liệu đã lưu trên máy chủ. "
      + "Dữ liệu trên máy chủ sẽ không bị xóa.",
    "alert-triangle",
    {
      confirmLabel: "Bỏ thay đổi cục bộ",
      cancelLabel: "Giữ lại để xử lý sau",
    },
  ));
  if (!discard) return { ...result, conflictCleared: false };

  controller.model?.discardMutationBatch?.();
  await controller.model?.flushMutationOutbox?.();
  const refreshed = typeof controller.forceSyncData === "function"
    ? await controller.forceSyncData(false, true)
    : { ok: true };
  const conflictCleared = refreshed?.ok !== false;
  if (conflictCleared) {
    controller.view?.showToast?.(
      "Đã loại bỏ xung đột",
      "Đã bỏ hàng đợi thay đổi cục bộ và tải lại dữ liệu mới nhất từ máy chủ.",
      "success",
    );
  }
  return {
    ok: conflictCleared,
    conflictCleared,
    discarded: true,
    data: refreshed,
  };
}

export function shouldShowLocalPending(currentPhase) {
  return !ACTIONABLE_PENDING_PHASES.has(String(currentPhase || ""));
}


export function getSyncActivitySnapshot(controller) {
  const outboxStatus = controller?.model?.getMutationOutboxStatus?.() || {};
  const hasPendingMutations = Number(controller?._pendingMutationCount || 0) > 0
    || Boolean(controller?.model?.buildMutationSyncPayload?.());
  return {
    settled: !controller?._autoSyncPromise
      && !controller?._syncImmediateTimer
      && !controller?._autoSyncQueued
      && !controller?._deferImmediateSync
      && Number(controller?.model?._workspaceMutations?.size || 0) === 0
      && outboxStatus.state !== "pending",
    phase: String(controller?._syncUxState?.phase || "idle"),
    hasPendingMutations,
  };
}


export function setupSyncUx() {
  if (this._syncUxInstalled) return;
  this._syncUxInstalled = true;
  const button = document.getElementById("btn-force-sync");
  button?.addEventListener("click", async () => {
    if (Array.isArray(this.model?.syncErrors) && this.model.syncErrors.length > 0) {
      showSyncErrorDetails(this, this.model.syncErrors);
      return;
    }
    if (this.model?.hasMutationOutboxDurabilityFailure?.()) {
      try {
        await this.model.recoverMutationOutbox?.();
      } catch (error) {
        console.error("Mutation outbox recovery failed:", error);
      }
      if (this.model.hasMutationOutboxDurabilityFailure()) {
        this.updateSyncState({
          phase: "storageError",
          message: "Chưa thể khôi phục thay đổi cục bộ · Vui lòng thử lại",
        });
        return;
      }
    }
    if (this.model?.hasStorageReadFailures?.()) {
      await this.forceSyncData(false, true);
      return;
    }
    const pushed = await this.autoSync();
    if (pushed?.ok) await this.forceSyncData(false, false);
    else if (isSyncConflict(pushed)) {
      await resolvePendingSyncConflict(this, pushed);
    }
  });
  this.model.onMutationBatchChanged = ({ pendingCount }) => {
    this._pendingMutationCount = Math.max(0, Number(pendingCount) || 0);
    if (pendingCount && shouldShowLocalPending(this._syncUxState?.phase)) {
      this.updateSyncState({ phase: "localPending" });
    }
    if (!pendingCount || this._syncImmediateTimer || this._deferImmediateSync) return;
    this._syncImmediateTimer = setTimeout(() => {
      this._syncImmediateTimer = null;
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
