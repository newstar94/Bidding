import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";
import { validateExtensionRows } from "../packageValidation.js";
import { savePackageInvitationInfo } from "../packageInvitation.js";
import { registerCommandArgs } from "../../shared/commandArgs.js";
import { renderInvitationPanel } from "./InvitationPanel.js";
import { renderOpeningPanel } from "./OpeningPanel.js";
import { renderPackageSummary } from "./PackageSummary.js";
import { completePackageWorkspaceEdit, packageWorkspaceFor } from "./PackageWorkspaceState.js";
import { bindInvitationImportAction, canImportInvitationUpdates } from "./InvitationImportAction.js";
import { parseBidDateTime } from "../../shared/dateParseUtils.js";

function isDirectOrSpecialPackage(pkg) {
  return pkg?.hinhThucLuaChon === "Chỉ định thầu rút gọn"
    || pkg?.hinhThucLuaChon === "Lựa chọn nhà thầu trong trường hợp đặc biệt";
}

export function resolvePackageOpeningMode(pkg) {
  if (isDirectOrSpecialPackage(pkg)) return "opening";
  if (pkg?.trangThai === "Chuẩn bị") return "preparation";
  if (pkg?.trangThai === "Đang mời thầu") return "invitation";
  return "opening";
}

function packageSummary(view, pkg, { timeIds = false } = {}) {
  const plan = view.model.getLatestPlan(pkg.keHoachId);
  const investor = plan
    ? view.model.state.chudautu.find((item) => item.id === plan.chuDauTuId)
    : null;
  return renderPackageSummary({
    pkg,
    planName: plan?.tenKeHoach || "Không rõ",
    investorName: investor?.tenChuDauTu || "Không rõ",
    formatCurrency: (value) => view.model.formatCurrency(value),
    formatDateTime: (value) => view.model.formatDateWithTime(value),
    timeIds,
  });
}

function renderPreparationPrompt(view, contentWrapper, pkg) {
  const releaseArgsKey = registerCommandArgs([String(pkg.id || "")]);
  contentWrapper.innerHTML = trustedHTML(`
    ${packageSummary(view, pkg)}
    <div class="bf-s-4cee5cb79b">
      <div class="bf-s-dca86ff56c"><i data-lucide="settings" class="bf-s-f5c02a2822"></i></div>
      <h4 class="bf-s-4c428a6a8c">Gói thầu đang trong giai đoạn Chuẩn bị</h4>
      <p class="bf-s-ed725428b7">Gói thầu này hiện đang trong giai đoạn Chuẩn bị và chưa phát hành hồ sơ mời thầu. Vui lòng phát hành HSMT để bắt đầu quá trình mời thầu và nhận hồ sơ thầu.</p>
      <button class="btn btn-primary bf-s-43ee718714" data-bf-action="call" data-fn="phatHanhHsmtGoiThau" data-arg-key="${escapeHtml(releaseArgsKey)}">
        <i data-lucide="send"></i> Phát hành HSMT & Mời thầu
      </button>
    </div>`);
}

function setInvitationReadOnly(contentWrapper) {
  contentWrapper
    .querySelectorAll("#gt-giahan-tbody input, #gt-giahan-tbody textarea, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input, #gt-yeucaulamro-tbody textarea, #gt-traloilamro-tbody textarea")
    .forEach((input) => {
      input.disabled = true;
      setRuntimeStyle(input, "background", "var(--neutral-soft)");
      setRuntimeStyle(input, "cursor", "not-allowed");
    });
  contentWrapper
    .querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child")
    .forEach((cell) => setRuntimeStyle(cell, "display", "none"));
}

export function completePackageInvitationEdit(view) {
  view._biddingInfoEditMode = false;
  completePackageWorkspaceEdit(view);
}

function persistInvitationRows(view, pkg, appController, updates) {
  for (const [rows, timeField, contentField] of [
    [updates.clarificationRequests, "thoiGianYeuCau", "noiDungYeuCau"],
    [updates.clarificationResponses, "thoiGianTraLoi", "noiDungTraLoi"],
  ]) {
    if (rows.some((row) => !parseBidDateTime(row[timeField]) || !String(row[contentField] || "").trim())) {
      throw new Error("Nhập đủ thời gian hợp lệ và nội dung cho từng dòng làm rõ trước khi lưu.");
    }
  }
  const validation = validateExtensionRows(pkg.thoiGianDongThau || "", updates.extensions.map((row) => ({
    id: row.id,
    sourcePreviousClosingAt: row.sourcePreviousClosingAt || "",
    timeStr: row.thoiGianDongThau || "",
    reason: row.lyDoGiaHan || "",
  })), { existingRows: pkg.giaHanList || [] });
  if (!validation.valid) throw new Error(validation.error);
  const canonicalRows = (rows, timeField, contentField) => rows.map((row) => ({
    id: row.id, [timeField]: row[timeField], [contentField]: row[contentField],
  }));
  return savePackageInvitationInfo(appController || view, pkg, {
    extensions: canonicalRows(updates.extensions, "thoiGianDongThau", "lyDoGiaHan"),
    clarificationRequests: canonicalRows(updates.clarificationRequests, "thoiGianYeuCau", "noiDungYeuCau"),
    clarificationResponses: canonicalRows(updates.clarificationResponses, "thoiGianTraLoi", "noiDungTraLoi"),
    preserveCurrentClosingForHistory: updates.preserveCurrentClosingForHistory,
    convertDateTime: (value) => view.model.convertDMYHMSToYMDHMS(value),
  });
}

function bindInvitationActions(view, contentWrapper, pkg, appController, isEditable) {
  bindInvitationImportAction(view, contentWrapper, pkg, appController, {
    persistUpdates: (updates) => persistInvitationRows(view, pkg, appController, updates),
    renderSaved: (savedPackage) => {
      completePackageInvitationEdit(view);
      renderInvitation(view, contentWrapper, savedPackage, appController, isEditable);
      view.createIconsScoped?.(contentWrapper);
    },
    renderDraft: (updates) => {
      view._biddingInfoEditMode = true;
      renderInvitation(view, contentWrapper, pkg, appController, isEditable);
      appController._loadGiaHanRows(updates.extensions, contentWrapper);
      appController._loadYeuCauLamRoRows(updates.clarificationRequests, contentWrapper);
      appController._loadTraLoiLamRoRows(updates.clarificationResponses, contentWrapper);
      if (updates.preserveCurrentClosingForHistory) contentWrapper.dataset.invitationHistoryImported = "true";
      packageWorkspaceFor(view).transition({ type: "SET_DIRTY", dirty: true });
      view.createIconsScoped?.(contentWrapper);
    },
  });
  const addActions = [
    ["#btn-them-giahan", "addGiaHanRow"],
    ["#btn-them-yeucaulamro", "addYeuCauLamRoRow"],
    ["#btn-them-traloilamro", "addTraLoiLamRoRow"],
  ];
  addActions.forEach(([selector, method]) => {
    const button = contentWrapper.querySelector(selector);
    if (button) button.onclick = () => {
      if (contentWrapper.dataset.invitationImportBusy !== "true" && contentWrapper.dataset.invitationSaveBusy !== "true") appController?.[method]?.({}, contentWrapper);
    };
  });

  const saveButton = contentWrapper.querySelector("#btn-luu-thongtinmoithau");
  if (!saveButton) return;
  saveButton.onclick = async () => {
    if (saveButton.disabled || contentWrapper.dataset.invitationImportBusy === "true" || contentWrapper.dataset.invitationSaveBusy === "true") return;
    if (!view._biddingInfoEditMode) {
      view._biddingInfoEditMode = true;
      view.showPackageDetails(pkg.id);
      return;
    }

    const invalidClarification = Array.from(contentWrapper.querySelectorAll("#gt-yeucaulamro-tbody tr, #gt-traloilamro-tbody tr"))
      .find((row) => {
        const time = row.querySelector(".yc-time-input, .tl-time-input")?.value.trim();
        const content = row.querySelector(".yc-content-input, .tl-content-input")?.value.trim();
        return !time || !content || !parseBidDateTime(time);
      });
    if (invalidClarification) {
      await view.customAlert("Dữ liệu không hợp lệ", "Nhập đủ thời gian hợp lệ và nội dung cho từng dòng làm rõ trước khi lưu.", "alert-triangle");
      return;
    }

    const extensionRows = appController?._collectGiaHanRows(contentWrapper) || [];
    const clarificationRequests = appController?._collectYeuCauLamRoRows(contentWrapper) || [];
    const clarificationResponses = appController?._collectTraLoiLamRoRows(contentWrapper) || [];
    const extensionControls = Array.from(contentWrapper.querySelectorAll("#gt-giahan-tbody tr"));
    const extensionValidation = validateExtensionRows(
      pkg.thoiGianDongThau || "",
      extensionControls.map((row) => ({
        id: row.getAttribute("data-id"),
        sourcePreviousClosingAt: row.getAttribute("data-source-previous-closing-at") || "",
        timeStr: row.querySelector(".gh-time-input")?.value.trim() || "",
        reason: row.querySelector(".gh-reason-input")?.value.trim() || "",
      })),
      { existingRows: pkg.giaHanList || [] },
    );
    if (!extensionValidation.valid) {
      const row = extensionControls[extensionValidation.rowIndex];
      const input = row?.querySelector(
        extensionValidation.field === "reason" ? ".gh-reason-input" : ".gh-time-input",
      );
      await view.customAlert(
        "Dữ liệu không hợp lệ",
        extensionValidation.error,
        "alert-triangle",
        input,
      );
      appController?.validateGiaHanRealtime?.(contentWrapper);
      return;
    }

    if (saveButton.disabled) return;
    const controls = Array.from(contentWrapper.querySelectorAll("button"), (button) => ({ button, disabled: button.disabled }));
    controls.forEach(({ button }) => { button.disabled = true; });
    contentWrapper.dataset.invitationSaveBusy = "true";
    let savedPackage;
    try {
      savedPackage = await persistInvitationRows(view, pkg, appController, {
        extensions: extensionRows,
        clarificationRequests,
        clarificationResponses,
        preserveCurrentClosingForHistory: contentWrapper.dataset.invitationHistoryImported === "true",
      });
    } catch (error) {
      if (error?.code !== "WORKSPACE_CHANGED" && contentWrapper.contains(saveButton)) {
        if (error?.canonicalCommitted === true) {
          completePackageInvitationEdit(view);
          renderInvitation(view, contentWrapper, pkg, appController, isEditable);
          view.createIconsScoped?.(contentWrapper);
          const status = contentWrapper.querySelector("#invitation-import-status");
          if (status) status.textContent = "Máy chủ đã xác nhận cập nhật nhưng chưa hiển thị lại được bảng. Mở lại gói thầu để xem dữ liệu đã lưu.";
          await view.customAlert("Đã lưu thông tin mời thầu", "Máy chủ đã xác nhận thay đổi nhưng chưa tải lại được dữ liệu. Mở lại gói thầu để xem dữ liệu đã lưu.", "alert-triangle");
        } else {
          await view.customAlert("Chưa lưu thông tin mời thầu", "Máy chủ chưa xác nhận thay đổi. Nội dung đang nhập được giữ lại để anh kiểm tra và thử lưu lại.", "alert-triangle");
        }
      }
      return;
    } finally {
      controls.forEach(({ button, disabled }) => { button.disabled = disabled; });
      delete contentWrapper.dataset.invitationSaveBusy;
    }
    if (!contentWrapper.contains(saveButton) || String(view._currentWorkflowPackageId) !== String(pkg.id)) return;
    completePackageInvitationEdit(view);
    await view.showPackageDetails(savedPackage.id);
    await view.customAlert("Thành công", "Lưu thông tin mời thầu thành công!", "check-circle");
  };
}

function renderInvitation(view, contentWrapper, pkg, appController, isEditable) {
  delete contentWrapper.dataset.invitationHistoryImported;
  renderInvitationPanel(contentWrapper, pkg, {
    summaryHtml: packageSummary(view, pkg, { timeIds: true }),
    editMode: view._biddingInfoEditMode,
    canImport: isEditable && canImportInvitationUpdates(view.model),
  });
  appController?._loadGiaHanRows(pkg.giaHanList || [], contentWrapper);
  appController?._loadYeuCauLamRoRows(pkg.yeuCauLamRoList || [], contentWrapper);
  appController?._loadTraLoiLamRoRows(pkg.traLoiLamRoList || [], contentWrapper);
  if (!view._biddingInfoEditMode) setInvitationReadOnly(contentWrapper);
  bindInvitationActions(view, contentWrapper, pkg, appController, isEditable);
}

export function renderPackageOpeningPanel(view, {
  contentWrapper,
  pkg,
  appController,
  isEditable = true,
} = {}) {
  const mode = resolvePackageOpeningMode(pkg);
  if (mode === "preparation") {
    renderPreparationPrompt(view, contentWrapper, pkg);
  } else if (mode === "invitation") {
    renderInvitation(view, contentWrapper, pkg, appController, isEditable);
  } else {
    renderOpeningPanel(contentWrapper, pkg, {
      isDirectOrSpecial: isDirectOrSpecialPackage(pkg),
    });
    appController?.renderMoThauPanel?.();
  }
  window.lucide?.createIcons({ root: contentWrapper });
  return mode;
}
