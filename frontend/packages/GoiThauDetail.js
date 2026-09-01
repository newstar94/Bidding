import { trustedHTML } from "../shared/trustedTypes.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { getAppController } from "../app/controllerRef.js";
import { checkBidQualified } from "./detail/PackageTabs.js";
import { apiFetch } from "../shared/apiClient.js";
import { executeAppCommand } from "../app/commandBus.js";
import { hasHolidays, setHolidays } from "../shared/runtimeState.js";
import { PackageDetailModule } from "./detail/PackageDetailModule.js";
import {
  completePackageWorkspaceEdit,
  packageWorkspaceFor,
} from "./detail/PackageWorkspaceState.js";
import * as lifecyclePolicy from "./LifecyclePolicy.js";
import { buildPackageDetailViewModel } from "./detail/PackageDetailViewModel.js";
import { restoreDetailedEvaluationNavigation } from "./detailedEvaluationNavigation.js";
import { hydrateVersionFamily } from "../shared/VersionFamilyLoader.js";
import { linkedPlanIdsForPackage } from "./detail/packagePlanApprovals.js";
export { checkBidQualified };

export function capturePackageDetailNavigationIntent(view, packageId, requestedTab) {
  const tab = String(requestedTab || "").trim();
  if (!view || !tab) return false;
  view._currentWorkflowPackageId = String(packageId || "");
  view._currentWorkflowTab = tab;
  return true;
}

export function shouldAbortPackageDetailRefreshForNewDraft({
  isDirty = false,
  currentPackageId = "",
  targetPackageId = "",
  hasExplicitNavigation = false,
} = {}) {
  const samePackage = String(currentPackageId || "") === String(targetPackageId || "");
  return samePackage && isDirty && !hasExplicitNavigation;
}

function shouldAbortBackgroundPackageRefresh(view, packageWorkspace, packageId, isBackground) {
  if (!isBackground || !packageWorkspace.isDirty()) return false;
  return String(view?._currentWorkflowPackageId || "") === String(packageId || "");
}

async function hydratePackageDetailDependencies(appController, model, requestedPackage) {
  if (!requestedPackage) return;
  await hydrateVersionFamily(appController, "goithau", requestedPackage);
  const linkedPlanIds = linkedPlanIdsForPackage(model, requestedPackage);
  const loadedPlanIds = new Set(
    (model?.state?.kehoach || []).map((plan) => String(plan?.id || "")),
  );
  await Promise.all(
    linkedPlanIds
      .filter((planId) => !loadedPlanIds.has(String(planId)))
      .map((planId) => appController.fetchRecordByLookup("kehoach", planId)),
  );
}

function publishEvaluationTab(appController, tab) {
  if (!appController) return;
  appController.currentDanhGiaTab = tab;
  appController.renderDanhGiaHsdtPanel?.();
}

export function markRenderedDetail(view, pkg, renderVersion) {
  const renderedDetail = document.getElementById("detail-workflow-content-wrapper");
  if (!renderedDetail) return;
  renderedDetail.dataset.renderedWorkflowTab = String(view._currentWorkflowTab || "");
  renderedDetail.dataset.renderedPackageId = String(view._currentWorkflowPackageId || "");
  renderedDetail.dataset.renderedPackageStatus = String(pkg?.trangThai || "");
  renderedDetail.dataset.renderedPackageRowVersion = String(pkg?.rowVersion || "");
  renderedDetail.dataset.renderedRenderVersion = String(renderVersion);
}

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

export async function showPackageDetails(
  id,
  isSwitchingVersion = false,
  requestedWorkflowTab = "",
  options,
) {
  const isBackground = options?.isBackground === true;
  const appController = getAppController();
  const packageWorkspace = packageWorkspaceFor(this);
  if (shouldAbortBackgroundPackageRefresh(this, packageWorkspace, id, isBackground)) return;
  const requestedTab = String(requestedWorkflowTab || "").trim();
  const renderVersion = Number(this._packageDetailRenderVersion || 0) + 1;
  this._packageDetailRenderVersion = renderVersion;
  const existingContent = document.getElementById("detail-workflow-content-wrapper");
  if (existingContent) existingContent.dataset.pendingRenderVersion = String(renderVersion);
  const isCurrentRender = () => this._packageDetailRenderVersion === renderVersion;
  capturePackageDetailNavigationIntent(this, id, requestedTab);
  const requestedSnapshotId = String(this._requestedPackageSnapshotId || "");
  const requestedPlanSnapshotId = String(this._requestedPlanSnapshotId || "");
  const preservePlanSnapshot = Boolean(requestedPlanSnapshotId) && (
    isSwitchingVersion
    || requestedSnapshotId === String(id || "")
  );
  if (preservePlanSnapshot) {
    this._requestedPackageSnapshotId = id;
  } else {
    this._requestedPackageSnapshotId = null;
    this._requestedPlanSnapshotId = null;
  }
  if (
    appController?.ensureBiddingWorkflows
    && (
      typeof appController.renderMoThauPanel !== "function"
      || typeof appController.renderDanhGiaHsdtPanel !== "function"
    )
  ) {
    try {
      await appController.ensureBiddingWorkflows();
      if (!isCurrentRender()) return;
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
      if (!isCurrentRender()) return;
      this.showPackageDetails(id, isSwitchingVersion, requestedTab);
    }).catch((e) => {
      console.error("Failed to load holidays:", e);
      setHolidays({});
      if (!isCurrentRender()) return;
      this.showPackageDetails(id, isSwitchingVersion, requestedTab);
    });
    return;
  }
  restoreDetailedEvaluationNavigation(appController, id);
  const requestedPackage = (this.model?.state?.goithau || []).find(
    (pkg) => String(pkg?.id || "") === String(id || ""),
  );
  if (requestedPackage) {
    await hydratePackageDetailDependencies(appController, this.model, requestedPackage);
    if (!isCurrentRender()) return;
  }
  // A background refresh may start while the detail is clean, then finish
  // after the user has begun editing. Do not let that in-flight projection
  // replace the live form and discard unsaved values.
  if (shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: packageWorkspace.isDirty(),
    currentPackageId: this._currentWorkflowPackageId,
    targetPackageId: id,
    hasExplicitNavigation: Boolean(requestedTab),
  })) return;
  // The explicit intent is captured before asynchronous hydration above, so a
  // concurrent refresh resolves the same target instead of the default panel.
  const detail = buildPackageDetailViewModel({
    model: this.model,
    packageId: id,
    switchingVersion: isSwitchingVersion || preservePlanSnapshot,
    planSnapshotId: preservePlanSnapshot ? requestedPlanSnapshotId : "",
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
  this._packageDetailModule ||= new PackageDetailModule({ view: this });
  this._packageDetailModule.mount(detailCard || detailPane, {
    route: packageWorkspaceFor(this).snapshot(),
    store: this.model,
    lifecyclePolicy,
    detail,
    onNavigate: (route) => this.showPackageDetails(route.packageId || detail.packageId),
    onSave: (command) => command?.execute?.(),
  });
  const contentWrapper = document.getElementById("detail-workflow-content-wrapper");
  // A refresh can pass the initial clean-workspace guard, then yield while a
  // lazy workflow panel is being resolved. Re-check immediately before
  // replacing the live panel so a draft started during that yield is never
  // discarded by an in-flight projection.
  if (!contentWrapper || shouldAbortPackageDetailRefreshForNewDraft({
    isDirty: packageWorkspace.isDirty(),
    currentPackageId: this._currentWorkflowPackageId,
    targetPackageId: id,
    hasExplicitNavigation: Boolean(requestedTab),
  })) return;
  contentWrapper.innerHTML = trustedHTML("");
  switch (this._currentWorkflowTab) {
    case "preparation": {
      const { renderPreparationDetailsPanel } = await import("./detail/PreparationDetailsPanel.js");
      if (!isCurrentRender()) return;
      renderPreparationDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    }
    case "preparation_action": {
      const { renderPreparationActionPanel } = await import("./detail/PreparationPanel.js");
      if (!isCurrentRender()) return;
      renderPreparationActionPanel(contentWrapper, gt);
      break;
    }
    case "goods": {
      const { renderPackageGoodsPanel } = await import("./PackageGoodsWorkflow.js");
      if (!isCurrentRender()) return;
      await renderPackageGoodsPanel(this, { contentWrapper, pkg: gt });
      break;
    }
    case "opening":
    case "opening_tech": {
      const { renderPackageOpeningPanel } = await import("./detail/PackageOpeningPanel.js");
      if (!isCurrentRender()) return;
      renderPackageOpeningPanel(this, { contentWrapper, pkg: gt, appController });
      break;
    }
    case "eval_tech": {
      const { renderTechnicalEvaluationPanel } = await import("./detail/TechnicalEvaluationPanel.js");
      if (!isCurrentRender()) return;
      renderTechnicalEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      publishEvaluationTab(appController, "technical");
      break;
    }
    case "eval_fin": {
      const { renderFinancialEvaluationPanel } = await import("./detail/FinancialEvaluationPanel.js");
      if (!isCurrentRender()) return;
      renderFinancialEvaluationPanel(contentWrapper, gt, { inviteComparisonLabel, comparisonLabel });
      publishEvaluationTab(appController, "financial");
      break;
    }
    case "qualified": {
      const { renderQualifiedApprovalPanel } = await import("./detail/QualifiedApprovalPanel.js");
      if (!isCurrentRender()) return;
      renderQualifiedApprovalPanel(this, {
        contentWrapper,
        pkg: gt,
        isTechEvalSaved,
        effectiveStatus: effectivePackageStatus,
        appController,
      });
      break;
    }
    case "opening_fin": {
      const { renderFinancialOpeningPanel } = await import("./detail/FinancialOpeningPanel.js");
      if (!isCurrentRender()) return;
      renderFinancialOpeningPanel(this, {
        contentWrapper,
        pkg: gt,
        effectiveStatus: effectivePackageStatus,
        appController,
      });
      break;
    }
    case "result": {
      const { renderAwardResultDetailsPanel } = await import("./detail/AwardResultDetailsPanel.js");
      if (!isCurrentRender()) return;
      renderAwardResultDetailsPanel(this, { contentWrapper, gt, id, isEditable, appController });
      break;
    }
    case "cancel": {
      const [
        { renderCancellationPanel },
        { savePackageCancellation },
      ] = await Promise.all([
        import("./detail/CancellationPanel.js"),
        import("./packageCancellation.js"),
      ]);
      if (!isCurrentRender()) return;
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
          completePackageWorkspaceEdit(this);
          await this.customAlert("Thành công", "Đã lưu quyết định hủy thầu và cập nhật trạng thái gói thầu.", "check-circle");
          await this.showPackageDetails(gt.id);
        }
      });
      break;
    }
    case "documents": {
      const { renderPackageDocumentsPanel } = await import("./detail/PackageDocumentsPanel.js");
      if (!isCurrentRender()) return;
      await renderPackageDocumentsPanel(this, {
        contentWrapper,
        packageId: gt.id,
        pkg: gt,
      });
      break;
    }
    case "activity": {
      const { renderActivityTimeline } = await import("../shared/ActivityTimeline.js");
      if (!isCurrentRender()) return;
      contentWrapper.innerHTML = trustedHTML('<section class="activity-panel" aria-label="Lịch sử chỉnh sửa"><h3>Lịch sử chỉnh sửa</h3><div data-activity-timeline></div></section>');
      await renderActivityTimeline(contentWrapper.querySelector("[data-activity-timeline]"), {
        targetType: "goithau",
        targetId: gt.id,
        isCurrent: () => String(this._currentWorkflowPackageId) === String(gt.id)
          && this._currentWorkflowTab === "activity",
      });
      break;
    }
  }
  this.createIconsScoped?.(contentWrapper);
  appController?.setupExcelImportEvents?.();
  ["mothau-goithau-select", "danhgiahsdt-goithau-select", "result-goithau-select"].forEach((selectId) => {
    const wrapper = document.querySelector(`.custom-select-wrapper[data-select-id="${selectId}"]`);
    if (wrapper) wrapper.remove();
    const container = document.querySelector(`.custom-select-container[data-target="${selectId}"]`);
    if (container) container.remove();
  });
  appController?.unifyTableInputsHeight?.(document);
  // Expose a semantic readiness signal for route-owned consumers and E2E
  // synchronization.  It is written only after the requested panel and its
  // bindings have finished rendering, so callers cannot race a late render.
  markRenderedDetail(this, gt, renderVersion);
}
