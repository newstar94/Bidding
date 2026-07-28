import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getAppController } from "../app/controllerRef.js";
import { checkBidQualified } from "./detail/PackageTabs.js";
import { renderCancellationPanel } from "./detail/CancellationPanel.js";
import { renderPreparationActionPanel } from "./detail/PreparationPanel.js";
import { apiFetch } from "../shared/apiClient.js";
import { renderPreparationDetailsPanel } from "./detail/PreparationDetailsPanel.js";
import { renderAwardResultDetailsPanel } from "./detail/AwardResultDetailsPanel.js";
import { executeAppCommand } from "../app/commandBus.js";
import { hasHolidays, setHolidays } from "../shared/runtimeState.js";
import { renderTechnicalEvaluationPanel } from "./detail/TechnicalEvaluationPanel.js";
import { renderFinancialEvaluationPanel } from "./detail/FinancialEvaluationPanel.js";
import { renderFinancialOpeningPanel } from "./detail/FinancialOpeningPanel.js";
import { savePackageCancellation } from "./packageCancellation.js";
import { bindPackageDetailChrome } from "./detail/PackageDetailCoordinator.js";
import { buildPackageDetailViewModel } from "./detail/PackageDetailViewModel.js";
import { renderPackageOpeningPanel } from "./detail/PackageOpeningPanel.js";
import { renderQualifiedApprovalPanel } from "./detail/QualifiedApprovalPanel.js";
import { renderPackageDocumentsPanel } from "./detail/PackageDocumentsPanel.js";
import { renderPackageGoodsPanel } from "./PackageGoodsWorkflow.js";
export { checkBidQualified };

export function resetDetailedEvaluationNavigationForPackageChange(
  appController,
  currentPackageId,
  nextPackageId,
) {
  if (
    !appController
    || String(currentPackageId || "") === String(nextPackageId || "")
  ) {
    return false;
  }
  appController.currentEvaluationView = "summary";
  appController._detailedEvaluationDirty = false;
  return true;
}

export async function showPackageDetails(id, isSwitchingVersion = false) {
  const appController = getAppController();
  if (
    appController?.ensureBiddingWorkflows
    && (
      typeof appController.renderMoThauPanel !== "function"
      || typeof appController.renderDanhGiaHsdtPanel !== "function"
    )
  ) {
    try {
      await appController.ensureBiddingWorkflows();
    } catch (error) {
      console.error("Failed to load package workflow modules:", error);
      appController.view?.showToast?.(
        "Không tải được nghiệp vụ gói thầu",
        "Vui lòng tải lại trang và thử lại.",
        "error"
      );
      return;
    }
  }
  if (!hasHolidays()) {
    apiFetch("/api/holidays").then((r) => r.json()).then((data) => {
      setHolidays(data);
      this.showPackageDetails(id, isSwitchingVersion);
    }).catch((e) => {
      console.error("Failed to load holidays:", e);
      setHolidays({});
      this.showPackageDetails(id, isSwitchingVersion);
    });
    return;
  }
  const detail = buildPackageDetailViewModel({
    model: this.model,
    packageId: id,
    switchingVersion: isSwitchingVersion,
    currentPackageId: this._currentWorkflowPackageId,
    currentTab: this._currentWorkflowTab,
    editingBatchId: this._editingOfficialResultLotBatchId,
    editingWholePackage: this._editingWholePackageResult,
    editingWholePackageId: this._editingWholePackageResultPackageId,
  });
  if (!detail) return;
  id = detail.packageId;
  const formEl = document.getElementById("form-goithau");
  const modalMCard = document.querySelector("#modal-goithau .modal-card");
  if (formEl && modalMCard && !modalMCard.contains(formEl)) {
    modalMCard.appendChild(formEl);
  }
  const tabHeaders = document.getElementById("detail-workflow-tabs-header");
  if (tabHeaders) setRuntimeStyle(tabHeaders, "display", "flex");
  const detailPane = document.getElementById("tab-goithau-detail");
  if (!detailPane || !detailPane.classList.contains("active")) {
    executeAppCommand("switchTab", "goithau-detail", id);
    return;
  }
  if (this._currentWorkflowPackageId !== id) {
    this._inPlaceEditMode = false;
    this._biddingInfoEditMode = false;
    resetDetailedEvaluationNavigationForPackageChange(
      appController,
      this._currentWorkflowPackageId,
      id,
    );
  }
  const gt = detail.pkg;
  const detailCard = document.getElementById("detail-workflow-card");
  if (detailCard) setRuntimeStyle(detailCard, "visibility", "visible");
  const {
    activeTab,
    effectiveStatus: effectivePackageStatus,
    inviteComparisonLabel,
    comparisonLabel,
    isEditable,
    workflow: { isTechEvalSaved },
  } = detail;
  this._currentWorkflowTab = activeTab;
  this._currentWorkflowPackageId = detail.packageId;
  bindPackageDetailChrome(this, detail);
  const contentWrapper = document.getElementById("detail-workflow-content-wrapper");
  if (!contentWrapper) return;
  contentWrapper.innerHTML = trustedHTML("");
  switch (this._currentWorkflowTab) {
    case "preparation":
      renderPreparationDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    case "preparation_action":
      renderPreparationActionPanel(contentWrapper, gt);
      lucide.createIcons();
      break;
    case "goods":
      await renderPackageGoodsPanel(this, { contentWrapper, pkg: gt });
      break;
    case "opening":
    case "opening_tech":
      renderPackageOpeningPanel(this, { contentWrapper, pkg: gt, appController });
      break;
    case "eval_tech":
      renderTechnicalEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      if (appController) {
        appController.currentDanhGiaTab = "technical";
        appController.renderDanhGiaHsdtPanel?.();
      }
      break;
    case "eval_fin":
      renderFinancialEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      if (appController) {
        appController.currentDanhGiaTab = "financial";
        appController.renderDanhGiaHsdtPanel?.();
      }
      break;
    case "qualified":
      renderQualifiedApprovalPanel(this, {
        contentWrapper,
        pkg: gt,
        isTechEvalSaved,
        effectiveStatus: effectivePackageStatus,
        appController,
      });
      break;
    case "opening_fin":
      renderFinancialOpeningPanel(this, {
        contentWrapper,
        pkg: gt,
        effectiveStatus: effectivePackageStatus,
        appController,
      });
      break;
    case "result":
      renderAwardResultDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    case "cancel": {
      renderCancellationPanel(contentWrapper, {
        pkg: gt,
        formatDate: (value) => this.model.formatForDateInput(value),
        initDatePicker: (root) => this.initFlatpickr?.(root),
        onSave: async ({ decisionNumber, decisionDate, reason, controls }) => {
          if (!decisionNumber || !decisionDate || !reason) {
            const firstInvalid = !decisionNumber ? controls.decisionNumber : !decisionDate ? controls.decisionDate : controls.reason;
            await this.customAlert("Thiếu thông tin", "Vui lòng điền đầy đủ Số quyết định, Ngày quyết định và Lý do hủy thầu.", "alert-triangle", firstInvalid);
            return;
          }
          const result = await savePackageCancellation(appController, gt, {
            decisionNumber,
            decisionDate: this.model.convertDMYToYMD(decisionDate),
            reason
          });
          if (!result?.ok) return;
          await this.customAlert("Thành công", "Đã lưu quyết định hủy thầu và cập nhật trạng thái gói thầu.", "check-circle");
          this.showPackageDetails(gt.id);
        }
      });
      break;
    }
    case "documents":
      await renderPackageDocumentsPanel(this, {
        contentWrapper,
        packageId: gt.id,
      });
      break;
  }
  lucide.createIcons();
  if (appController?.setupExcelImportEvents) {
    appController.setupExcelImportEvents();
  }
  ["mothau-goithau-select", "danhgiahsdt-goithau-select", "result-goithau-select"].forEach((selectId) => {
    const wrapper = document.querySelector(`.custom-select-wrapper[data-select-id="${selectId}"]`);
    if (wrapper) wrapper.remove();
    const container = document.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    if (container) container.remove();
  });
  if (typeof appController?.unifyTableInputsHeight === "function") {
    appController.unifyTableInputsHeight(document);
  }
}
