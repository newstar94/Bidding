import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { renderDetailedEvaluationPanel } from "./detail/DetailedEvaluationPanel.js";
import {
  bindDetailedEvaluationPanelController,
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
  confirmDetailedEvaluationDiscard,
} from "./DetailedEvaluationPanelController.js";
import {
  addDetailedEvaluationCriterion as addDetailedEvaluationCriterionWithController,
  removeDetailedEvaluationCriterion,
} from "./DetailedEvaluationCriteriaController.js";
import {
  getDetailedEvaluationProgress,
  getEvaluationRoundType,
  isDetailedEvaluationSummaryOwned,
} from "./detailedEvaluationSelectors.js";
import {
  applyDetailedEvaluationProjection,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
  resolveDetailedEvaluationState,
} from "./DetailedEvaluationState.js";
import { BIDDER_GOODS_TAB } from "./bidderGoodsSelectors.js";
import {
  getForcedTechnicalEvaluationMethod,
  normalizeTechnicalEvaluationMethod,
} from "./technicalEvaluationMethod.js";
import {
  clearDetailedEvaluationNavigation,
  syncDetailedEvaluationNavigation,
} from "./detailedEvaluationNavigation.js";


export {
  applyDetailedEvaluationProjection,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
};

export { collectActiveGroupRows, collectConfiguredDetailedEvaluationCriteria };

export async function addDetailedEvaluationCriterion(parentCriterionId = "") {
  return addDetailedEvaluationCriterionWithController(this, parentCriterionId);
}

export async function setDetailedTechnicalEvaluationMethod(method) {
  const state = resolveDetailedEvaluationState(this);
  const normalizedMethod = normalizeTechnicalEvaluationMethod(method);
  if (!state?.report || state.readOnly || this.selectedDetailedEvaluationTab !== "technical"
    || !normalizedMethod || getForcedTechnicalEvaluationMethod(state.pkg)) return false;
  this._technicalEvaluationMethodDrafts = this._technicalEvaluationMethodDrafts || new Map();
  this._technicalEvaluationMethodDrafts.set(state.criteriaKey, normalizedMethod);
  this._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    extension: {
      ...(state.report.extension || {}),
      technicalEvaluationMethod: normalizedMethod,
    },
  });
  this._detailedEvaluationDirty = true;
  await this.renderDetailedEvaluation();
  return true;
}

export async function openDetailedEvaluation() {
  this.currentEvaluationView = "contractor-detail";
  this.selectedDetailedEvaluationTab = this.selectedDetailedEvaluationTab || "validity";
  this._detailedEvaluationDirty = false;
  return this.renderDetailedEvaluation();
}

export async function closeDetailedEvaluation() {
  if (!await confirmDetailedEvaluationDiscard(this)) return false;
  this.currentEvaluationView = "summary";
  this._detailedEvaluationDirty = false;
  clearDetailedEvaluationNavigation();
  const summary = this.view.getActiveElement("danhgiahsdt-summary-view");
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  summary?.classList.remove("is-hidden");
  detail?.classList.add("is-hidden");
  setRuntimeStyle(summary, "display", "block");
  setRuntimeStyle(detail, "display", "none");
  return true;
}

export async function renderDetailedEvaluation() {
  const contextGeneration = (this._detailedEvaluationContextGeneration || 0) + 1;
  this._detailedEvaluationContextGeneration = contextGeneration;
  const state = resolveDetailedEvaluationState(this);
  const summary = this.view.getActiveElement("danhgiahsdt-summary-view");
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  if (!state || !detail) return;
  summary?.classList.add("is-hidden");
  detail.classList.remove("is-hidden");
  setRuntimeStyle(summary, "display", "none");
  setRuntimeStyle(detail, "display", "block");
  const groupCriteria = state.criteria.filter(
    (criterion) => criterion.group === this.selectedDetailedEvaluationTab,
  );
  const progress = getDetailedEvaluationProgress(state.report, state.criteria);
  const warning = state.report?.trangThai === "draft"
    && isDetailedEvaluationSummaryOwned(state.report)
    ? "Báo cáo chi tiết đang được chỉnh sửa. Kết quả tổng hợp chưa được cập nhật."
    : "";
  let bidderGoodsWorkflow = null;
  let bidderGoodsMarkup = "";
  if (this.selectedDetailedEvaluationTab === BIDDER_GOODS_TAB) {
    bidderGoodsWorkflow = await import("./BidderGoodsWorkflow.js");
    bidderGoodsWorkflow.initializeBidderGoodsFromRequirements(this, state);
    bidderGoodsMarkup = bidderGoodsWorkflow.renderBidderGoodsPanelMarkup(
      bidderGoodsWorkflow.buildBidderGoodsPanelState(this, state),
    );
  }
  renderDetailedEvaluationPanel(detail, {
    ...state,
    activeGroup: this.selectedDetailedEvaluationTab,
    criteria: groupCriteria,
    progress,
    warning,
    bidderGoodsMarkup,
    editingCriterionIds: this._detailedEvaluationEditingCriteria?.get(state.draftKey) || new Set(),
  });
  bindDetailedEvaluationPanelController({
    appController: this,
    root: detail,
    state,
    commands: {
      close: () => this.closeDetailedEvaluation(),
      render: () => this.renderDetailedEvaluation(),
      save: (options) => this.saveDetailedEvaluation(options),
      importExcel: (file) => importDetailedEvaluationExcel.call(this, file),
      addCriterion: (parentCriterionId = "") => addDetailedEvaluationCriterion.call(this, parentCriterionId),
      removeCriterion: (criterionId) => removeDetailedEvaluationCriterion(this, criterionId),
      setTechnicalMethod: (method) => setDetailedTechnicalEvaluationMethod.call(this, method),
    },
  });
  bidderGoodsWorkflow?.bindBidderGoodsPanel(this, state, detail);
  syncDetailedEvaluationNavigation(this, state.pkg.id);
}

export async function importDetailedEvaluationExcel(file) {
  const state = resolveDetailedEvaluationState(this);
  if (!state?.bid || !state.report || state.readOnly) return false;
  const generation = (this._detailedEvaluationImportGeneration || 0) + 1;
  this._detailedEvaluationImportGeneration = generation;
  const importContext = Object.freeze({
    generation,
    contextGeneration: this._detailedEvaluationContextGeneration || 0,
    packageId: String(state.pkg.id || ""),
    bidId: String(state.bid.id || ""),
    roundType: String(state.roundType || ""),
    activeGroup: String(this.selectedDetailedEvaluationTab || ""),
    view: this.currentEvaluationView,
    packageRenderGeneration: this.view._packageDetailRenderVersion || 0,
    packageRowVersion: state.pkg.rowVersion,
    bidRowVersion: state.bid.rowVersion,
    workspaceToken: this.model.getWorkspaceToken?.() || this.getWorkspaceToken?.() || "",
  });
  let expectedContextGeneration = importContext.contextGeneration;
  let commitStarted = false;
  const isCurrentImport = () => {
    if (this._detailedEvaluationImportGeneration !== importContext.generation
      || (this._detailedEvaluationContextGeneration || 0) !== expectedContextGeneration
      || String(this.selectedEvaluationBidId || "") !== importContext.bidId
      || String(this.selectedDetailedEvaluationTab || "") !== importContext.activeGroup
      || this.currentEvaluationView !== importContext.view
      || (this.view._packageDetailRenderVersion || 0) !== importContext.packageRenderGeneration) {
      return false;
    }
    const selectedPackageId = this.view.getActiveElement("danhgiahsdt-goithau-select")?.value
      || this.view._currentWorkflowPackageId
      || this._currentWorkflowPackageId
      || "";
    if (String(selectedPackageId) !== importContext.packageId) return false;
    if (importContext.workspaceToken && this.model.isWorkspaceCurrent
      && !this.model.isWorkspaceCurrent(importContext.workspaceToken)) return false;
    const currentWorkspaceToken = this.model.getWorkspaceToken?.() || this.getWorkspaceToken?.() || "";
    if (currentWorkspaceToken !== importContext.workspaceToken) return false;
    const currentPackage = (this.model.state.goithau || []).find(
      (item) => String(item.id || "") === importContext.packageId,
    );
    const currentBid = (this.model.state.thongtinmothau || []).find(
      (item) => String(item.id || "") === importContext.bidId,
    );
    if (!currentPackage || !currentBid || String(currentBid.goiThauId || "") !== importContext.packageId) {
      return false;
    }
    if (!commitStarted && (currentPackage !== state.pkg || currentBid !== state.bid
      || currentPackage.rowVersion !== importContext.packageRowVersion
      || currentBid.rowVersion !== importContext.bidRowVersion)) return false;
    if (getEvaluationRoundType(currentPackage, this.currentDanhGiaTab) !== importContext.roundType) return false;
    const actorId = this.model.state.activeuser?.id || "";
    if (this.model.hasPermission?.(actorId, "goithau", "edit") === false
      || this.model.hasPermission?.(actorId, "thongtinmothau", "edit") === false) return false;
    return true;
  };
  const cancelStaleImport = () => {
    if (!importContext.workspaceToken || this.model.isWorkspaceCurrent?.(importContext.workspaceToken) !== false) {
      this.view.showToast?.(
        "Đã hủy nhập Excel",
        "Màn hình đánh giá đã thay đổi. Tác vụ nhập đã dừng; vui lòng kiểm tra dữ liệu trước khi nhập lại.",
        "warning",
      );
    }
    return false;
  };
  try {
    const [
      { readExcelWorkbookSheets },
      { analyzeDetailedEvaluationWorkbook },
    ] = await Promise.all([
      import("../documents/excelFileReader.js"),
      import("./DetailedEvaluationImport.js"),
    ]);
    if (!isCurrentImport()) return cancelStaleImport();
    const sheets = await readExcelWorkbookSheets(file);
    if (!isCurrentImport()) return cancelStaleImport();
    const analysis = analyzeDetailedEvaluationWorkbook({
      state,
      sheets,
      activeGroup: importContext.activeGroup,
      currentCriteriaOverride: this._detailedEvaluationCriteriaOverrides.get(state.criteriaKey),
    });
    if (analysis.isMuasamcong) {
      const verified = await verifyMuasamcongDetailedEvaluationContractor(
        this,
        state,
        sheets,
        isCurrentImport,
      );
      if (!isCurrentImport()) return cancelStaleImport();
      if (!verified) return false;
    }
    if (!isCurrentImport()) return cancelStaleImport();
    if (!analysis.report) {
      await this.view.customAlert(
        "Không tìm thấy tiêu chí phù hợp",
        "Excel cần có cột STT, Mã tiêu chí hoặc Tiêu chí/Yêu cầu trùng với tab đang mở.",
        "alert-triangle",
      );
      return false;
    }
    if (analysis.criteriaOverride) {
      this._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, analysis.criteriaOverride);
    }
    if (!isCurrentImport()) return cancelStaleImport();
    this._detailedEvaluationDrafts.set(state.draftKey, analysis.report);
    this._detailedEvaluationDirty = true;
    const generationBeforeRender = this._detailedEvaluationContextGeneration || 0;
    await this.renderDetailedEvaluation();
    const generationAfterRender = this._detailedEvaluationContextGeneration || 0;
    if (generationAfterRender !== generationBeforeRender
      && generationAfterRender !== generationBeforeRender + 1) return cancelStaleImport();
    expectedContextGeneration = generationAfterRender;
    if (!isCurrentImport()) return cancelStaleImport();
    const persisted = await saveDetailedEvaluation.call(this, {
      notify: false,
      isContextCurrent: isCurrentImport,
      beforeContextRender: () => {
        commitStarted = true;
      },
      afterContextRender: () => {
        expectedContextGeneration = this._detailedEvaluationContextGeneration || 0;
      },
      beforeContextCommit: () => {
        commitStarted = true;
      },
    });
    if (!isCurrentImport()) return cancelStaleImport();
    if (!persisted) return false;
    const { matched, skipped, warnings: warningCount, sheetNames } = analysis.stats;
    await this.view.customAlert(
      "Đã nhập dữ liệu Excel",
      `Đã tự điền và lưu nháp ${matched} tiêu chí${sheetNames ? ` từ các sheet: ${sheetNames}` : " trong tab hiện tại"}.${skipped ? ` Bỏ qua ${skipped} dòng không khớp.` : ""}${warningCount ? ` Có ${warningCount} kết quả cần kiểm tra lại.` : ""}`,
      warningCount || skipped ? "alert-triangle" : "check-circle",
    );
    return true;
  } catch (error) {
    if (!isCurrentImport()) return cancelStaleImport();
    console.error(error);
    await this.view.customAlert(
      "Không thể đọc Excel",
      error?.message || "Vui lòng kiểm tra lại định dạng tệp Excel.",
      "alert-triangle",
    );
    return false;
  }
}

export async function verifyMuasamcongDetailedEvaluationContractor(
  controller,
  state,
  sheets,
  isContextCurrent = null,
) {
  const [
    { validateMuasamcongContractorIdentity },
    { resolveBidContractorName },
  ] = await Promise.all([
    import("./detailedEvaluationExcel.js"),
    import("../partners/contractorVersionBinding.js"),
  ]);
  if (isContextCurrent && !isContextCurrent()) return false;
  const selectedContractorName = resolveBidContractorName(controller.model, state.bid)
    || String(state.bid?.tenNhaThau || "").trim();
  const identity = validateMuasamcongContractorIdentity(sheets, selectedContractorName);
  if (identity.valid) return true;
  const message = identity.reason === "mismatch"
    ? `Tên nhà thầu trong Excel: "${identity.actualNames[0]}". Nhà thầu đang chọn: "${identity.expectedName}". Hãy kiểm tra kỹ trước khi tiếp tục.`
    : identity.reason === "conflicting-workbook-names"
      ? `File Excel chứa nhiều tên nhà thầu: ${identity.actualNames.join("; ")}. Nhà thầu đang chọn: "${identity.expectedName || "Không xác định"}". Hãy kiểm tra kỹ trước khi tiếp tục.`
      : identity.reason === "missing-selected-name"
        ? `Tên nhà thầu trong Excel: "${identity.actualNames.join("; ") || "Không xác định"}". Không xác định được tên nhà thầu đang chọn để đối chiếu. Hãy kiểm tra kỹ trước khi tiếp tục.`
        : `Không tìm thấy tên nhà thầu trong file Excel. Nhà thầu đang chọn: "${identity.expectedName || "Không xác định"}". Hãy kiểm tra kỹ trước khi tiếp tục.`;
  const confirmed = await controller.view.customConfirm(
    identity.reason === "mismatch" ? "Sai nhà thầu trong file Excel" : "Không thể xác minh nhà thầu",
    message,
    "alert-triangle",
    {
      confirmLabel: "Vẫn nhập",
      cancelLabel: "Hủy",
    },
  );
  if (isContextCurrent && !isContextCurrent()) return false;
  return confirmed === true;
}

export async function saveDetailedEvaluation({
  completeGroup = false,
  completeReport = false,
  notify = true,
  isContextCurrent = null,
  beforeContextRender = null,
  afterContextRender = null,
  beforeContextCommit = null,
} = {}) {
  if (isContextCurrent && !isContextCurrent()) return false;
  const state = resolveDetailedEvaluationState(this);
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  const { executeDetailedEvaluationSave } = await import("./DetailedEvaluationSaveWorkflow.js");
  if (isContextCurrent && !isContextCurrent()) return false;
  return executeDetailedEvaluationSave({
    appController: this,
    state,
    root: detail,
    activeGroup: this.selectedDetailedEvaluationTab,
    completeGroup,
    completeReport,
    notify,
    isContextCurrent,
    beforeContextRender,
    afterContextRender,
    beforeContextCommit,
  });
}
