import { renderSyncStatus } from "./syncStatus.js";
import { currentWorkspaceStorage } from "./SyncWorkspaceContext.js";


export function hideOfflineBanner() {
  const banner = globalThis.document?.getElementById("offline-indicator-banner");
  banner?.classList.remove("visible");
  if (banner) banner.hidden = true;
}

export function updateSyncState(patch = {}) {
  const storedTimestamp = Number(
    currentWorkspaceStorage(this)?.getItem("bf_last_fetch_time") || 0
  ) || null;
  this._syncUxState = {
    phase: "idle",
    online: globalThis.navigator?.onLine !== false,
    lastSyncedAt: storedTimestamp,
    ...this._syncUxState,
    ...patch
  };
  renderSyncStatus(
    document.getElementById("btn-force-sync"),
    this._syncUxState,
  );
  return this._syncUxState;
}

export function buildSyncErrorDetailLines(errors, limit = 20) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, limit).map((error, index) => {
    const record = [error?.table, error?.id].filter(Boolean).join("/");
    const field = error?.path || error?.field || "";
    const location = field || record || "Không xác định được vị trí";
    const recordSuffix = record && field && !field.startsWith(record)
      ? ` · Bản ghi: ${record}`
      : "";
    const reason = error?.message || "Giá trị không đáp ứng quy tắc kiểm tra dữ liệu.";
    const code = error?.code ? `\n   Mã lỗi: ${error.code}` : "";
    return `${index + 1}. Vị trí: ${location}${recordSuffix}\n   Nguyên nhân: ${reason}${code}`;
  });
}

export function showSyncErrorDetails(controller, errors) {
  if (!controller?.view || typeof controller.view.customAlert !== "function") return;
  const detailLines = buildSyncErrorDetailLines(errors);
  const more = errors.length > detailLines.length
    ? `\n\n... và ${errors.length - detailLines.length} lỗi khác.`
    : "";
  controller.view.customAlert(
    `Chi tiết ${errors.length} lỗi đồng bộ`,
    detailLines.join("\n\n") + more,
    "alert-triangle"
  );
}

export function showSyncErrorReport(controller, errors, rejectedCount = 0) {
  if (!controller || !Array.isArray(errors) || errors.length === 0) return;
  if (controller.model) controller.model.syncErrors = errors;
  if (controller.view && typeof controller.view.showToast === "function") {
    controller.view.showToast(
      "Thất bại",
      rejectedCount > 0
        ? `${rejectedCount} bản ghi chưa hợp lệ. Bấm để xem chi tiết.`
        : `${errors.length} bản ghi chưa hợp lệ. Bấm để xem chi tiết.`,
      "error",
      {
        actionLabel: "Xem lỗi",
        onAction: () => showSyncErrorDetails(controller, errors)
      }
    );
  }
}
