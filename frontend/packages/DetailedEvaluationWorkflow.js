import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { readExcelWorkbookSheets } from "../documents/excelFileReader.js";
import { renderDetailedEvaluationPanel } from "./detail/DetailedEvaluationPanel.js";
import {
  bindDetailedEvaluationPanelController,
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
  confirmDetailedEvaluationDiscard,
} from "./DetailedEvaluationPanelController.js";
import {
  validateMuasamcongContractorIdentity,
} from "./detailedEvaluationExcel.js";
import { resolveBidContractorName } from "../partners/contractorVersionBinding.js";
import { analyzeDetailedEvaluationWorkbook } from "./DetailedEvaluationImport.js";
import {
  addDetailedEvaluationCriterion as addDetailedEvaluationCriterionWithController,
  removeDetailedEvaluationCriterion,
} from "./DetailedEvaluationCriteriaController.js";
import {
  getDetailedEvaluationProgress,
  isDetailedEvaluationSummaryOwned,
} from "./detailedEvaluationSelectors.js";
import { executeDetailedEvaluationSave } from "./DetailedEvaluationSaveWorkflow.js";
import {
  applyDetailedEvaluationProjection,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
  resolveDetailedEvaluationState,
} from "./DetailedEvaluationState.js";


export {
  applyDetailedEvaluationProjection,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
};

export { collectActiveGroupRows, collectConfiguredDetailedEvaluationCriteria };

export async function addDetailedEvaluationCriterion() {
  return addDetailedEvaluationCriterionWithController(this);
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
  const summary = this.view.getActiveElement("danhgiahsdt-summary-view");
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  summary?.classList.remove("is-hidden");
  detail?.classList.add("is-hidden");
  setRuntimeStyle(summary, "display", "block");
  setRuntimeStyle(detail, "display", "none");
  return true;
}

export async function renderDetailedEvaluation() {
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
  renderDetailedEvaluationPanel(detail, {
    ...state,
    activeGroup: this.selectedDetailedEvaluationTab,
    criteria: groupCriteria,
    progress,
    warning,
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
      addCriterion: () => addDetailedEvaluationCriterion.call(this),
      removeCriterion: (criterionId) => removeDetailedEvaluationCriterion(this, criterionId),
    },
  });
}

export async function importDetailedEvaluationExcel(file) {
  const state = resolveDetailedEvaluationState(this);
  if (!state?.bid || !state.report || state.readOnly) return false;
  try {
    const sheets = await readExcelWorkbookSheets(file);
    const analysis = analyzeDetailedEvaluationWorkbook({
      state,
      sheets,
      activeGroup: this.selectedDetailedEvaluationTab,
      currentCriteriaOverride: this._detailedEvaluationCriteriaOverrides.get(state.criteriaKey),
    });
    if (analysis.isMuasamcong
      && !await verifyMuasamcongDetailedEvaluationContractor(this, state, sheets)) {
      return false;
    }
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
    this._detailedEvaluationDrafts.set(state.draftKey, analysis.report);
    this._detailedEvaluationDirty = true;
    this.renderDetailedEvaluation();
    const { matched, skipped, warnings: warningCount, sheetNames } = analysis.stats;
    await this.view.customAlert(
      "Đã nhập dữ liệu Excel",
      `Đã tự điền ${matched} tiêu chí${sheetNames ? ` từ các sheet: ${sheetNames}` : " trong tab hiện tại"}.${skipped ? ` Bỏ qua ${skipped} dòng không khớp.` : ""}${warningCount ? ` Có ${warningCount} kết quả cần kiểm tra lại.` : ""} Dữ liệu chưa được lưu.`,
      warningCount || skipped ? "alert-triangle" : "check-circle",
    );
    return true;
  } catch (error) {
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
) {
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
  return confirmed === true;
}

export async function saveDetailedEvaluation({
  completeGroup = false,
  completeReport = false,
} = {}) {
  const state = resolveDetailedEvaluationState(this);
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  return executeDetailedEvaluationSave({
    appController: this,
    state,
    root: detail,
    activeGroup: this.selectedDetailedEvaluationTab,
    completeGroup,
    completeReport,
  });
}
