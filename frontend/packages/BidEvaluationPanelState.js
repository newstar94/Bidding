import {
  findScopedEvaluationMetadata,
  initializeEvaluationLotScope,
  resolveActiveSavedEvaluationScope,
  resolvePackageResultStatus,
} from "./lotEvaluationScope.js";

const EMPTY_REPORT_METADATA = Object.freeze({
  soBaoCao: "",
  ngayBaoCao: "",
  cvLamRo: [],
  cvTraLoi: [],
  cvGuiCdt: [],
});

function emptyReportMetadata(extra = {}) {
  return {
    ...EMPTY_REPORT_METADATA,
    cvLamRo: [],
    cvTraLoi: [],
    cvGuiCdt: [],
    ...extra,
  };
}

function parseMetadata(value) {
  if (!value) return emptyReportMetadata();
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : emptyReportMetadata();
  } catch {
    return emptyReportMetadata();
  }
}

function normalizeMetadata(pkg, rawMetadata) {
  const metadata = parseMetadata(rawMetadata);
  const isTwoEnvelope = pkg.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  if (!isTwoEnvelope || metadata.is1G2T) return metadata;
  const legacyMetadata = { ...metadata };
  return {
    is1G2T: true,
    technical: legacyMetadata.soBaoCao
      ? legacyMetadata
      : emptyReportMetadata({ saved: false }),
    financial: emptyReportMetadata({ saved: false }),
  };
}

function normalizeTab(requestedTab, isTwoEnvelope) {
  if (!isTwoEnvelope) return "unified";
  return requestedTab === "financial" ? "financial" : "technical";
}

export function evaluationScopeKey(packageId, tab) {
  return `${String(packageId || "")}:${String(tab || "technical")}`;
}

export function buildBidEvaluationPanelState({
  pkg,
  rawMetadata = pkg?.danhGiaHsdtMetadata,
  requestedTab = "technical",
  editingState = {},
  cachedScopes = {},
} = {}) {
  if (!pkg) throw new TypeError("Bid evaluation panel state requires a package.");
  const isTwoEnvelope = pkg.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const metadata = normalizeMetadata(pkg, rawMetadata);
  const activeTechnicalScope = isTwoEnvelope
    ? resolveActiveSavedEvaluationScope(pkg, metadata.technical || {})
    : null;
  const isTechnicalSaved = Boolean(
    isTwoEnvelope && (metadata.technical?.saved || activeTechnicalScope),
  );
  const isQualifiedSaved = Boolean(isTwoEnvelope && (
    metadata.technical?.qualifiedSaved || activeTechnicalScope?.batch?.qualifiedSaved
  ));
  let currentTab = normalizeTab(requestedTab, isTwoEnvelope);
  if (currentTab === "financial" && !isTechnicalSaved) currentTab = "technical";

  const baseMeta = isTwoEnvelope
    ? (currentTab === "financial" ? metadata.financial || {} : metadata.technical || {})
    : metadata;
  const lifecycleScopeMeta = isTwoEnvelope ? metadata.technical || {} : baseMeta;
  const scopeKey = evaluationScopeKey(pkg.id, currentTab);
  const lotScope = initializeEvaluationLotScope(
    pkg,
    lifecycleScopeMeta,
    cachedScopes?.[scopeKey],
  );
  const scopedMeta = lotScope
    ? findScopedEvaluationMetadata(baseMeta, lotScope.selectedLotIds)
    : null;
  const hasScopedHistory = Boolean(baseMeta?.lotBatches && Object.keys(baseMeta.lotBatches).length);
  const activeMeta = scopedMeta || (!hasScopedHistory ? baseMeta : {});
  const isCompleted = Boolean(activeMeta.saved);
  const stepKey = currentTab === "financial" ? "eval_fin" : "eval_tech";
  const isEditing = Boolean(editingState?.[stepKey]);
  const effectiveStatus = resolvePackageResultStatus(pkg);
  const isLocked = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const isTabLocked = isLocked || (isTwoEnvelope && currentTab === "technical" && isQualifiedSaved);
  const isReadOnly = isTabLocked || (isCompleted && !isEditing);

  return {
    activeMeta,
    activeTechnicalScope,
    baseMeta,
    currentTab,
    effectiveStatus,
    hasScopedHistory,
    isCompleted,
    isLocked,
    isQualifiedSaved,
    isReadOnly,
    isTabLocked,
    isTechnicalSaved,
    isTwoEnvelope,
    lotScope,
    metadata,
    scopeKey,
    stepKey,
  };
}
