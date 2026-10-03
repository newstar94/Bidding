import { apiFetch } from "../shared/apiClient.js";
import { beginExplicitLogout, setAuthSessionActive } from "./authRuntimeState.js";
import { captureServerCapabilitiesRollback } from "./serverCapabilities.js";

function mutationRecordCount(upserts) {
  return Object.values(upserts || {}).reduce(
    (total, records) => total + Object.keys(records || {}).length,
    0,
  );
}

export function countPendingMutations(queue = {}) {
  const dirtyTables = Object.values(queue.dirtyTables || {})
    .filter(Boolean).length;
  const upserts = mutationRecordCount(queue.upserts);
  const patches = mutationRecordCount(queue.patches);
  const deletes = Array.isArray(queue.deletes) ? queue.deletes.length : 0;
  return dirtyTables + upserts + patches + deletes;
}

function syncFailureReason(result, error) {
  if (error?.message) return error.message;
  return String(
    result?.error?.message
    || result?.error?.code
    || result?.code
    || "Đồng bộ cuối cùng chưa hoàn tất.",
  );
}

export async function prepareExplicitLogout(controller) {
  let result = { ok: true, skipped: true };
  let syncError = null;
  if (typeof controller?.autoSync === "function") {
    try {
      result = await controller.autoSync();
    } catch (error) {
      syncError = error;
      result = { ok: false };
    }
  }
  const queue = controller?.model?.getMutationQueue?.() || {};
  const pendingCount = countPendingMutations(queue);
  if (pendingCount === 0) {
    return { discardConfirmed: false, proceed: true };
  }

  const reason = syncFailureReason(result, syncError);
  const discardConfirmed = Boolean(await controller?.view?.customConfirm?.(
    "Chưa thể đồng bộ trước khi đăng xuất",
    `Còn ${pendingCount} thay đổi chưa được gửi lên máy chủ. Lý do: ${reason}\n\n`
      + "Chọn \"Bỏ dữ liệu và đăng xuất\" để xóa vĩnh viễn các thay đổi này, "
      + "hoặc Hủy để quay lại và thử đồng bộ.",
    "alert-triangle",
    {
      confirmLabel: "Bỏ dữ liệu và đăng xuất",
      cancelLabel: "Hủy đăng xuất",
    },
  ));
  if (!discardConfirmed) {
    return { pendingCount, proceed: false, reason };
  }

  return {
    discardConfirmed: true,
    pendingCount,
    proceed: true,
  };
}

export async function requestAuthoritativeLogout(controller) {
  // Arm cross-tab/session-revocation suppression before the request. A server
  // failure must restore the active session and remove that suppression.
  const restoreServerCapabilities = captureServerCapabilitiesRollback();
  beginExplicitLogout();
  try {
    const response = await apiFetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      handleHttpErrors: false,
    });
    const payload = await response.json();
    if (!response.ok || payload?.success !== true) {
      throw new Error("Server did not confirm logout.");
    }
    return true;
  } catch (error) {
    restoreServerCapabilities();
    setAuthSessionActive(true);
    console.error("Server logout was not confirmed:", error);
    controller?.view?.showToast?.(
      "Chưa thể đăng xuất",
      "Phiên làm việc và dữ liệu trên thiết bị được giữ nguyên. Vui lòng thử lại.",
      "warning",
    );
    return false;
  }
}

export async function quarantineForcedSession(controller) {
  const model = controller?.model;
  const activeUser = model?.state?.activeuser;
  const checkerOwner = controller?._sessionCheckerOwner;
  const workspaceToken = model?.getWorkspaceToken?.() || "";
  const sessionIsCurrent = () => (
    controller?.model === model
    && model?.state?.activeuser === activeUser
    && controller?._sessionCheckerOwner === checkerOwner
  );
  controller?.disconnectWebSocket?.(false);
  try {
    await model?.flushMutationOutbox?.();
  } catch {
    // Existing durable replicas remain scoped to the previous user/workspace.
  }
  if (!sessionIsCurrent() || (workspaceToken
    && model?.isWorkspaceCurrent?.(workspaceToken) === false)) return;
  await model?.deactivateWorkspace?.();
  // Deactivation advances the original workspace epoch itself. Its session
  // identity still has to match before clearing authentication storage.
  if (!sessionIsCurrent()) return;
  model?.clearSessionData?.();
}
