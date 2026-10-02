import { getAppController } from "../app/controllerRef.js";
import { captureWorkspaceLease } from "../app/workspaceLease.js";
import { getBusinessListSelection } from "./BusinessListSelection.js";
import { beginLongTaskLoading } from "./LongTaskLoading.js";
import { classForRuntimeDeclarations } from "./runtimeStyles.js";
import {
  createBusinessListBulkDeleteSession,
  submitBusinessListBulkDelete,
} from "./BusinessListBulkDeleteService.js";
import { prepareBusinessListBulkDelete } from "./BusinessListBulkDeletePreparation.js";

const LABELS = { kehoach: "kế hoạch", goithau: "gói thầu", hopdong: "hợp đồng" };
const ACTIVE = new WeakSet();
const UNRESOLVED = new WeakMap();
const count = (value) => Number(value || 0).toLocaleString("vi-VN");

function setUnresolved(controller, context = null) {
  const previous = UNRESOLVED.get(controller);
  if (context) UNRESOLVED.set(controller, context);
  else UNRESOLVED.delete(controller);
  const source = context || previous;
  if (source && globalThis.window?.dispatchEvent && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("bf:business-list-delete-pending", {
      detail: { model: source.model, type: source.preview.type, pending: Boolean(context), count: source.preview.selectedCount, scope: source.scope },
    }));
  }
}

async function dialog(view, method, ...args) {
  const message = globalThis.document?.getElementById("dialog-message");
  const className = message && classForRuntimeDeclarations("max-height:32vh;overflow-y:auto;white-space:pre-line;overflow-wrap:anywhere");
  if (className) message.classList.add(className);
  try {
    return await view[method](...args);
  } finally {
    if (className) message.classList.remove(className);
  }
}

function confirmationMessage(preview, choice, scope) {
  const label = LABELS[preview.type];
  const names = preview.selectedRecords.map((record, index) => `${index + 1}. ${record.name || record.id}${record.version !== "" && record.version != null ? ` (phiên bản ${record.version})` : ""}`).join("\n");
  const lines = [
    `Đã chọn ${count(preview.selectedCount)} ${label}.`,
    preview.type === "goithau"
      ? `Sẽ xóa ${count(choice.versionCount)} phiên bản gói thầu trong mọi phiên bản kế hoạch và ${count(choice.dependencyCount)} dòng thông tin mở thầu liên quan.`
      : `Sẽ xóa ${count(choice.versionCount)} phiên bản ${label}. Phạm vi: ${scope === "all" ? "toàn bộ phiên bản" : "phiên bản gần nhất"}.`,
    names,
    "Nếu một dữ liệu không thể xóa, toàn bộ yêu cầu sẽ bị từ chối; không xóa một phần. Dữ liệu chỉ được cập nhật sau khi máy chủ xác nhận.",
    "Thao tác xóa không thể hoàn tác.",
  ];
  return lines.join("\n\n");
}

function failureMessage(result) {
  const details = (result.errors || []).map((error) => {
    const reason = error.message || error.error || error.reason || "Dữ liệu không thể xóa.";
    return [error.table, error.id, reason].filter(Boolean).join(" · ");
  });
  return [result.message || "Máy chủ chưa xác nhận thao tác xóa.", ...details].join("\n");
}

async function retryConfirmation(context) {
  return dialog(context.view, "customConfirm", "Chưa xác định kết quả xóa",
    `Chưa xác định máy chủ đã hoàn tất yêu cầu hay chưa. Thử lại sẽ kiểm tra và gửi lại đúng yêu cầu đã xác nhận, không tạo yêu cầu xóa mới.\n\n${context.summary}`,
    "alert-triangle", { confirmLabel: "Thử lại yêu cầu này", cancelLabel: "Để sau" });
}

async function submitPrepared(context, submit, beginLoading) {
  while (true) {
    context.session.assertCurrent();
    const loading = await beginLoading({
      task: "business-list-bulk-delete",
      title: `Đang xóa ${LABELS[context.preview.type]} đã chọn`,
      message: "Đang chờ máy chủ xác nhận toàn bộ yêu cầu…",
      minimumVisibleMs: 0, exitTransitionMs: 0,
    });
    let result;
    try {
      result = await submit(context.session, context.command);
    } finally {
      await loading.close();
    }
    if (result?.workspaceChanged) { setUnresolved(context.controller); return result; }
    if (result?.ok) {
      setUnresolved(context.controller);
      // A successful refresh can advance the authorization revision. The
      // service owns that fence; do not validate the old session after its ACK.
      context.view.showToast?.(
        result.refreshPending ? "Đã xóa, cần làm mới danh sách" : `Đã xóa ${count(context.preview.selectedCount)} ${LABELS[context.preview.type]}`,
        result.refreshPending ? "Máy chủ đã xác nhận xóa. Vui lòng tải lại danh sách để xem dữ liệu mới nhất." : "Toàn bộ yêu cầu xóa đã được máy chủ xác nhận.",
        result.refreshPending ? "warning" : "success",
      );
      return result;
    }
    if (!result?.unknown) {
      setUnresolved(context.controller);
      await dialog(context.view, "customAlert", "Không thể xóa", failureMessage(result || {}), "alert-triangle");
      return result || { ok: false };
    }
    setUnresolved(context.controller, context);
    context.session.assertCurrent();
    if (!await retryConfirmation(context)) return result;
  }
}

export async function runBusinessListBulkDelete(controller, descriptor, {
  createSession = createBusinessListBulkDeleteSession,
  prepare = prepareBusinessListBulkDelete,
  submit = submitBusinessListBulkDelete,
  beginLoading = beginLongTaskLoading,
} = {}) {
  if (!controller?.view || !LABELS[descriptor?.type] || (!descriptor.count && !UNRESOLVED.has(controller))) return { ok: false, empty: true };
  if (ACTIVE.has(controller)) return { ok: false, busy: true };
  ACTIVE.add(controller);
  let context = UNRESOLVED.get(controller);
  let session = context?.session;
  let loading;
  try {
    if (context) {
      session.assertCurrent();
      if (context.preview.type !== descriptor.type) {
        await dialog(controller.view, "customAlert", "Cần kiểm tra yêu cầu trước", `Yêu cầu xóa ${LABELS[context.preview.type]} trước đó chưa xác định kết quả. Hãy trở lại danh sách ${LABELS[context.preview.type]} và chọn xóa để kiểm tra đúng yêu cầu đó.`, "alert-triangle");
        return { ok: false, unknown: true };
      }
      if (!await retryConfirmation(context)) return { ok: false, unknown: true };
      return await submitPrepared(context, submit, beginLoading);
    }
    loading = await beginLoading({
      task: "business-list-bulk-delete-prepare", title: "Đang kiểm tra dữ liệu đã chọn",
      message: "Đang tải các phiên bản và dữ liệu liên quan…",
      minimumVisibleMs: 0, exitTransitionMs: 0,
    });
    session = await createSession(controller);
    session.assertCurrent();
    const preview = await prepare({ descriptor: structuredClone(descriptor), ...session, maxOperations: 2000 });
    session.assertCurrent();
    await loading.close();
    loading = null;
    let scope = preview.type === "goithau" ? "all" : "latest";
    if (preview.type !== "goithau" && JSON.stringify(preview.choices.latest.deletions) !== JSON.stringify(preview.choices.all.deletions)) {
      const selected = await dialog(controller.view, "customVersionDeleteChoice", "Chọn phạm vi xóa",
        `Đã chọn ${count(preview.selectedCount)} ${LABELS[preview.type]}. Xóa phiên bản gần nhất: ${count(preview.choices.latest.versionCount)} phiên bản. Xóa toàn bộ: ${count(preview.choices.all.versionCount)} phiên bản.`,
        "Xóa phiên bản gần nhất", "Xóa toàn bộ các phiên bản");
      session.assertCurrent();
      if (selected !== 1 && selected !== 2) return { ok: false, cancelled: true };
      scope = selected === 2 ? "all" : "latest";
    }
    const choice = preview.choices[scope];
    if (choice.blockedReason) {
      await dialog(controller.view, "customAlert", "Không thể xóa", choice.blockedReason, "alert-triangle");
      return { ok: false, blocked: true };
    }
    const summary = confirmationMessage(preview, choice, scope);
    if (!await dialog(controller.view, "customConfirm", "Xác nhận xóa dữ liệu đã chọn", summary, "trash-2", { confirmLabel: "Xóa dữ liệu đã chọn" })) return { ok: false, cancelled: true };
    session.assertCurrent();
    const command = Object.freeze({ deletions: choice.deletions, baseSyncVersion: preview.syncVersion, expectedSyncVersion: preview.syncVersion });
    context = { controller, model: controller.model, view: controller.view, session, preview, command, summary,
      scope: { lease: captureWorkspaceLease(controller.model), identity: String(controller.model.state.activeuser?.id || controller.model.workspaceScope?.userId || ""),
        organization: String(controller.model.workspaceScope?.organizationId || ""), role: controller.model.state.activerole } };
    return await submitPrepared(context, submit, beginLoading);
  } catch (error) {
    if (error?.code === "WORKSPACE_CHANGED" || (error?.name === "AbortError" && error?.code !== "PAGINATION_AUTHORIZATION_SCOPE_CHANGED")) {
      setUnresolved(controller);
      return { ok: false, workspaceChanged: true };
    }
    // Offline/pending-change failures do not settle an earlier delete. Keep
    // its command available; retrying a newly built request would be unsafe.
    if (!context || UNRESOLVED.get(controller) !== context) setUnresolved(controller);
    await dialog(controller.view, "customAlert", "Không thể xóa", error?.message || "Chưa thể kiểm tra dữ liệu đã chọn. Vui lòng thử lại.", "alert-triangle");
    return { ok: false, error };
  } finally {
    if (loading) await loading.close();
    if (!UNRESOLVED.has(controller)) await session?.close?.();
    ACTIVE.delete(controller);
  }
}

export async function deleteSelectedBusinessListRows(view, type) {
  const controller = getAppController();
  if (!controller || controller.model !== view.model || controller.view !== view) return { ok: false, workspaceChanged: true };
  return runBusinessListBulkDelete(controller, getBusinessListSelection(view.model, type));
}
