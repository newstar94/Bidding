import { resolveBidContractorName } from "../partners/contractorVersionBinding.js";
import { checkBidQualified } from "./detail/PackageTabs.js";
import { createDefaultDetailedEvaluationCriteria } from "./detailedEvaluationTemplates.js";


function isTwoEnvelope(pkg) {
  return String(pkg?.phuongThucLuaChon || "").includes("hai túi hồ sơ");
}

export function getEvaluationRoundType(pkg, currentGeneralTab = "") {
  if (!isTwoEnvelope(pkg)) return "single";
  return ["financial", "eval_fin"].includes(String(currentGeneralTab || ""))
    ? "financial"
    : "technical";
}

export function getPackageEvaluationBids(model, pkg) {
  return (model?.state?.thongtinmothau || []).filter((bid) => (
    String(bid?.goiThauId || "") === String(pkg?.id || "")
    && !bid?.archivedAt
  ));
}

export function getEligibleFinancialEvaluationBids(model, pkg) {
  return getPackageEvaluationBids(model, pkg).filter(checkBidQualified);
}

export function getDetailedEvaluationBidLabel(model, bid) {
  const name = resolveBidContractorName(model, bid)
    || String(bid?.tenNhaThau || "").trim()
    || "Nhà thầu chưa có tên";
  const lotCode = String(bid?.maPhanLo || "").trim();
  const lotName = String(bid?.tenPhanLo || "").trim();
  const lotPrefix = lotCode ? `[${lotCode}] ` : "";
  const lotSuffix = lotName ? ` – ${lotName}` : "";
  const identity = !lotCode && bid?.maDinhDanh
    ? ` – MST ${String(bid.maDinhDanh).trim()}`
    : "";
  return `${lotPrefix}${name}${lotSuffix}${identity}`;
}

function parseEvaluationMetadata(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const LEGACY_SUMMARY_CODES = new Set([
  "VALIDITY_SUMMARY",
  "CAPACITY_SUMMARY",
  "TECHNICAL_SUMMARY",
  "FINANCIAL_SUMMARY",
]);

function isLegacySummaryCriteria(criteria) {
  return Array.isArray(criteria)
    && criteria.length > 0
    && criteria.every((criterion) => LEGACY_SUMMARY_CODES.has(
      String(criterion?.code || criterion?.maTieuChi || "").toUpperCase(),
    ));
}

export function getDetailedReportForRound(bid, roundType) {
  return (bid?.baoCaoDanhGiaChiTietList || []).find(
    (report) => String(report?.loaiVong || "") === String(roundType || ""),
  ) || null;
}

export function isDetailedEvaluationSummaryOwned(report) {
  return report?.trangThai === "completed"
    || report?.extension?.projectionPending === true;
}

export function getCriteriaForGroup(pkg, roundType, group) {
  const metadata = parseEvaluationMetadata(pkg?.danhGiaHsdtMetadata);
  const block = roundType === "single" ? metadata : metadata?.[roundType] || {};
  const roundId = `evaluation-round:${String(pkg?.id || "pending")}:${roundType}`;
  const criteria = Array.isArray(block?.criteria)
    && block.criteria.length > 0
    && !isLegacySummaryCriteria(block.criteria)
    ? block.criteria
    : createDefaultDetailedEvaluationCriteria(roundType, { roundId, pkg });
  return criteria
    .map((criterion, index) => ({
      ...criterion,
      id: criterion.id || `evaluation-criterion:${roundId}:${criterion.code || index}`,
      group: criterion.group || criterion.nhomDanhGia || "technical",
      resultType: criterion.resultType || criterion.loaiKetQua || "pass_fail",
      required: criterion.required ?? Boolean(criterion.batBuoc ?? true),
      order: Number(criterion.order ?? criterion.thuTu ?? index),
    }))
    .filter((criterion) => criterion.group === group)
    .sort((left, right) => left.order - right.order);
}

export function getDetailedEvaluationProgress(report, criteria = []) {
  const rows = new Map(
    (report?.chiTietList || []).map((row) => [String(row.tieuChiDanhGiaId), row]),
  );
  const completed = criteria.filter((criterion) => {
    const row = rows.get(String(criterion.id));
    return row && row.ketQua && row.ketQua !== "pending";
  }).length;
  const requiredCriteria = criteria.filter((criterion) => criterion.required !== false);
  const requiredCompleted = requiredCriteria.filter((criterion) => {
    const row = rows.get(String(criterion.id));
    return row && row.ketQua && row.ketQua !== "pending";
  }).length;
  return {
    completed,
    total: criteria.length,
    requiredCompleted,
    requiredTotal: requiredCriteria.length,
  };
}
