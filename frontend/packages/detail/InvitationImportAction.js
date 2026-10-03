import { beginWorkspaceRequest, finishWorkspaceRequest, isWorkspaceLeaseCurrent } from "../../app/workspaceLease.js";
import { hasServerCapability, PROCUREMENT_LOOKUP_CAPABILITY } from "../../auth/serverCapabilities.js";
import { lookupPackageInvitationUpdates, mergeInvitationUpdateRows } from "../../procurement/InvitationUpdates.js";
import { beginLongTaskLoading } from "../../shared/LongTaskLoading.js";
import { packageWorkspaceFor } from "./PackageWorkspaceState.js";

export function canImportInvitationUpdates(model) {
  const actorId = model?.state?.activeuser?.id;
  return hasServerCapability(PROCUREMENT_LOOKUP_CAPABILITY)
    && Boolean(model?.hasPermission?.(actorId, "goithau", "edit"));
}

function editorRows(container, kind) {
  const request = kind === "request";
  const extension = kind === "extension";
  const prefix = extension ? "gh" : request ? "yc" : "tl";
  const selector = extension ? "#gt-giahan-tbody tr" : request ? "#gt-yeucaulamro-tbody tr" : "#gt-traloilamro-tbody tr";
  return Array.from(container.querySelectorAll(selector), (row) => ({
    id: row.getAttribute("data-id"),
    sourceKey: row.getAttribute("data-source-key") || "",
    ...(extension && row.getAttribute("data-source-previous-closing-at")
      ? { sourcePreviousClosingAt: row.getAttribute("data-source-previous-closing-at") } : {}),
    [extension ? "thoiGianDongThau" : request ? "thoiGianYeuCau" : "thoiGianTraLoi"]: row.querySelector(`.${prefix}-time-input`)?.value || "",
    [extension ? "lyDoGiaHan" : request ? "noiDungYeuCau" : "noiDungTraLoi"]: row.querySelector(extension ? ".gh-reason-input" : `.${prefix}-content-input`)?.value || "",
  }));
}

function mergeInvitationUpdates(view, current, revision) {
  const formatDateTime = (value) => view.model.formatForDatetimeLocal(value);
  const requests = mergeInvitationUpdateRows(current.requests, revision.clarificationAvailable === true ? revision.clarificationRequests : [], { kind: "request", formatDateTime });
  const responses = mergeInvitationUpdateRows(current.responses, revision.clarificationAvailable === true ? revision.clarificationResponses : [], { kind: "response", formatDateTime });
  const extensions = mergeInvitationUpdateRows(current.extensions, revision.extensionAvailable === true ? revision.extensions : [], { kind: "extension", formatDateTime });
  const linked = requests.linked + responses.linked + extensions.linked;
  return {
    requests, responses, extensions, linked,
    changed: Boolean(requests.added || responses.added || extensions.added || extensions.reordered || linked),
    preserveCurrentClosingForHistory: revision.extensionAvailable === true
      && Array.isArray(revision.extensions) && revision.extensions.length > 0,
  };
}

function applyInvitationDraft(view, container, appController, merged) {
  const { requests, responses, extensions } = merged;
  if (requests.added || requests.matched || requests.linked) appController._loadYeuCauLamRoRows(requests.rows, container);
  if (responses.added || responses.matched || responses.linked) appController._loadTraLoiLamRoRows(responses.rows, container);
  if (extensions.added || extensions.matched || extensions.linked || extensions.reordered) appController._loadGiaHanRows(extensions.rows, container);
  if (merged.preserveCurrentClosingForHistory
    && (extensions.added || extensions.matched || extensions.linked || extensions.reordered)) {
    container.dataset.invitationHistoryImported = "true";
  }
  if (merged.changed) packageWorkspaceFor(view).transition({ type: "SET_DIRTY", dirty: true });
}

function changedMessage(merged, saved) {
  if (merged.requests.added || merged.responses.added || merged.extensions.added) {
    return `${saved ? "Đã cập nhật và lưu" : "Đã thêm"} ${merged.requests.added} yêu cầu, ${merged.responses.added} trả lời làm rõ và ${merged.extensions.added} lần gia hạn.`;
  }
  if (merged.linked) return `${saved ? "Đã lưu liên kết" : "Đã liên kết"} các dòng hiện có với dữ liệu Mua Sắm Công, giữ nguyên nội dung anh đã nhập.`;
  if (merged.extensions.reordered) return `Đã ${saved ? "lưu và " : ""}sắp xếp lịch sử gia hạn theo thời gian đóng thầu mới.`;
  return "Không có nội dung làm rõ, gia hạn mới. Các nội dung đang nhập được giữ nguyên.";
}

function lockInvitationButtons(container, button) {
  const controls = new Set([button, ...container.querySelectorAll("button")]);
  const states = Array.from(controls, (control) => ({ control, disabled: control.disabled }));
  states.forEach(({ control }) => { control.disabled = true; });
  container.dataset.invitationImportBusy = "true";
  return () => {
    states.forEach(({ control, disabled }) => { control.disabled = disabled; });
    delete container.dataset.invitationImportBusy;
  };
}

function unavailableHistoryMessage(result) {
  if (!result.history) {
    const unavailable = [];
    if (result.revision.clarificationAvailable !== true) unavailable.push("làm rõ");
    if (result.revision.extensionAvailable !== true) unavailable.push("gia hạn");
    return unavailable.length
      ? ` Chưa lấy được dữ liệu ${unavailable.join(", ")} của phiên bản này; nội dung đang nhập được giữ nguyên.` : "";
  }
  const parts = [];
  for (const [field, label] of [["clarificationAvailable", "làm rõ"], ["extensionAvailable", "gia hạn"]]) {
    const unavailable = result.history.revisions
      .filter((revision) => (field !== "clarificationAvailable" || revision.clarificationIncluded !== false) && !revision[field])
      .map((revision) => revision.revisionNumber);
    if (unavailable.length) parts.push(`Chưa lấy được dữ liệu ${label} ở phiên bản ${unavailable.join(", ")}.`);
  }
  if (result.history.missingRevisions.length) {
    parts.push(`Chưa lấy được chi tiết phiên bản ${result.history.missingRevisions.join(", ")}.`);
  }
  return parts.length ? ` ${parts.join(" ")} Nội dung đang nhập được giữ nguyên.` : "";
}

export function bindInvitationImportAction(view, container, pkg, appController, {
  lookup = lookupPackageInvitationUpdates,
  beginLoading = beginLongTaskLoading,
  persistUpdates,
  renderSaved,
  renderDraft,
} = {}) {
  const button = container.querySelector("#btn-invitation-import-msc");
  if (!button) return;
  button.onclick = async () => {
    if (button.disabled || container.dataset.invitationImportBusy === "true"
      || container.dataset.invitationSaveBusy === "true" || !canImportInvitationUpdates(view.model)) return;
    const initialEditMode = Boolean(view._biddingInfoEditMode);
    if (!initialEditMode && (typeof persistUpdates !== "function" || typeof renderSaved !== "function" || typeof renderDraft !== "function")) return;
    const model = view.model;
    const request = beginWorkspaceRequest(model);
    const isWorkspaceCurrent = () => view.model === model
      && isWorkspaceLeaseCurrent(model, request.lease)
      && String(view._currentWorkflowPackageId) === String(pkg.id);
    const isCurrent = () => isWorkspaceCurrent()
      && container.contains(button)
      && Boolean(view._biddingInfoEditMode) === initialEditMode
      && canImportInvitationUpdates(model);
    const unlock = lockInvitationButtons(container, button);
    button.setAttribute("aria-busy", "true");
    let loading;
    let message = "";
    let saved = false;
    let rendered = false;
    let merged;
    let lookupResult;
    let saveAttempted = false;
    try {
      loading = await beginLoading({
        task: "procurement-invitation",
        title: "Đang lấy làm rõ, gia hạn",
        detail: pkg.tenGoiThau || pkg.maGoiThau || "",
        stages: [
          { key: "fetch", label: "Lấy lịch sử", message: "Đang lấy yêu cầu làm rõ, trả lời và lịch sử gia hạn từ Mua Sắm Công…" },
          { key: "merge", label: "Điền vào bảng", message: "Đang đối chiếu lịch sử và giữ lại các nội dung anh đã nhập…" },
          ...(!initialEditMode ? [{ key: "save", label: "Lưu cập nhật", message: "Đang chờ máy chủ xác nhận dữ liệu cập nhật…" }] : []),
        ],
      });
      if (!isCurrent()) return;
      const result = await lookup({ pkg, model, signal: request.signal });
      lookupResult = result;
      if (!isCurrent()) return;
      await loading?.update?.("merge");
      if (!isCurrent()) return;
      const current = initialEditMode
        ? { requests: editorRows(container, "request"), responses: editorRows(container, "response"), extensions: editorRows(container, "extension") }
        : { requests: pkg.yeuCauLamRoList, responses: pkg.traLoiLamRoList, extensions: pkg.giaHanList };
      merged = mergeInvitationUpdates(view, current, result.revision);
      if (initialEditMode) {
        applyInvitationDraft(view, container, appController, merged);
      } else if (merged.changed) {
        await loading?.update?.("save");
        if (!isCurrent()) return;
        saveAttempted = true;
        const confirmed = await persistUpdates({
          extensions: merged.extensions.rows,
          clarificationRequests: merged.requests.rows,
          clarificationResponses: merged.responses.rows,
          preserveCurrentClosingForHistory: merged.preserveCurrentClosingForHistory,
        });
        saved = true;
        if (!isCurrent()) return;
        await renderSaved(confirmed);
        rendered = true;
      }
      message = changedMessage(merged, saved);
      if (initialEditMode && merged.changed) {
        message += " Các bảng đã được điền vào bản nháp đang sửa; kiểm tra rồi bấm Lưu thông tin mời thầu.";
      }
      message += unavailableHistoryMessage(result);
    } catch (error) {
      if (error?.canonicalCommitted === true) saved = true;
      if (error?.name !== "AbortError" && isCurrent()) {
        if (saveAttempted && !saved) {
          await renderDraft({
            extensions: merged.extensions.rows,
            clarificationRequests: merged.requests.rows,
            clarificationResponses: merged.responses.rows,
            preserveCurrentClosingForHistory: merged.preserveCurrentClosingForHistory,
          });
          rendered = true;
          message = "Máy chủ chưa xác nhận cập nhật. Dữ liệu vừa lấy được giữ trong bản nháp; kiểm tra rồi bấm Lưu thông tin mời thầu để thử lại.";
          message += unavailableHistoryMessage(lookupResult);
        } else if (saved) {
          message = "Máy chủ đã xác nhận cập nhật nhưng chưa hiển thị lại được bảng. Mở lại gói thầu để xem dữ liệu đã lưu.";
        } else message = error?.code === "PROCUREMENT_REVISION_INVALID"
          ? "Chưa xác định được phiên bản TBMT của gói thầu. Kiểm tra mã và phiên bản trước khi lấy dữ liệu."
          : "Không thể lấy dữ liệu làm rõ, gia hạn. Kiểm tra mã TBMT, kết nối và thử lại.";
      }
    } finally {
      finishWorkspaceRequest(model, request);
      unlock();
      button.removeAttribute("aria-busy");
      await loading?.close();
      if (message && (rendered ? isWorkspaceCurrent() : isCurrent())) {
        const status = container.querySelector("#invitation-import-status");
        if (status) status.textContent = message;
        button.focus?.({ preventScroll: true });
      }
    }
  };
}
