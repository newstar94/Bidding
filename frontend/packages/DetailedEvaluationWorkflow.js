import { aggregateDetailedEvaluationReport } from "./detailedEvaluationAggregation.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { persistAndSync } from "../shared/MutationService.js";
import { renderDetailedEvaluationPanel } from "./detail/DetailedEvaluationPanel.js";
import { resolveDetailedEvaluationContext } from "./detailedEvaluationRules.js";
import {
  getCriteriaForGroup,
  getDetailedEvaluationBidLabel,
  getDetailedEvaluationProgress,
  getDetailedReportForRound,
  getEligibleFinancialEvaluationBids,
  getEvaluationRoundType,
  getPackageEvaluationBids,
  isDetailedEvaluationSummaryOwned,
} from "./detailedEvaluationSelectors.js";
import {
  validateDetailedEvaluationGroup,
  validateDetailedEvaluationReport,
} from "./detailedEvaluationValidation.js";
import { getPackageWorkflowState } from "./detail/PackageTabs.js";
import { resolvePackageResultStatus } from "./lotEvaluationScope.js";


export function buildDetailedEvaluationDraft({
  pkg,
  bid,
  roundType,
  criteria = [],
} = {}) {
  const roundId = `evaluation-round:${String(pkg?.id || "")}:${roundType}`;
  const reportId = `detailed-evaluation:${String(bid?.id || "")}:${roundId}`;
  return {
    id: reportId,
    vongDanhGiaId: roundId,
    loaiVong: roundType,
    trangThai: "draft",
    ketLuan: "",
    nguoiChamId: null,
    hoanThanhLuc: null,
    chiTietList: criteria.map((criterion) => ({
      id: `detailed-evaluation-row:${reportId}:${criterion.id}`,
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pending",
      diem: null,
      noiDungHsdt: "",
      nhanXet: "",
      lyDoKhongDat: "",
      yeuCauLamRo: "",
      ketQuaLamRo: "",
      taiLieuThamChieu: "",
    })),
  };
}

export function buildReopenedDetailedEvaluationReport(report = {}) {
  const extension = report.extension && typeof report.extension === "object"
    ? { ...report.extension }
    : {};
  extension.projectionPending = true;
  return {
    ...report,
    trangThai: "draft",
    hoanThanhLuc: null,
    extension,
  };
}

const GROUP_PROJECTION_FIELDS = Object.freeze({
  validity: Object.freeze({
    result: "danhGiaHopLe",
    reason: "nguyenNhanKhongDatHopLe",
    clarification: "lamRoHopLe",
  }),
  capacity: Object.freeze({
    result: "danhGiaNangLuc",
    reason: "nguyenNhanKhongDatNangLuc",
    clarification: "lamRoNangLuc",
  }),
  technical: Object.freeze({
    result: "danhGiaKyThuat",
    reason: "nguyenNhanKhongDatKyThuat",
    clarification: "lamRoKyThuat",
  }),
  financial: Object.freeze({
    result: "danhGiaTaiChinh",
    reason: null,
    clarification: "lamRoTaiChinh",
  }),
});

export function applyDetailedEvaluationProjection(
  bid,
  report,
  criteria,
  groups,
) {
  if (report?.trangThai !== "completed") return bid;
  const aggregation = aggregateDetailedEvaluationReport({
    report,
    criteria,
    groups,
  });
  const projected = { ...bid };
  Object.entries(aggregation.byGroup).forEach(([group, result]) => {
    const fields = GROUP_PROJECTION_FIELDS[group];
    if (!fields) return;
    projected[fields.result] = result.status;
    if (fields.reason) projected[fields.reason] = result.failureReason;
    if (fields.clarification) projected[fields.clarification] = result.clarification;
  });
  projected.danhGiaKetLuan = aggregation.overall.status;
  projected.diemDanhGia = aggregation.overall.score;
  projected.lyDoTruot = aggregation.overall.failureReason;
  return projected;
}

function parseMetadata(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function detailedEvaluationState(controller) {
  const packageId = controller.view.getActiveElement("danhgiahsdt-goithau-select")?.value
    || controller._currentWorkflowPackageId;
  const pkg = controller.model.state.goithau.find(
    (item) => String(item.id) === String(packageId || ""),
  );
  if (!pkg) return null;
  const roundType = getEvaluationRoundType(pkg, controller.currentDanhGiaTab);
  const context = resolveDetailedEvaluationContext(pkg, roundType);
  const rawBids = context.contractorFilter === "technical-qualified"
    ? getEligibleFinancialEvaluationBids(controller.model, pkg)
    : getPackageEvaluationBids(controller.model, pkg);
  const bids = rawBids.map((bid) => ({
    ...bid,
    label: getDetailedEvaluationBidLabel(controller.model, bid),
  }));
  if (!bids.some((bid) => String(bid.id) === String(controller.selectedEvaluationBidId))) {
    controller.selectedEvaluationBidId = bids[0]?.id || null;
  }
  if (!context.visibleGroups.includes(controller.selectedDetailedEvaluationTab)) {
    controller.selectedDetailedEvaluationTab = context.visibleGroups[0] || "validity";
  }
  const bid = rawBids.find(
    (item) => String(item.id) === String(controller.selectedEvaluationBidId),
  ) || null;
  const draftKey = `${pkg.id}:${bid?.id || ""}:${roundType}`;
  controller._detailedEvaluationDrafts = controller._detailedEvaluationDrafts || new Map();
  let report = bid ? getDetailedReportForRound(bid, roundType) : null;
  let criteria = context.visibleGroups.flatMap(
    (group) => getCriteriaForGroup(pkg, roundType, group),
  );
  if (controller._detailedEvaluationDrafts.has(draftKey)) {
    report = controller._detailedEvaluationDrafts.get(draftKey);
  } else if (bid && !report) {
    report = buildDetailedEvaluationDraft({ pkg, bid, roundType, criteria });
    controller._detailedEvaluationDrafts.set(draftKey, report);
  }
  const workflowState = getPackageWorkflowState(pkg, rawBids);
  const effectiveStatus = resolvePackageResultStatus(pkg);
  const actorId = controller.model.state.activeuser?.id || "";
  const canEdit = controller.model.hasPermission?.(actorId, "goithau", "edit") !== false
    && controller.model.hasPermission?.(actorId, "thongtinmothau", "edit") !== false;
  const lockedByCompletedRound = (
    roundType === "single"
      && (
        workflowState.isSingleEnvelopeEvalSaved
        || workflowState.isSingleEnvelopeScopedEvalSaved
      )
  ) || (roundType === "technical" && workflowState.isTechEvalSaved)
    || (roundType === "financial" && workflowState.isFinEvalSaved);
  const lockedByStage = ["Đã có kết quả", "Hủy thầu"].includes(effectiveStatus)
    || lockedByCompletedRound
    || (roundType === "technical" && workflowState.isQualifiedSaved)
    || (roundType === "financial" && !workflowState.isFinOpeningSaved);
  const editingKey = controller._editingDetailedEvaluationKey;
  const canReopen = canEdit && !lockedByStage && report?.trangThai === "completed";
  const readOnly = !canEdit || lockedByStage
    || (report?.trangThai === "completed" && editingKey !== draftKey);
  return {
    pkg,
    context,
    bids,
    rawBids,
    bid,
    selectedBidId: controller.selectedEvaluationBidId,
    roundType,
    criteria,
    report,
    draftKey,
    readOnly,
    canReopen,
  };
}

function collectActiveGroupRows(container, report, criteria) {
  const existing = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = element.getAttribute("data-detailed-criterion-id");
    const criterion = criteria.find((item) => String(item.id) === String(criterionId));
    if (!criterion) return;
    const value = (field) => element.querySelector(`[data-detailed-field="${field}"]`)?.value ?? "";
    const scoreValue = value("diem");
    let result = value("ketQua") || "pending";
    if (criterion.resultType === "text") result = value("nhanXet").trim() ? "pass" : "pending";
    if (criterion.resultType === "number") result = scoreValue !== "" ? "pass" : "pending";
    const previous = existing.get(String(criterionId)) || {};
    existing.set(String(criterionId), {
      ...previous,
      id: previous.id || `detailed-evaluation-row:${report.id}:${criterionId}`,
      tieuChiDanhGiaId: criterionId,
      ketQua: result,
      diem: scoreValue === "" ? null : Number(scoreValue),
      noiDungHsdt: value("noiDungHsdt"),
      nhanXet: value("nhanXet"),
      lyDoKhongDat: value("lyDoKhongDat"),
      yeuCauLamRo: value("yeuCauLamRo"),
      ketQuaLamRo: value("ketQuaLamRo"),
      taiLieuThamChieu: value("taiLieuThamChieu"),
    });
  });
  return [...existing.values()];
}

function persistCriteriaOnFirstSave(pkg, roundType, criteria, context = {}) {
  const metadata = parseMetadata(pkg.danhGiaHsdtMetadata);
  const isLegacyCriteria = (value) => Array.isArray(value)
    && value.length > 0
    && value.every((criterion) => [
      "VALIDITY_SUMMARY",
      "CAPACITY_SUMMARY",
      "TECHNICAL_SUMMARY",
      "FINANCIAL_SUMMARY",
    ].includes(String(criterion?.code || "").toUpperCase()));
  const templateInfo = {
    templateId: context.templateId || criteria.find((item) => item.templateId)?.templateId || "",
    templateVersion: context.templateVersion
      || criteria.find((item) => item.templateVersion)?.templateVersion
      || null,
  };
  if (roundType === "single") {
    if (!Array.isArray(metadata.criteria)
      || metadata.criteria.length === 0
      || isLegacyCriteria(metadata.criteria)) {
      metadata.criteria = criteria;
    }
    if (templateInfo.templateId && !metadata.templateId) metadata.templateId = templateInfo.templateId;
    if (templateInfo.templateVersion && !metadata.templateVersion) {
      metadata.templateVersion = templateInfo.templateVersion;
    }
  } else {
    metadata.is1G2T = true;
    metadata[roundType] = metadata[roundType] && typeof metadata[roundType] === "object"
      ? metadata[roundType]
      : {};
    if (!Array.isArray(metadata[roundType].criteria)
      || metadata[roundType].criteria.length === 0
      || isLegacyCriteria(metadata[roundType].criteria)) {
      metadata[roundType].criteria = criteria;
    }
    if (templateInfo.templateId && !metadata[roundType].templateId) {
      metadata[roundType].templateId = templateInfo.templateId;
    }
    if (templateInfo.templateVersion && !metadata[roundType].templateVersion) {
      metadata[roundType].templateVersion = templateInfo.templateVersion;
    }
  }
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
}

async function confirmDiscard(controller) {
  if (!controller._detailedEvaluationDirty) return true;
  return controller.view.customConfirm(
    "Chưa lưu thay đổi",
    "Các thay đổi trong báo cáo chi tiết chưa được lưu. Bạn có muốn bỏ các thay đổi này?",
    "alert-triangle",
  );
}

export async function openDetailedEvaluation() {
  this.currentEvaluationView = "contractor-detail";
  this.selectedDetailedEvaluationTab = this.selectedDetailedEvaluationTab || "validity";
  this._detailedEvaluationDirty = false;
  return this.renderDetailedEvaluation();
}

export async function closeDetailedEvaluation() {
  if (!await confirmDiscard(this)) return false;
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
  const state = detailedEvaluationState(this);
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
  detail.querySelector("#btn-detailed-evaluation-back")?.addEventListener(
    "click",
    () => this.closeDetailedEvaluation(),
  );
  const select = detail.querySelector("#detailed-evaluation-bid-select");
  if (select) select.onchange = async () => {
    if (!await confirmDiscard(this)) {
      select.value = this.selectedEvaluationBidId || "";
      return;
    }
    this.selectedEvaluationBidId = select.value;
    this._detailedEvaluationDirty = false;
    this.renderDetailedEvaluation();
  };
  const groupButtons = [...detail.querySelectorAll("[data-detailed-evaluation-group]")];
  groupButtons.forEach((button, buttonIndex) => {
    button.addEventListener("click", async () => {
      if (!await confirmDiscard(this)) return;
      this.selectedDetailedEvaluationTab = button.getAttribute("data-detailed-evaluation-group");
      this._detailedEvaluationDirty = false;
      this.renderDetailedEvaluation();
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const targetIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? groupButtons.length - 1
          : (buttonIndex + (event.key === "ArrowRight" ? 1 : -1) + groupButtons.length)
            % groupButtons.length;
      groupButtons[targetIndex]?.focus();
      groupButtons[targetIndex]?.click();
    });
  });
  const moveBid = async (offset) => {
    if (!await confirmDiscard(this)) return;
    const index = state.bids.findIndex(
      (bid) => String(bid.id) === String(this.selectedEvaluationBidId),
    );
    const target = state.bids[index + offset];
    if (!target) return;
    this.selectedEvaluationBidId = target.id;
    this._detailedEvaluationDirty = false;
    this.renderDetailedEvaluation();
  };
  detail.querySelector("#btn-detailed-evaluation-previous")?.addEventListener("click", () => moveBid(-1));
  detail.querySelector("#btn-detailed-evaluation-next")?.addEventListener("click", () => moveBid(1));
  detail.querySelectorAll("input, select, textarea").forEach((input) => {
    input.addEventListener("input", () => { this._detailedEvaluationDirty = true; });
    input.addEventListener("change", () => { this._detailedEvaluationDirty = true; });
  });
  detail.querySelector("#btn-detailed-evaluation-save-draft")?.addEventListener(
    "click",
    () => this.saveDetailedEvaluation(),
  );
  detail.querySelector("#btn-detailed-evaluation-complete-group")?.addEventListener(
    "click",
    () => this.saveDetailedEvaluation({ completeGroup: true }),
  );
  detail.querySelector("#btn-detailed-evaluation-complete-report")?.addEventListener(
    "click",
    () => this.saveDetailedEvaluation({ completeReport: true }),
  );
  detail.querySelector("#btn-detailed-evaluation-reopen")?.addEventListener("click", () => {
    this._editingDetailedEvaluationKey = state.draftKey;
    const editable = buildReopenedDetailedEvaluationReport(state.report);
    this._detailedEvaluationDrafts.set(state.draftKey, editable);
    this.renderDetailedEvaluation();
  });
  this.view.createIconsScoped?.(detail);
}

export async function saveDetailedEvaluation({
  completeGroup = false,
  completeReport = false,
} = {}) {
  const state = detailedEvaluationState(this);
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  if (!state?.bid || !state.report || !detail || state.readOnly) return false;
  const groupCriteria = state.criteria.filter(
    (criterion) => criterion.group === this.selectedDetailedEvaluationTab,
  );
  const report = {
    ...state.report,
    trangThai: completeReport ? "completed" : "draft",
    hoanThanhLuc: completeReport ? new Date().toISOString() : null,
    chiTietList: collectActiveGroupRows(detail, state.report, groupCriteria),
  };
  report.extension = {
    ...(report.extension || {}),
    completedGroups: [...new Set([
      ...(report.extension?.completedGroups || []),
      ...(completeGroup ? [this.selectedDetailedEvaluationTab] : []),
    ])],
  };
  if (completeReport) delete report.extension.projectionPending;
  const validation = completeReport
    ? validateDetailedEvaluationReport(report, state.context, state.criteria)
    : validateDetailedEvaluationGroup(
      report.chiTietList,
      groupCriteria,
      { completing: completeGroup },
    );
  if (!validation.valid) {
    const first = validation.errors[0];
    const row = detail.querySelector(`[data-detailed-criterion-id="${first.criterionId}"]`);
    const field = row?.querySelector(`[data-detailed-field="${first.field}"]`);
    field?.focus?.();
    await this.view.customAlert("Dữ liệu chưa hợp lệ", first.message, "alert-triangle", field);
    return false;
  }
  if (completeReport) {
    report.ketLuan = aggregateDetailedEvaluationReport({
      report,
      criteria: state.criteria,
      groups: state.context.editableGroups,
    }).overall.status;
  }
  const allReports = (state.bid.baoCaoDanhGiaChiTietList || []).filter(
    (item) => item.loaiVong !== state.roundType,
  );
  allReports.push(report);
  persistCriteriaOnFirstSave(state.pkg, state.roundType, state.criteria, state.context);
  state.bid.baoCaoDanhGiaChiTietList = allReports;
  if (completeReport) {
    Object.assign(
      state.bid,
      applyDetailedEvaluationProjection(
        state.bid,
        report,
        state.criteria,
        state.context.editableGroups,
      ),
    );
  }
  const result = await persistAndSync(this, ["goithau", "thongtinmothau"]);
  if (!result?.ok) return false;
  this._detailedEvaluationDrafts.set(state.draftKey, report);
  this._editingDetailedEvaluationKey = null;
  this._detailedEvaluationDirty = false;
  await this.view.customAlert(
    "Lưu thành công",
    completeReport
      ? "Báo cáo chi tiết đã hoàn thành và cập nhật báo cáo tổng quát."
      : completeGroup
        ? "Tab đánh giá đã hoàn thành."
        : "Đã lưu bản nháp báo cáo chi tiết.",
    "check-circle",
  );
  this.renderDetailedEvaluation();
  return true;
}
