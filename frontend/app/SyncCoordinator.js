import { currentWorkspaceStorage } from "./SyncWorkspaceContext.js";
import { showSyncErrorDetails } from "./SyncPresenter.js";


export function setupSyncUx() {
  if (this._syncUxInstalled) return;
  this._syncUxInstalled = true;
  const button = document.getElementById("btn-force-sync");
  button?.addEventListener("click", async () => {
    if (Array.isArray(this.model?.syncErrors) && this.model.syncErrors.length > 0) {
      showSyncErrorDetails(this, this.model.syncErrors);
    } else {
      const pushed = await this.autoSync();
      if (pushed?.ok) await this.forceSyncData(false, false);
    }
  });
  this.model.onMutationBatchChanged = ({ pendingCount }) => {
    this._pendingMutationCount = Math.max(0, Number(pendingCount) || 0);
    if (pendingCount) this.updateSyncState({ phase: "localPending" });
    if (!pendingCount || this._syncImmediateTimer || this._deferImmediateSync) return;
    this._syncImmediateTimer = setTimeout(() => {
      this._syncImmediateTimer = null;
      void this.autoSync();
    }, 80);
  };
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
