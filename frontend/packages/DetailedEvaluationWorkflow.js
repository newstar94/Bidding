import { aggregateDetailedEvaluationReport } from "./detailedEvaluationAggregation.js";
import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { persistAndSync } from "../shared/MutationService.js";
import { readExcelWorkbookSheets } from "../documents/excelFileReader.js";
import { renderDetailedEvaluationPanel } from "./detail/DetailedEvaluationPanel.js";
import {
  mapDetailedEvaluationExcelRows,
  parseMuasamcongDetailedEvaluationWorkbook,
  validateMuasamcongContractorIdentity,
} from "./detailedEvaluationExcel.js";
import { resolveBidContractorName } from "../partners/contractorVersionBinding.js";
import { adaptDetailedEvaluationCriteriaForBid } from "./detailedEvaluationCriteria.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
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
    chiTietList: criteria.map((criterion) => buildDetailedEvaluationRow(
      reportId,
      criterion.id,
    )),
  };
}

function buildDetailedEvaluationRow(reportId, criterionId) {
  return {
    id: `detailed-evaluation-row:${reportId}:${criterionId}`,
    tieuChiDanhGiaId: criterionId,
    ketQua: "pending",
    diem: null,
    noiDungHsdt: "",
    nhanXet: "",
    lyDoKhongDat: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "",
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
    reason: null,
    clarification: null,
  }),
  capacity: Object.freeze({
    result: "danhGiaNangLuc",
    reason: null,
    clarification: null,
  }),
  technical: Object.freeze({
    result: "danhGiaKyThuat",
    reason: null,
    clarification: null,
  }),
  financial: Object.freeze({
    result: "danhGiaTaiChinh",
    reason: null,
    clarification: null,
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

function isUserConfiguredCriterion(criterion = {}) {
  const source = String(criterion.source || "").trim().toLowerCase();
  return criterion.isCustom === true
    || source === "custom"
    || source === "muasamcong"
    || !criterion.templateId;
}

function reportHasMeaningfulEvaluationData(report = {}) {
  return (report?.chiTietList || []).some((row) => (
    (row.ketQua && row.ketQua !== "pending")
    || (row.diem !== null && row.diem !== undefined && row.diem !== "")
    || [
      "noiDungHsdt",
      "nhanXet",
      "lyDoKhongDat",
      "yeuCauLamRo",
      "ketQuaLamRo",
      "taiLieuThamChieu",
    ].some((field) => String(row[field] || "").trim())
    || (
      (row.extension?.ketQuaTuDong || row.ketQuaTuDong)
      && (row.extension?.ketQuaTuDong || row.ketQuaTuDong) !== "pending"
    )
  ));
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
  const persistedReport = bid ? getDetailedReportForRound(bid, roundType) : null;
  let report = persistedReport;
  if (controller._detailedEvaluationDrafts.has(draftKey)) {
    report = controller._detailedEvaluationDrafts.get(draftKey);
  }
  const criteriaKey = `${pkg.id}:${roundType}`;
  controller._detailedEvaluationCriteriaOverrides = controller._detailedEvaluationCriteriaOverrides || new Map();
  const hasCriteriaOverride = controller._detailedEvaluationCriteriaOverrides.has(criteriaKey);
  let baseCriteria = hasCriteriaOverride
    ? controller._detailedEvaluationCriteriaOverrides.get(criteriaKey)
    : context.visibleGroups.flatMap(
      (group) => getCriteriaForGroup(pkg, roundType, group, {
        fallbackToTemplate: Boolean(persistedReport?.chiTietList?.length),
      }),
    );
  const suppressStoredTemplateSeed = !hasCriteriaOverride
    && !baseCriteria.some(isUserConfiguredCriterion)
    && !reportHasMeaningfulEvaluationData(report);
  if (suppressStoredTemplateSeed) {
    const seedCriterionIds = new Set(baseCriteria.map((criterion) => String(criterion.id)));
    baseCriteria = [];
    if (report?.chiTietList?.length) {
      report = {
        ...report,
        chiTietList: report.chiTietList.filter(
          (row) => !seedCriterionIds.has(String(row.tieuChiDanhGiaId)),
        ),
      };
      controller._detailedEvaluationDrafts.set(draftKey, report);
    }
  }
  const criteria = markHierarchicalDetailedEvaluationCriteria(
    adaptDetailedEvaluationCriteriaForBid(baseCriteria, bid || {}),
  );
  if (bid && !report) {
    report = buildDetailedEvaluationDraft({ pkg, bid, roundType, criteria });
    controller._detailedEvaluationDrafts.set(draftKey, report);
  }
  if (report) {
    report = applyHierarchicalDetailedEvaluationResults(report, criteria);
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
    baseCriteria,
    criteria,
    criteriaKey,
    report,
    draftKey,
    readOnly,
    canReopen,
  };
}

export function collectActiveGroupRows(container, report, criteria) {
  const existing = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = element.getAttribute("data-detailed-criterion-id");
    const criterion = criteria.find((item) => String(item.id) === String(criterionId));
    if (!criterion) return;
    const previous = existing.get(String(criterionId)) || {};
    const hasField = (field) => Boolean(
      element.querySelector(`[data-detailed-field="${field}"]`),
    );
    const value = (field) => element.querySelector(`[data-detailed-field="${field}"]`)?.value ?? "";
    const choiceValue = (field) => {
      const choice = element.querySelector(
        `[data-detailed-field="${field}"][data-detailed-result-value]`,
      );
      if (!choice || typeof choice.getAttribute !== "function") return null;
      const selected = element.querySelector(
        `[data-detailed-field="${field}"][data-detailed-result-value]:checked`,
      );
      return typeof selected?.getAttribute === "function"
        ? selected.getAttribute("data-detailed-result-value") || "pending"
        : "pending";
    };
    const scoreValue = value("diem");
    let result = choiceValue("ketQua") || value("ketQua") || "pending";
    if (criterion.resultType === "text") result = value("nhanXet").trim() ? "pass" : "pending";
    if (criterion.resultType === "number") result = scoreValue !== "" ? "pass" : "pending";
    if (criterion.group === "financial") {
      result = value("noiDungHsdt").trim() ? "pass" : "pending";
    }
    const automaticResult = choiceValue("ketQuaTuDong");
    existing.set(String(criterionId), {
      ...previous,
      id: previous.id || `detailed-evaluation-row:${report.id}:${criterionId}`,
      tieuChiDanhGiaId: criterionId,
      ketQua: result,
      diem: scoreValue === "" ? null : Number(scoreValue),
      noiDungHsdt: value("noiDungHsdt"),
      nhanXet: value("nhanXet"),
      lyDoKhongDat: hasField("lyDoKhongDat")
        ? value("lyDoKhongDat")
        : previous.lyDoKhongDat || "",
      yeuCauLamRo: hasField("yeuCauLamRo") ? value("yeuCauLamRo") : previous.yeuCauLamRo || "",
      ketQuaLamRo: hasField("ketQuaLamRo") ? value("ketQuaLamRo") : previous.ketQuaLamRo || "",
      taiLieuThamChieu: hasField("taiLieuThamChieu")
        ? value("taiLieuThamChieu")
        : previous.taiLieuThamChieu || "",
      extension: automaticResult === null
        ? { ...(previous.extension || {}) }
        : { ...(previous.extension || {}), ketQuaTuDong: automaticResult },
    });
  });
  return [...existing.values()];
}

export function collectConfiguredDetailedEvaluationCriteria(container, criteria = []) {
  const updates = new Map();
  const criteriaById = new Map(criteria.map((criterion) => [
    String(criterion.id),
    criterion,
  ]));
  container.querySelectorAll("[data-detailed-criterion-id]").forEach((element) => {
    const criterionId = String(element.getAttribute("data-detailed-criterion-id") || "");
    if (criteriaById.get(criterionId)?.isCustom !== true) return;
    const value = (field) => element.querySelector(
      `[data-detailed-config-field="${field}"]`,
    )?.value;
    const name = value("name");
    const stt = value("stt");
    const requirement = value("requirement");
    if (name === undefined && stt === undefined && requirement === undefined) return;
    updates.set(criterionId, {
      ...(name === undefined ? {} : { name: String(name).trim() }),
      ...(stt === undefined
        ? {}
        : { stt: String(stt).trim().replace(/\.$/, "") }),
      ...(requirement === undefined
        ? {}
        : { requirement: String(requirement).trim() }),
    });
  });
  return criteria.map((criterion) => ({
    ...criterion,
    ...(updates.get(String(criterion.id)) || {}),
  }));
}

function mergeConfiguredCriteria(baseCriteria, configuredCriteria) {
  const configured = new Map(configuredCriteria.map((criterion) => [
    String(criterion.id),
    criterion,
  ]));
  return baseCriteria.map((criterion) => {
    const visible = configured.get(String(criterion.id));
    if (!visible) return criterion;
    return {
      ...criterion,
      name: visible.name,
      stt: visible.stt,
      sourceStt: visible.stt,
      requirement: visible.requirement || "",
    };
  });
}

function nextDetailedEvaluationStt(criteria, group) {
  const topLevels = criteria
    .filter((criterion) => criterion.group === group)
    .map((criterion) => Number(String(criterion.stt || "").split(".")[0]))
    .filter(Number.isInteger);
  return String((topLevels.length > 0 ? Math.max(...topLevels) : 0) + 1);
}

export async function addDetailedEvaluationCriterion() {
  const state = detailedEvaluationState(this);
  if (!state?.bid || !state.report || state.readOnly) return false;
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(
    state.baseCriteria,
    configuredCriteria,
  );
  const activeCriteria = configuredCriteria.filter(
    (criterion) => criterion.group === this.selectedDetailedEvaluationTab,
  );
  const currentRows = detail
    ? collectActiveGroupRows(detail, state.report, activeCriteria)
    : state.report.chiTietList || [];
  this._detailedEvaluationCriterionSequence = (this._detailedEvaluationCriterionSequence || 0) + 1;
  const criterionId = [
    "evaluation-criterion",
    state.pkg.id,
    state.roundType,
    this.selectedDetailedEvaluationTab,
    Date.now(),
    this._detailedEvaluationCriterionSequence,
  ].join(":");
  const criterion = {
    id: criterionId,
    code: `CUSTOM_${this._detailedEvaluationCriterionSequence}`,
    name: "",
    group: this.selectedDetailedEvaluationTab,
    resultType: "pass_fail",
    required: true,
    maxScore: null,
    minScore: null,
    requirement: "",
    stt: nextDetailedEvaluationStt(configuredCriteria, this.selectedDetailedEvaluationTab),
    sourceStt: nextDetailedEvaluationStt(configuredCriteria, this.selectedDetailedEvaluationTab),
    order: configuredBaseCriteria.length,
    source: "custom",
    isCustom: true,
  };
  const updatedBaseCriteria = [...configuredBaseCriteria, criterion];
  this._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, updatedBaseCriteria);
  this._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: [
      ...currentRows,
      buildDetailedEvaluationRow(state.report.id, criterionId),
    ],
  });
  this._detailedEvaluationDirty = true;
  await this.renderDetailedEvaluation();
  this.view.getActiveElement("danhgiahsdt-detail-view")?.querySelector(
    `[data-detailed-criterion-id="${criterionId}"] [data-detailed-config-field="name"]`,
  )?.focus?.();
  return true;
}

async function removeDetailedEvaluationCriterion(controller, criterionId) {
  const state = detailedEvaluationState(controller);
  if (!state?.report || state.readOnly) return false;
  const detail = controller.view.getActiveElement("danhgiahsdt-detail-view");
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    detail
      ? collectConfiguredDetailedEvaluationCriteria(detail, state.criteria)
      : state.criteria,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(
    state.baseCriteria,
    configuredCriteria,
  );
  const activeCriteria = configuredCriteria.filter(
    (criterion) => criterion.group === controller.selectedDetailedEvaluationTab,
  );
  const currentRows = detail
    ? collectActiveGroupRows(detail, state.report, activeCriteria)
    : state.report.chiTietList || [];
  const updatedBaseCriteria = configuredBaseCriteria.filter(
    (criterion) => String(criterion.id) !== String(criterionId),
  );
  controller._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, updatedBaseCriteria);
  controller._detailedEvaluationDrafts.set(state.draftKey, {
    ...state.report,
    chiTietList: currentRows.filter(
      (row) => String(row.tieuChiDanhGiaId) !== String(criterionId),
    ),
  });
  controller._detailedEvaluationDirty = true;
  await controller.renderDetailedEvaluation();
  return true;
}

function updateDerivedResultMarks(container, report, criteria) {
  const rows = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  criteria.filter((criterion) => criterion.hasChildren === true).forEach((criterion) => {
    const row = rows.get(String(criterion.id)) || {};
    const resultByField = {
      ketQua: row.ketQua || "pending",
      ketQuaTuDong: row.extension?.ketQuaTuDong || row.ketQuaTuDong || "pending",
    };
    const rowElement = container.querySelector(
      `[data-detailed-criterion-id="${criterion.id}"]`,
    );
    rowElement?.querySelectorAll("[data-detailed-derived-field]").forEach((mark) => {
      const field = mark.getAttribute("data-detailed-derived-field");
      const value = mark.getAttribute("data-detailed-derived-value");
      const marked = resultByField[field] === value;
      mark.textContent = marked ? "x" : "-";
      mark.classList.toggle("is-marked", marked);
      mark.setAttribute(
        "aria-label",
        `${mark.getAttribute("data-detailed-derived-label") || "Kết quả tự tính"}: ${marked ? "có" : "không"}`,
      );
    });
  });
}

function persistCriteriaOnSave(pkg, roundType, criteria, context = {}) {
  const metadata = parseMetadata(pkg.danhGiaHsdtMetadata);
  const templateInfo = {
    templateId: context.templateId || criteria.find((item) => item.templateId)?.templateId || "",
    templateVersion: context.templateVersion
      || criteria.find((item) => item.templateVersion)?.templateVersion
      || null,
  };
  if (roundType === "single") {
    metadata.criteria = criteria;
    if (templateInfo.templateId && !metadata.templateId) metadata.templateId = templateInfo.templateId;
    if (templateInfo.templateVersion && !metadata.templateVersion) {
      metadata.templateVersion = templateInfo.templateVersion;
    }
  } else {
    metadata.is1G2T = true;
    metadata[roundType] = metadata[roundType] && typeof metadata[roundType] === "object"
      ? metadata[roundType]
      : {};
    metadata[roundType].criteria = criteria;
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
  detail.querySelectorAll("[data-detailed-result-value]").forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      const row = input.closest("[data-detailed-criterion-id]");
      const field = input.getAttribute("data-detailed-field");
      row?.querySelectorAll(
        `[data-detailed-field="${field}"][data-detailed-result-value]`,
      ).forEach((candidate) => {
        if (candidate !== input) candidate.checked = false;
      });
      const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
        collectConfiguredDetailedEvaluationCriteria(detail, state.criteria),
      );
      const configuredGroupCriteria = configuredCriteria.filter(
        (criterion) => criterion.group === this.selectedDetailedEvaluationTab,
      );
      const currentRows = collectActiveGroupRows(
        detail,
        state.report,
        configuredGroupCriteria,
      );
      const updatedReport = applyHierarchicalDetailedEvaluationResults({
        ...state.report,
        chiTietList: currentRows,
      }, configuredCriteria);
      updateDerivedResultMarks(detail, updatedReport, configuredGroupCriteria);
    });
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
  const excelInput = detail.querySelector("#detailed-evaluation-excel-input");
  const excelButton = detail.querySelector("#btn-detailed-evaluation-import-excel");
  detail.querySelector("#btn-detailed-evaluation-add-row")?.addEventListener(
    "click",
    () => addDetailedEvaluationCriterion.call(this),
  );
  detail.querySelectorAll("[data-detailed-remove-criterion]").forEach((button) => {
    button.addEventListener("click", () => removeDetailedEvaluationCriterion(
      this,
      button.getAttribute("data-detailed-remove-criterion"),
    ));
  });
  excelButton?.addEventListener("click", () => excelInput?.click());
  excelInput?.addEventListener("change", async () => {
    const file = excelInput.files?.[0];
    if (!file) return;
    excelButton.disabled = true;
    try {
      await importDetailedEvaluationExcel.call(this, file);
    } finally {
      excelInput.value = "";
      excelButton.disabled = false;
    }
  });
  this.view.createIconsScoped?.(detail);
}

export async function importDetailedEvaluationExcel(file) {
  const state = detailedEvaluationState(this);
  if (!state?.bid || !state.report || state.readOnly) return false;
  const activeGroup = this.selectedDetailedEvaluationTab;
  const groupCriteria = state.criteria.filter((criterion) => criterion.group === activeGroup);

  try {
    const sheets = await readExcelWorkbookSheets(file);
    const roundId = `evaluation-round:${String(state.pkg.id || "pending")}:${state.roundType}`;
    const muasamcongImports = state.context.editableGroups.map((group) => (
      parseMuasamcongDetailedEvaluationWorkbook(sheets, {
        group,
        pkg: state.pkg,
        bid: state.bid,
        roundId,
      })
    )).filter(Boolean);
    if (muasamcongImports.length > 0
      && !await verifyMuasamcongDetailedEvaluationContractor(this, state, sheets)) {
      return false;
    }
    const firstSheetRows = sheets[0]?.rows || [];
    const headers = firstSheetRows[0] || [];
    const flatRows = firstSheetRows.slice(1).map((row) => Object.fromEntries(
      headers.map((header, index) => [String(header || `Cột ${index + 1}`), row[index]]),
    ));
    const imported = muasamcongImports.length > 0
      ? {
        matches: muasamcongImports.flatMap((item) => item.matches),
        unmatchedRows: [],
        warnings: muasamcongImports.flatMap((item) => item.warnings || []),
      }
      : mapDetailedEvaluationExcelRows(flatRows, groupCriteria);
    if (imported.matches.length === 0) {
      await this.view.customAlert(
        "Không tìm thấy tiêu chí phù hợp",
        "Excel cần có cột STT, Mã tiêu chí hoặc Tiêu chí/Yêu cầu trùng với tab đang mở.",
        "alert-triangle",
      );
      return false;
    }

    let existingReportRows = state.report.chiTietList || [];
    if (muasamcongImports.length > 0) {
      const importedGroups = new Set(muasamcongImports.flatMap(
        (item) => item.criteria.map((criterion) => criterion.group),
      ));
      const previousGroupIds = new Set(state.baseCriteria
        .filter((criterion) => importedGroups.has(criterion.group))
        .map((criterion) => String(criterion.id)));
      existingReportRows = existingReportRows.filter(
        (row) => !previousGroupIds.has(String(row.tieuChiDanhGiaId)),
      );
      const allCriteria = [
        ...state.baseCriteria.filter((criterion) => !importedGroups.has(criterion.group)),
        ...muasamcongImports.flatMap((item) => item.sourceCriteria || item.criteria),
      ];
      this._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, allCriteria);
    }
    const rowsByCriterion = new Map(
      existingReportRows.map((row) => [String(row.tieuChiDanhGiaId), row]),
    );
    imported.matches.forEach(({ criterion, values }) => {
      const previous = rowsByCriterion.get(String(criterion.id)) || {};
      const textValue = (field) => values[field] !== "" ? values[field] : previous[field] || "";
      rowsByCriterion.set(String(criterion.id), {
        ...previous,
        id: previous.id || `detailed-evaluation-row:${state.report.id}:${criterion.id}`,
        tieuChiDanhGiaId: criterion.id,
        ketQua: values.ketQua !== "pending"
          ? values.ketQua
          : previous.ketQua || "pending",
        diem: values.diem !== null ? values.diem : previous.diem ?? null,
        noiDungHsdt: textValue("noiDungHsdt"),
        nhanXet: textValue("nhanXet"),
        lyDoKhongDat: textValue("lyDoKhongDat"),
        yeuCauLamRo: textValue("yeuCauLamRo"),
        ketQuaLamRo: textValue("ketQuaLamRo"),
        taiLieuThamChieu: textValue("taiLieuThamChieu"),
        extension: {
          ...(previous.extension || {}),
          ...(values.ketQuaTuDong && values.ketQuaTuDong !== "pending"
            ? { ketQuaTuDong: values.ketQuaTuDong }
            : {}),
        },
      });
    });

    const importedExtension = { ...(state.report.extension || {}) };
    delete importedExtension.excelBidType;
    const importedReport = applyHierarchicalDetailedEvaluationResults({
      ...state.report,
      extension: importedExtension,
      chiTietList: [...rowsByCriterion.values()],
    }, markHierarchicalDetailedEvaluationCriteria(
      muasamcongImports.length > 0
        ? adaptDetailedEvaluationCriteriaForBid(
          this._detailedEvaluationCriteriaOverrides.get(state.criteriaKey) || state.baseCriteria,
          state.bid,
        )
        : state.criteria,
    ));
    this._detailedEvaluationDrafts.set(state.draftKey, importedReport);
    this._detailedEvaluationDirty = true;
    this.renderDetailedEvaluation();

    const skipped = imported.unmatchedRows.length;
    const warningCount = imported.warnings.length;
    const importedSheetNames = muasamcongImports.map((item) => item.sheetName).join(", ");
    await this.view.customAlert(
      "Đã nhập dữ liệu Excel",
      `Đã tự điền ${imported.matches.length} tiêu chí${importedSheetNames ? ` từ các sheet: ${importedSheetNames}` : " trong tab hiện tại"}.${skipped ? ` Bỏ qua ${skipped} dòng không khớp.` : ""}${warningCount ? ` Có ${warningCount} kết quả cần kiểm tra lại.` : ""} Dữ liệu chưa được lưu.`,
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
    ? `File Excel thuộc nhà thầu "${identity.actualNames[0]}", nhưng báo cáo đang chọn nhà thầu "${identity.expectedName}". Vui lòng chọn đúng nhà thầu hoặc tải đúng file. Dữ liệu chưa được nhập.`
    : identity.reason === "conflicting-workbook-names"
      ? `File Excel chứa nhiều tên nhà thầu khác nhau: ${identity.actualNames.join("; ")}. Không thể xác định báo cáo thuộc nhà thầu nào. Dữ liệu chưa được nhập.`
      : identity.reason === "missing-selected-name"
        ? "Không xác định được tên nhà thầu đang chọn nên chưa thể đối chiếu với file Excel. Dữ liệu chưa được nhập."
        : "Không tìm thấy tên nhà thầu trong phần đầu của các sheet muasamcong nên chưa thể xác minh file. Dữ liệu chưa được nhập.";
  await controller.view.customAlert(
    identity.reason === "mismatch" ? "Sai nhà thầu trong file Excel" : "Không thể xác minh nhà thầu",
    message,
    "alert-triangle",
  );
  return false;
}

export async function saveDetailedEvaluation({
  completeGroup = false,
  completeReport = false,
} = {}) {
  const state = detailedEvaluationState(this);
  const detail = this.view.getActiveElement("danhgiahsdt-detail-view");
  if (!state?.bid || !state.report || !detail || state.readOnly) return false;
  const configuredCriteria = markHierarchicalDetailedEvaluationCriteria(
    collectConfiguredDetailedEvaluationCriteria(detail, state.criteria),
  );
  const groupCriteria = configuredCriteria.filter(
    (criterion) => criterion.group === this.selectedDetailedEvaluationTab,
  );
  const configuredBaseCriteria = mergeConfiguredCriteria(
    state.baseCriteria,
    configuredCriteria,
  );
  this._detailedEvaluationCriteriaOverrides.set(state.criteriaKey, configuredBaseCriteria);
  const invalidCriterion = groupCriteria.find((criterion) => (
    !String(criterion.name || "").trim()
    || !/^\d+(?:\.\d+)*$/.test(String(criterion.stt || ""))
  ));
  if (invalidCriterion) {
    const row = detail.querySelector(
      `[data-detailed-criterion-id="${invalidCriterion.id}"]`,
    );
    const fieldName = !String(invalidCriterion.name || "").trim() ? "name" : "stt";
    const field = row?.querySelector(`[data-detailed-config-field="${fieldName}"]`);
    field?.focus?.();
    await this.view.customAlert(
      "Tiêu chí chưa hợp lệ",
      fieldName === "name"
        ? "Vui lòng nhập nội dung tiêu chí đánh giá."
        : "STT phải có dạng 1, 2.1 hoặc 2.1.1.",
      "alert-triangle",
      field,
    );
    return false;
  }
  const groupsToCheck = completeReport
    ? state.context.editableGroups
    : completeGroup ? [this.selectedDetailedEvaluationTab] : [];
  const emptyGroup = groupsToCheck.find((group) => !configuredCriteria.some(
    (criterion) => criterion.group === group,
  ));
  if (emptyGroup) {
    await this.view.customAlert(
      "Chưa có tiêu chí đánh giá",
      "Vui lòng thêm dòng hoặc nhập dữ liệu từ Excel trước khi hoàn thành.",
      "alert-triangle",
    );
    return false;
  }
  const report = applyHierarchicalDetailedEvaluationResults({
    ...state.report,
    trangThai: completeReport ? "completed" : "draft",
    hoanThanhLuc: completeReport ? new Date().toISOString() : null,
    chiTietList: collectActiveGroupRows(detail, state.report, groupCriteria),
  }, configuredCriteria);
  report.extension = {
    ...(report.extension || {}),
    completedGroups: [...new Set([
      ...(report.extension?.completedGroups || []),
      ...(completeGroup ? [this.selectedDetailedEvaluationTab] : []),
    ])],
  };
  if (completeReport) delete report.extension.projectionPending;
  const validation = completeReport
    ? validateDetailedEvaluationReport(report, state.context, configuredCriteria)
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
      criteria: configuredCriteria,
      groups: state.context.editableGroups,
    }).overall.status;
  }
  const allReports = (state.bid.baoCaoDanhGiaChiTietList || []).filter(
    (item) => item.loaiVong !== state.roundType,
  );
  allReports.push(report);
  persistCriteriaOnSave(
    state.pkg,
    state.roundType,
    configuredBaseCriteria,
    state.context,
  );
  state.bid.baoCaoDanhGiaChiTietList = allReports;
  if (completeReport) {
    Object.assign(
      state.bid,
      applyDetailedEvaluationProjection(
        state.bid,
        report,
        configuredCriteria,
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
