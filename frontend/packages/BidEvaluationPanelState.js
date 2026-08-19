import {
  findScopedEvaluationMetadata,
  initializeEvaluationLotScope,
  resolveActiveSavedEvaluationScope,
  resolvePackageResultStatus,
} from "./lotEvaluationScope.js";
import {
  resolveWorkflowActionMode,
  WORKFLOW_ACTION_MODE,
} from "./workflowActionState.js";
import { parseEvaluationMetadataForDisplay } from "./evaluationMetadata.js";
import { evaluationDraftScopeKey } from "./BidEvaluationDraftState.js";

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
  const result = parseEvaluationMetadataForDisplay(value);
  return result.canPersist ? result.metadata : emptyReportMetadata();
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

function latestDraftScope(block = {}) {
  return Object.values(block?.draftScopes || {})
    .filter((draft) => Array.isArray(draft?.lotIds) && draft.lotIds.length > 0)
    .sort((left, right) => String(right.draftSavedAt || "").localeCompare(
      String(left.draftSavedAt || ""),
    ))[0] || null;
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
  const cachedScope = cachedScopes?.[scopeKey];
  const draftScope = !cachedScope ? latestDraftScope(baseMeta) : null;
  const lotScope = initializeEvaluationLotScope(
    pkg,
    lifecycleScopeMeta,
    cachedScope || (draftScope ? {
      mode: "selected",
      selectedLotIds: draftScope.lotIds,
    } : null),
  );
  const scopedMeta = lotScope
    ? findScopedEvaluationMetadata(baseMeta, lotScope.selectedLotIds)
    : null;
  const scopedDraftMeta = lotScope
    ? baseMeta?.draftScopes?.[evaluationDraftScopeKey(lotScope.selectedLotIds)] || null
    : null;
  const hasScopedHistory = Boolean(baseMeta?.lotBatches && Object.keys(baseMeta.lotBatches).length);
  const activeMeta = scopedMeta || scopedDraftMeta || (!hasScopedHistory ? baseMeta : {});
  const isCompleted = Boolean(activeMeta.saved);
  const stepKey = currentTab === "financial" ? "eval_fin" : "eval_tech";
  const isEditing = Boolean(editingState?.[stepKey]);
  const effectiveStatus = resolvePackageResultStatus(pkg);
  const isLocked = effectiveStatus === "Đã có kết quả" || effectiveStatus === "Hủy thầu";
  const isNextStepSaved = Boolean(
    isTwoEnvelope && currentTab === "technical" && isQualifiedSaved,
  );
  const actionMode = resolveWorkflowActionMode({
    isCompleted,
    isEditing,
    isNextStepSaved,
    isFinal: isLocked,
  });
  const isTabLocked = actionMode === WORKFLOW_ACTION_MODE.HIDDEN;
  const isReadOnly = actionMode !== WORKFLOW_ACTION_MODE.SAVE;

  return {
    actionMode,
    activeMeta,
    activeTechnicalScope,
    baseMeta,
    currentTab,
    effectiveStatus,
    hasScopedHistory,
    isCompleted,
    isLocked,
    isNextStepSaved,
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
