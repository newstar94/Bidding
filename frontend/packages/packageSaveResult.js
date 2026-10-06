import { CANONICAL_SAVE_STATUS, classifyCanonicalSyncResult } from "../shared/MutationService.js";

export function requireCanonicalPackageSave(result) {
  const canonicalStatus = classifyCanonicalSyncResult(result);
  if (canonicalStatus === CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED) return result;
  // Offline package edits have a distinct durable-local contract: the record
  // may be returned for local continuation, but callers must keep the editor
  // open and present the pending state instead of claiming server success.
  if (canonicalStatus === CANONICAL_SAVE_STATUS.OFFLINE_PENDING
      && (result?.offline === true || result?.online === false)) return result;
  const error = new Error("Máy chủ chưa xác nhận thay đổi.");
  error.code = result?.code || canonicalStatus;
  error.canonicalStatus = canonicalStatus;
  error.syncResult = result;
  throw error;
}

export function markOfflinePackageSave(record, syncResult) {
  if (!record || !syncResult || classifyCanonicalSyncResult(syncResult) !== CANONICAL_SAVE_STATUS.OFFLINE_PENDING) return record;
  Object.defineProperty(record, "__packageSyncResult", {
    configurable: true, enumerable: false, value: syncResult, writable: false,
  });
  return record;
}

export function offlinePackageSaveResult(record) {
  return record?.__packageSyncResult || null;
}

export async function reportPackageSaveFailure(view, error, { onConflict } = {}) {
  if (error?.code === "WORKSPACE_CHANGED" || error?.syncResult?.workspaceChanged) return;
  const status = error?.canonicalStatus;
  const conflict = status === CANONICAL_SAVE_STATUS.CONFLICT;
  // The rejected mutation is already rolled back by the canonical sync seam.
  // Keep the caller's input as a separate, non-replayed draft; callers may
  // annotate the editor, but must not clear it or navigate away automatically.
  if (conflict) await onConflict?.({ preserveDraft: true, syncResult: error.syncResult });
  const pending = status === CANONICAL_SAVE_STATUS.OFFLINE_PENDING || status === CANONICAL_SAVE_STATUS.REMOTE_PENDING;
  const message = conflict
    ? error.syncResult?.serverReloaded
      ? "Thay đổi bị xung đột đã được loại bỏ. Màn hình dùng dữ liệu máy chủ."
      : "Thay đổi bị xung đột đã được loại bỏ. Hãy đồng bộ lại để tải dữ liệu máy chủ trước khi sửa tiếp."
    : pending
      ? "Thay đổi đã lưu trên thiết bị và đang chờ máy chủ xác nhận. Chưa hoàn tất lưu chính thức."
      : "Chưa hoàn tất lưu. Nội dung đang nhập được giữ lại để kiểm tra và thử lưu lại.";
  if (typeof view?.showToast === "function") view.showToast("Chưa hoàn tất lưu", message, conflict || pending ? "warning" : "error");
  else await view?.customAlert?.("Chưa hoàn tất lưu", message, "alert-triangle");
}
