import { aggregateDetailedEvaluationReport } from "./detailedEvaluationAggregation.js";
import { adaptDetailedEvaluationCriteriaForBid } from "./detailedEvaluationCriteria.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
import {
  resolveAccessibleDetailedEvaluationGroups,
  resolveDetailedEvaluationContext,
} from "./detailedEvaluationRules.js";
import {
  getCriteriaForGroup,
  getDetailedEvaluationBidLabel,
  getDetailedReportForRound,
  getEligibleFinancialEvaluationBids,
  getEvaluationRoundType,
  getPackageEvaluationBids,
} from "./detailedEvaluationSelectors.js";
import { buildBidEvaluationPanelState } from "./BidEvaluationPanelState.js";
import { getPackageWorkflowState } from "./detail/PackageTabs.js";
import {
  filterBidsByEvaluationLotScope,
  resolvePackageResultStatus,
} from "./lotEvaluationScope.js";
import {
  applyTechnicalEvaluationMethod,
  resolveTechnicalEvaluationMethod,
} from "./technicalEvaluationMethod.js";
import { detailedEvaluationAutosaveFor } from "./DetailedEvaluationDraftAutosave.js";
import { requiresTechnicalScoreInput } from "./evaluationMethodRules.js";
import { parseEvaluationMetadataStrict } from "./evaluationMetadata.js";

export function buildDetailedEvaluationRow(reportId, criterionId) {
  return {
    id: `detailed-evaluation-row:${reportId}:${criterionId}`,
    tieuChiDanhGiaId: criterionId,
    ketQua: "pending",
    diem: null,
    noiDungHsdt: "",
    nhanXet: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "",
  };
}

export function normalizeDetailedEvaluationRow(row = {}) {
  const {
    lyDoKhongDat: _legacyCamelFailureReason,
    ly_do_khong_dat: _legacySnakeFailureReason,
    ...normalized
  } = row;
  return normalized;
}

export function normalizeDetailedEvaluationReport(report) {
  if (!report || typeof report !== "object") return report;
  return {
    ...report,
    chiTietList: (report.chiTietList || []).map(normalizeDetailedEvaluationRow),
  };
}

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
    hoanThanhLuc: null,
    chiTietList: criteria.map((criterion) => buildDetailedEvaluationRow(
      reportId,
      criterion.id,
    )),
  };
}

export function buildReopenedDetailedEvaluationReport(report = {}) {
  const normalizedReport = normalizeDetailedEvaluationReport(report);
  const extension = normalizedReport.extension && typeof normalizedReport.extension === "object"
    ? { ...normalizedReport.extension }
    : {};
  extension.projectionPending = true;
  return {
    ...normalizedReport,
    trangThai: "draft",
    hoanThanhLuc: null,
    extension,
  };
}

const GROUP_PROJECTION_FIELDS = Object.freeze({
  validity: Object.freeze({ result: "danhGiaHopLe" }),
  capacity: Object.freeze({ result: "danhGiaNangLuc" }),
  technical: Object.freeze({ result: "danhGiaKyThuat" }),
  financial: Object.freeze({ result: "danhGiaTaiChinh" }),
});

export function applyDetailedEvaluationProjection(bid, report, criteria, groups, pkg = null) {
  if (report?.trangThai !== "completed") return bid;
  const aggregation = aggregateDetailedEvaluationReport({ report, criteria, groups });
  const projected = { ...bid };
  Object.entries(aggregation.byGroup).forEach(([group, result]) => {
    const fields = GROUP_PROJECTION_FIELDS[group];
    if (!fields) return;
    projected[fields.result] = group === "technical" && requiresTechnicalScoreInput(pkg)
      ? result.score === null ? "" : String(result.score)
      : result.status;
  });
  projected.danhGiaKetLuan = aggregation.overall.status;
  projected.diemDanhGia = aggregation.overall.score;
  return projected;
}

export function parseDetailedEvaluationMetadata(value) {
  return parseEvaluationMetadataStrict(value);
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

function resolvePackage(controller) {
  const packageId = controller.view.getActiveElement("danhgiahsdt-goithau-select")?.value
    || controller._currentWorkflowPackageId;
  return controller.model.state.goithau.find(
    (item) => String(item.id) === String(packageId || ""),
  ) || null;
}

export function resolveDetailedEvaluationState(controller) {
  if (!controller?.view || !controller?.model) {
    throw new TypeError("Detailed evaluation state requires an application controller.");
  }
  const pkg = resolvePackage(controller);
  if (!pkg) return null;
  const roundType = getEvaluationRoundType(pkg, controller.currentDanhGiaTab);
  let context = resolveDetailedEvaluationContext(pkg, roundType);
  const evaluationPanelState = buildBidEvaluationPanelState({
    pkg,
    requestedTab: controller.currentDanhGiaTab,
    editingState: controller.view._editingState,
    cachedScopes: controller._evaluationLotScopes,
  });
  const lotScope = evaluationPanelState.lotScope;
  const packageBids = context.contractorFilter === "technical-qualified"
    ? getEligibleFinancialEvaluationBids(controller.model, pkg)
    : getPackageEvaluationBids(controller.model, pkg);
  const rawBids = lotScope
    ? filterBidsByEvaluationLotScope(packageBids, pkg, lotScope)
    : packageBids;
  const bids = rawBids.map((bid) => ({
    ...bid,
    label: getDetailedEvaluationBidLabel(controller.model, bid),
  }));
  if (!bids.some((bid) => String(bid.id) === String(controller.selectedEvaluationBidId))) {
    controller.selectedEvaluationBidId = bids[0]?.id || null;
  }
  const bid = rawBids.find(
    (item) => String(item.id) === String(controller.selectedEvaluationBidId),
  ) || null;
  const draftKey = `${pkg.id}:${bid?.id || ""}:${roundType}`;
  controller._detailedEvaluationDrafts = controller._detailedEvaluationDrafts || new Map();
  const persistedReport = bid ? getDetailedReportForRound(bid, roundType) : null;
  const restoredDraft = detailedEvaluationAutosaveFor(controller).restore(draftKey);
  const reportSource = controller._detailedEvaluationDrafts.has(draftKey)
    ? controller._detailedEvaluationDrafts.get(draftKey)
    : restoredDraft?.report || persistedReport;
  let report = normalizeDetailedEvaluationReport(reportSource);
  if (reportSource) {
    controller._detailedEvaluationDrafts.set(draftKey, report);
    if (restoredDraft?.pendingServerSync) controller._detailedEvaluationDirty = true;
  }
  const criteriaKey = `${pkg.id}:${roundType}`;
  controller._detailedEvaluationCriteriaOverrides = controller._detailedEvaluationCriteriaOverrides || new Map();
  controller._technicalEvaluationMethodDrafts = controller._technicalEvaluationMethodDrafts || new Map();
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
  const technicalEvaluationMethod = resolveTechnicalEvaluationMethod({
    pkg,
    roundType,
    report,
    criteria: baseCriteria,
    draftMethod: controller._technicalEvaluationMethodDrafts.get(criteriaKey),
  });
  const criteria = markHierarchicalDetailedEvaluationCriteria(
    adaptDetailedEvaluationCriteriaForBid(
      applyTechnicalEvaluationMethod(baseCriteria, technicalEvaluationMethod),
      bid || {},
    ),
  );
  if (bid && !report) {
    report = buildDetailedEvaluationDraft({ pkg, bid, roundType, criteria });
    controller._detailedEvaluationDrafts.set(draftKey, report);
  }
  if (report) report = applyHierarchicalDetailedEvaluationResults(report, criteria);

  const aggregation = aggregateDetailedEvaluationReport({
    report: report || {}, criteria, groups: context.configuredGroups,
  });
  const bidderGoodsRows = (controller.model.state.hanghoaduthaunhathau || []).filter(
    (row) => String(row.thongTinMoThauId || "") === String(bid?.id || ""),
  );
  const bidderGoodsReady = bidderGoodsRows.length > 0 && bidderGoodsRows.every(
    (row) => row.isDraft === false && row.trangThaiUuDai === "ready",
  );
  const accessibleGroups = resolveAccessibleDetailedEvaluationGroups({
    configuredGroups: context.configuredGroups,
    report,
    aggregationByGroup: aggregation.byGroup,
    bidderGoodsReady,
  });
  context = {
    ...context,
    accessibleGroups,
    visibleGroups: accessibleGroups,
    technicalEvaluationMethod,
    technicalEvaluationMethodRequired: !technicalEvaluationMethod,
  };
  if (!accessibleGroups.includes(controller.selectedDetailedEvaluationTab)) {
    controller.selectedDetailedEvaluationTab = accessibleGroups.at(-1) || "validity";
  }

  const workflowState = getPackageWorkflowState(pkg, rawBids);
  const effectiveStatus = resolvePackageResultStatus(pkg);
  const actorId = controller.model.state.activeuser?.id || "";
  const canEdit = controller.model.hasPermission?.(actorId, "goithau", "edit") !== false
    && controller.model.hasPermission?.(actorId, "thongtinmothau", "edit") !== false;
  const lockedByCompletedRound = (
    roundType === "single"
      && (workflowState.isSingleEnvelopeEvalSaved || workflowState.isSingleEnvelopeScopedEvalSaved)
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
    lotScope,
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
