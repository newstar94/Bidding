const MODE_ALL = "all";
const MODE_SELECTED = "selected";

function parseList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedCode(value) {
  return String(value || "").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
}

function unique(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function sameScope(left, right) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getPackageEvaluationLots(pkg) {
  if (pkg?.phanLo !== "Có") return [];
  return parseList(pkg?.phanLoList).map((lot, index) => ({
    ...lot,
    id: String(lot?.id || "").trim(),
    code: String(lot?.maPhanLo || lot?.ma_phan_lo || "").trim(),
    name: String(lot?.tenPhanLo || lot?.ten_phan_lo || "").trim(),
    sortOrder: Number(lot?.sortOrder ?? lot?.sort_order ?? index),
  })).filter((lot) => lot.id && lot.code).sort((a, b) => (
    a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, "vi", { numeric: true })
  ));
}

export function findScopedEvaluationMetadata(block, selectedLotIds) {
  const batches = block?.lotBatches;
  if (!batches || typeof batches !== "object") return null;
  return Object.values(batches).find((item) => (
    item && sameScope(item.lotIds, selectedLotIds)
  )) || null;
}

export function resolveActiveSavedEvaluationScope(pkg, metadataBlock, preferredBatchId = "") {
  const lots = getPackageEvaluationLots(pkg);
  if (lots.length === 0 || !metadataBlock?.lotBatches || typeof metadataBlock.lotBatches !== "object") {
    return null;
  }

  const requestedBatchId = String(preferredBatchId || "").trim();
  const batchId = requestedBatchId || String(metadataBlock.activeLotBatchId || "").trim();
  if (!batchId) return null;

  const batch = metadataBlock.lotBatches[batchId];
  if (!batch || batch.saved !== true || !Array.isArray(batch.lotIds)) return null;

  const lotIds = batch.lotIds.map((lotId) => String(lotId || "").trim());
  const knownLots = new Map(lots.map((lot) => [lot.id, lot]));
  if (
    lotIds.length === 0
    || lotIds.some((lotId) => !lotId || !knownLots.has(lotId))
    || new Set(lotIds).size !== lotIds.length
  ) {
    return null;
  }

  return {
    batchId,
    lotIds,
    lotCodes: lotIds.map((lotId) => knownLots.get(lotId).code),
    isWholePackage: sameScope(lotIds, lots.map((lot) => lot.id)),
    batch,
  };
}

export function initializeEvaluationLotScope(pkg, block = {}, previous = null) {
  const lots = getPackageEvaluationLots(pkg);
  const allLotIds = lots.map((lot) => lot.id);
  if (allLotIds.length === 0) return null;

  const previousIds = unique(previous?.selectedLotIds).filter((id) => allLotIds.includes(id));
  if (previous) {
    const previousMode = previous.mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL;
    const effectiveIds = previousMode === MODE_ALL ? allLotIds : previousIds;
    const matched = findScopedEvaluationMetadata(block, previousIds);
    return {
      mode: previousMode,
      selectedLotIds: effectiveIds,
      batchId: matched?.batchId || previous.batchId || null,
    };
  }

  const activeBatch = block?.activeLotBatchId && block?.lotBatches?.[block.activeLotBatchId]
    ? block.lotBatches[block.activeLotBatchId]
    : null;
  const storedIds = unique(activeBatch?.lotIds).filter((id) => allLotIds.includes(id));
  if (storedIds.length > 0) {
    return {
      mode: storedIds.length === allLotIds.length ? MODE_ALL : MODE_SELECTED,
      selectedLotIds: storedIds,
      batchId: activeBatch.batchId || block.activeLotBatchId,
    };
  }

  return { mode: MODE_ALL, selectedLotIds: allLotIds, batchId: null };
}

export function updateEvaluationLotScope(scope, lots, { mode, selectedLotIds } = {}) {
  const allLotIds = (lots || []).map((lot) => String(lot.id));
  const nextMode = mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL;
  const requested = unique(selectedLotIds ?? scope?.selectedLotIds).filter((id) => allLotIds.includes(id));
  return {
    mode: nextMode,
    selectedLotIds: nextMode === MODE_ALL ? allLotIds : requested,
    batchId: null,
  };
}

export function getEvaluationLotScopeDetails(pkg, scope) {
  const lots = getPackageEvaluationLots(pkg);
  if (lots.length === 0) return null;
  const selectedIds = scope?.mode === MODE_SELECTED
    ? unique(scope.selectedLotIds)
    : lots.map((lot) => lot.id);
  const selectedSet = new Set(selectedIds);
  const selectedLots = lots.filter((lot) => selectedSet.has(lot.id));
  return {
    mode: scope?.mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL,
    allLots: lots,
    selectedLots,
    lotIds: selectedLots.map((lot) => lot.id),
    lotCodes: selectedLots.map((lot) => lot.code),
    isWholePackage: selectedLots.length === lots.length,
    batchId: scope?.batchId || null,
  };
}

export function isPartialEvaluationLotScope(details) {
  return Boolean(details?.lotIds?.length && !details.isWholePackage);
}

export function getActiveEvaluationLotScope(controller, pkg) {
  if (!controller || !pkg) return null;
  const key = `${String(pkg.id || "")}:${String(controller.currentDanhGiaTab || "technical")}`;
  const scope = controller._evaluationLotScopes?.[key];
  return scope ? getEvaluationLotScopeDetails(pkg, scope) : null;
}

export function isBidWithinEvaluationLotDetails(bid, details) {
  if (!details) return true;
  const selectedIds = new Set(details.lotIds || []);
  const selectedCodes = new Set((details.lotCodes || []).map(normalizedCode));
  const lotId = String(bid?.lotId || bid?.lot_id || "").trim();
  if (lotId) return selectedIds.has(lotId);
  return selectedCodes.has(normalizedCode(bid?.maPhanLo || bid?.ma_phan_lo));
}

export function filterBidsByEvaluationLotScope(bids, pkg, scope) {
  const details = getEvaluationLotScopeDetails(pkg, scope);
  if (!details) return [...(bids || [])];
  return (bids || []).filter((bid) => isBidWithinEvaluationLotDetails(bid, details));
}

export function saveEvaluationScopeMetadata(block = {}, batch, activeBlock, allLotIds) {
  const lotIds = unique(batch?.lotIds);
  const batchId = String(batch?.id || batch?.batchId || "").trim();
  if (!batchId || lotIds.length === 0) return { ...block, ...activeBlock };
  const isWholePackage = sameScope(lotIds, allLotIds);
  const scopedBlock = {
    ...activeBlock,
    batchId,
    lotIds,
    lotCodes: unique(batch?.lotCodes),
    isWholePackage,
  };
  return {
    ...block,
    ...(isWholePackage ? activeBlock : {}),
    saved: isWholePackage ? Boolean(activeBlock?.saved) : Boolean(block?.saved),
    lotBatches: {
      ...(block?.lotBatches || {}),
      [batchId]: scopedBlock,
    },
    activeLotBatchId: batchId,
  };
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function ensureWholePackageEvaluationAvailable({ packageId, fetcher }) {
  if (!packageId || typeof fetcher !== "function") {
    throw new Error("Không thể kiểm tra trạng thái đợt đánh giá phần lô.");
  }
  const response = await fetcher(`/api/packages/${encodeURIComponent(packageId)}/lot-lifecycle`);
  const lifecycle = await responseBody(response);
  if (!response?.ok) {
    throw new Error(lifecycle?.error || "Không thể kiểm tra trạng thái đợt đánh giá phần lô.");
  }
  const activeBatches = (lifecycle?.batches || []).filter((batch) => batch?.status === "ACTIVE");
  if (activeBatches.length > 0) {
    throw new Error(
      "Gói thầu đã có đợt đánh giá phần lô đang xử lý. Hãy tiếp tục từng đợt; không thể chuyển lại sang đánh giá toàn bộ khi chưa có bước hợp nhất đợt."
    );
  }
  return lifecycle;
}

function lotIdsOfBatch(batch) {
  if (Array.isArray(batch?.lotIds)) return unique(batch.lotIds);
  return unique((batch?.lots || []).map((lot) => lot?.lotId || lot?.lot_id));
}

export async function ensureEvaluationLotBatch({
  packageId,
  lotIds,
  fetcher,
  approvalMode = "CONSOLIDATED_APPROVAL",
}) {
  const selectedIds = unique(lotIds);
  if (!packageId || selectedIds.length === 0) {
    throw new Error("Vui lòng chọn ít nhất một phần lô để đánh giá.");
  }
  if (typeof fetcher !== "function") {
    throw new Error("Không thể kết nối dịch vụ xử lý phần lô.");
  }

  const lifecycleResponse = await fetcher(`/api/packages/${encodeURIComponent(packageId)}/lot-lifecycle`);
  const lifecycle = await responseBody(lifecycleResponse);
  if (!lifecycleResponse?.ok) {
    throw new Error(lifecycle?.error || "Không thể tải trạng thái xử lý phần lô.");
  }
  const existing = (lifecycle?.batches || []).find((batch) => (
    batch?.status === "ACTIVE" && sameScope(lotIdsOfBatch(batch), selectedIds)
  ));
  if (existing) {
    return { id: existing.id, lotIds: selectedIds, reused: true };
  }

  const createResponse = await fetcher(`/api/packages/${encodeURIComponent(packageId)}/lot-batches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lotIds: selectedIds,
      approvalMode,
      stagedApprovalAuthorized: false,
    }),
  });
  const created = await responseBody(createResponse);
  if (!createResponse?.ok) {
    const blockerMessage = (created?.blockers || []).map((item) => item?.message).filter(Boolean).join(" ");
    throw new Error(blockerMessage || created?.error || "Không thể tạo đợt đánh giá phần lô.");
  }
  return {
    ...(created?.batch || {}),
    id: created?.batch?.id,
    lotIds: lotIdsOfBatch(created?.batch).length ? lotIdsOfBatch(created.batch) : selectedIds,
    reused: false,
  };
}

export const EVALUATION_LOT_SCOPE_MODE = Object.freeze({
  ALL: MODE_ALL,
  SELECTED: MODE_SELECTED,
});
