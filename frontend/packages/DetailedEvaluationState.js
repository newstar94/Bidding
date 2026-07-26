import { resolveBidContractorName } from "../partners/contractorVersionBinding.js";
import { aggregateDetailedEvaluationReport } from "./detailedEvaluationAggregation.js";
import { adaptDetailedEvaluationCriteriaForBid } from "./detailedEvaluationCriteria.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "./detailedEvaluationHierarchy.js";
import { resolveDetailedEvaluationContext } from "./detailedEvaluationRules.js";
import {
  getCriteriaForGroup,
  getDetailedEvaluationBidLabel,
  getDetailedReportForRound,
  getEligibleFinancialEvaluationBids,
  getEvaluationRoundType,
  getPackageEvaluationBids,
} from "./detailedEvaluationSelectors.js";
import { getPackageWorkflowState } from "./detail/PackageTabs.js";
import { resolvePackageResultStatus } from "./lotEvaluationScope.js";

export function buildDetailedEvaluationRow(reportId, criterionId) {
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
  validity: Object.freeze({ result: "danhGiaHopLe" }),
  capacity: Object.freeze({ result: "danhGiaNangLuc" }),
  technical: Object.freeze({ result: "danhGiaKyThuat" }),
  financial: Object.freeze({ result: "danhGiaTaiChinh" }),
});

export function applyDetailedEvaluationProjection(bid, report, criteria, groups) {
  if (report?.trangThai !== "completed") return bid;
  const aggregation = aggregateDetailedEvaluationReport({ report, criteria, groups });
  const projected = { ...bid };
  Object.entries(aggregation.byGroup).forEach(([group, result]) => {
    const fields = GROUP_PROJECTION_FIELDS[group];
    if (fields) projected[fields.result] = result.status;
  });
  projected.danhGiaKetLuan = aggregation.overall.status;
  projected.diemDanhGia = aggregation.overall.score;
  return projected;
}

export function parseDetailedEvaluationMetadata(value) {
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
  let report = controller._detailedEvaluationDrafts.has(draftKey)
    ? controller._detailedEvaluationDrafts.get(draftKey)
    : persistedReport;
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
  if (report) report = applyHierarchicalDetailedEvaluationResults(report, criteria);

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
