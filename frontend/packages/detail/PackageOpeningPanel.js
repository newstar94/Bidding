import { setRuntimeStyle } from "../../shared/runtimeStyles.js";
import { trustedHTML } from "../../shared/trustedTypes.js";
import { escapeHtml } from "../../shared/view_helpers.js";
import { validateExtensionRows } from "../packageValidation.js";
import { savePackageInvitationInfo } from "../packageInvitation.js";
import { registerCommandArgs } from "../../shared/commandArgs.js";
import { renderInvitationPanel } from "./InvitationPanel.js";
import { renderOpeningPanel } from "./OpeningPanel.js";
import { renderPackageSummary } from "./PackageSummary.js";

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
    .querySelectorAll("#gt-giahan-tbody input, #gt-yeucaulamro-tbody input, #gt-traloilamro-tbody input")
    .forEach((input) => {
      input.disabled = true;
      setRuntimeStyle(input, "background", "var(--neutral-soft)");
      setRuntimeStyle(input, "cursor", "not-allowed");
    });
  contentWrapper
    .querySelectorAll("#gt-giahan-tbody td:last-child, #gt-yeucaulamro-tbody td:last-child, #gt-traloilamro-tbody td:last-child")
    .forEach((cell) => setRuntimeStyle(cell, "display", "none"));
}

function bindInvitationActions(view, contentWrapper, pkg, appController) {
  const addActions = [
    ["#btn-them-giahan", "addGiaHanRow"],
    ["#btn-them-yeucaulamro", "addYeuCauLamRoRow"],
    ["#btn-them-traloilamro", "addTraLoiLamRoRow"],
  ];
  addActions.forEach(([selector, method]) => {
    const button = contentWrapper.querySelector(selector);
    if (button) button.onclick = () => appController?.[method]?.();
  });

  const saveButton = contentWrapper.querySelector("#btn-luu-thongtinmoithau");
  if (!saveButton) return;
  saveButton.onclick = async () => {
    if (!view._biddingInfoEditMode) {
      view._biddingInfoEditMode = true;
      view.showPackageDetails(pkg.id);
      return;
    }

    const extensionRows = appController?._collectGiaHanRows() || [];
    const clarificationRequests = appController?._collectYeuCauLamRoRows() || [];
    const clarificationResponses = appController?._collectTraLoiLamRoRows() || [];
    const extensionControls = Array.from(contentWrapper.querySelectorAll("#gt-giahan-tbody tr"));
    const extensionValidation = validateExtensionRows(
      pkg.thoiGianDongThau || "",
      extensionControls.map((row) => ({
        timeStr: row.querySelector(".gh-time-input")?.value.trim() || "",
        reason: row.querySelector(".gh-reason-input")?.value.trim() || "",
      })),
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
      appController?.validateGiaHanRealtime?.();
      return;
    }

    const savedPackage = await savePackageInvitationInfo(appController || view, pkg, {
      extensions: extensionRows,
      clarificationRequests,
      clarificationResponses,
      convertDateTime: (value) => view.model.convertDMYHMSToYMDHMS(value),
    });
    view._biddingInfoEditMode = false;
    await view.showPackageDetails(savedPackage.id);
    await view.customAlert("Thành công", "Lưu thông tin mời thầu thành công!", "check-circle");
  };
}

function renderInvitation(view, contentWrapper, pkg, appController) {
  renderInvitationPanel(contentWrapper, pkg, {
    summaryHtml: packageSummary(view, pkg, { timeIds: true }),
    editMode: view._biddingInfoEditMode,
  });
  appController?._loadGiaHanRows(pkg.giaHanList || []);
  appController?._loadYeuCauLamRoRows(pkg.yeuCauLamRoList || []);
  appController?._loadTraLoiLamRoRows(pkg.traLoiLamRoList || []);
  if (!view._biddingInfoEditMode) setInvitationReadOnly(contentWrapper);
  bindInvitationActions(view, contentWrapper, pkg, appController);
}

export function renderPackageOpeningPanel(view, {
  contentWrapper,
  pkg,
  appController,
} = {}) {
  const mode = resolvePackageOpeningMode(pkg);
  if (mode === "preparation") {
    renderPreparationPrompt(view, contentWrapper, pkg);
  } else if (mode === "invitation") {
    renderInvitation(view, contentWrapper, pkg, appController);
  } else {
    renderOpeningPanel(contentWrapper, pkg, {
      isDirectOrSpecial: isDirectOrSpecialPackage(pkg),
    });
    appController?.renderMoThauPanel?.();
  }
  window.lucide?.createIcons({ root: contentWrapper });
  return mode;
}
