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

function parseMetadataRecord(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
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

function batchSequence(batch, fallback = 0) {
  const value = Number(batch?.sequenceNo ?? batch?.sequence_no ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isFinalBatch(batch) {
  const status = String(batch?.status || "").trim().toUpperCase();
  if (status === "FINAL" || status === "CLOSED") return true;

  // Compatibility for lot results saved before official round statuses were introduced.
  // Those records already contain an approved result, but have no batch status at all.
  return !status && batch?.saved === true && batch?.result?.saved === true;
}

export function getOfficialEvaluationLotState(pkg, metadataBlock = {}) {
  const lots = getPackageEvaluationLots(pkg);
  const batches = Object.entries(metadataBlock?.lotBatches || {})
    .map(([key, value], index) => ({
      ...(value || {}),
      batchId: String(value?.batchId || value?.id || key),
      sequenceNo: batchSequence(value, index + 1),
    }))
    .filter((batch) => Array.isArray(batch.lotIds) && batch.lotIds.length > 0)
    .sort((left, right) => left.sequenceNo - right.sequenceNo || left.batchId.localeCompare(right.batchId));
  const completed = new Set(
    batches.filter(isFinalBatch).flatMap((batch) => unique(batch.lotIds)),
  );
  const activeBatch = batches.find((batch) => batch.status === "ACTIVE") || null;
  return {
    batches,
    history: batches.filter(isFinalBatch),
    activeBatch,
    completedLotIds: lots.filter((lot) => completed.has(lot.id)).map((lot) => lot.id),
    completedLots: lots.filter((lot) => completed.has(lot.id)),
    pendingLots: lots.filter((lot) => !completed.has(lot.id)),
    isComplete: lots.length > 0 && lots.every((lot) => completed.has(lot.id)),
  };
}

export function resolvePackageResultStatus(pkg, editState = {}) {
  const storedStatus = String(pkg?.trangThai || "").trim();
  if (storedStatus === "Hủy thầu") return storedStatus;

  const metadata = parseMetadataRecord(pkg?.danhGiaHsdtMetadata);
  if (!metadata) return storedStatus;
  const isTwoEnvelope = pkg?.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ";
  const lifecycleMetadata = isTwoEnvelope ? metadata?.technical || {} : metadata;
  const persistedEditState = metadata?.resultEdit || lifecycleMetadata?.resultEdit || {};
  const isEditingWholePackage = editState?.editingWholePackage === true
    || persistedEditState?.type === "whole";
  if (isEditingWholePackage) {
    return "Đang chấm thầu";
  }
  const editingBatchId = String(
    editState?.editingBatchId
    || (persistedEditState?.type === "batch" ? persistedEditState?.batchId : "")
    || "",
  ).trim();
  if (editingBatchId && pkg?.phanLo === "Có") {
    const state = getOfficialEvaluationLotState(pkg, lifecycleMetadata);
    const editingBatchExists = state.history.some(
      (batch) => String(batch.batchId || "") === editingBatchId,
    );
    if (editingBatchExists) {
      const completedByOtherBatches = new Set(
        state.history
          .filter((batch) => String(batch.batchId || "") !== editingBatchId)
          .flatMap((batch) => unique(batch.lotIds)),
      );
      return completedByOtherBatches.size > 0
        ? "Đã có kết quả một phần"
        : "Đang chấm thầu";
    }
  }
  if (storedStatus === "Đã có kết quả") return storedStatus;
  if (pkg?.phanLo !== "Có" && metadata?.result?.saved === true) {
    return "Đã có kết quả";
  }
  const state = getOfficialEvaluationLotState(pkg, lifecycleMetadata);
  if (state.isComplete) return "Đã có kết quả";
  if (state.history.length > 0) return "Đã có kết quả một phần";
  return storedStatus;
}

export function setPackageResultEditState(pkg, editState = {}) {
  if (!pkg) return false;
  const type = editState?.type === "batch" ? "batch" : "whole";
  const batchId = type === "batch" ? String(editState?.batchId || "").trim() : "";
  if (type === "batch" && !batchId) return false;
  const metadata = parseMetadataRecord(pkg.danhGiaHsdtMetadata);
  if (!metadata) return false;
  const resultEdit = type === "batch" ? { type, batchId } : { type };
  metadata.resultEdit = resultEdit;
  if (pkg?.phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ") {
    metadata.technical = metadata.technical && typeof metadata.technical === "object"
      ? metadata.technical
      : {};
    metadata.technical.resultEdit = resultEdit;
  }
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  if (pkg.trangThai !== "Hủy thầu") {
    pkg.trangThai = resolvePackageResultStatus(pkg);
  }
  return true;
}

export function clearPackageResultEditState(pkg) {
  if (!pkg) return false;
  const metadata = parseMetadataRecord(pkg.danhGiaHsdtMetadata);
  if (!metadata) return false;
  delete metadata.resultEdit;
  if (metadata.technical && typeof metadata.technical === "object") {
    delete metadata.technical.resultEdit;
  }
  pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
  if (pkg.trangThai !== "Hủy thầu") {
    pkg.trangThai = resolvePackageResultStatus(pkg);
  }
  return true;
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
  if (
    !batch
    || batch.saved !== true
    || isFinalBatch(batch)
    || !Array.isArray(batch.lotIds)
  ) return null;

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
  const officialState = getOfficialEvaluationLotState(pkg, block);
  const pendingLotIds = officialState.pendingLots.map((lot) => lot.id);
  const activeIds = unique(officialState.activeBatch?.lotIds).filter((id) => pendingLotIds.includes(id));
  const allLotIds = activeIds.length > 0 ? activeIds : pendingLotIds;
  if (allLotIds.length === 0) return null;

  const previousIds = unique(previous?.selectedLotIds).filter((id) => allLotIds.includes(id));
  if (previous && (previousIds.length > 0 || previous.mode === MODE_SELECTED)) {
    const previousMode = previous.mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL;
    const effectiveIds = previousMode === MODE_ALL ? allLotIds : previousIds;
    const matched = findScopedEvaluationMetadata(block, previousIds);
    return {
      mode: previousMode,
      selectedLotIds: effectiveIds,
      availableLotIds: allLotIds,
      batchId: matched?.batchId || previous.batchId || null,
    };
  }

  const activeBatch = officialState.activeBatch || (block?.activeLotBatchId && block?.lotBatches?.[block.activeLotBatchId]
    ? block.lotBatches[block.activeLotBatchId]
    : null);
  const storedIds = unique(activeBatch?.lotIds).filter((id) => allLotIds.includes(id));
  if (storedIds.length > 0) {
    return {
      mode: storedIds.length === pendingLotIds.length ? MODE_ALL : MODE_SELECTED,
      selectedLotIds: storedIds,
      availableLotIds: pendingLotIds,
      batchId: activeBatch.batchId || block.activeLotBatchId,
    };
  }

  return { mode: MODE_ALL, selectedLotIds: allLotIds, availableLotIds: allLotIds, batchId: null };
}

export function updateEvaluationLotScope(scope, lots, { mode, selectedLotIds } = {}) {
  const packageLotIds = (lots || []).map((lot) => String(lot.id));
  const allLotIds = unique(scope?.availableLotIds).filter((id) => packageLotIds.includes(id));
  const availableLotIds = allLotIds.length > 0 ? allLotIds : packageLotIds;
  const nextMode = mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL;
  const requested = unique(selectedLotIds ?? scope?.selectedLotIds).filter((id) => availableLotIds.includes(id));
  return {
    mode: nextMode,
    selectedLotIds: nextMode === MODE_ALL ? availableLotIds : requested,
    availableLotIds,
    batchId: null,
  };
}

export function getEvaluationLotScopeDetails(pkg, scope) {
  const lots = getPackageEvaluationLots(pkg);
  if (lots.length === 0) return null;
  const availableSet = new Set(unique(scope?.availableLotIds));
  const availableLots = availableSet.size > 0 ? lots.filter((lot) => availableSet.has(lot.id)) : lots;
  const selectedIds = scope?.mode === MODE_SELECTED
    ? unique(scope.selectedLotIds)
    : availableLots.map((lot) => lot.id);
  const selectedSet = new Set(selectedIds);
  const selectedLots = availableLots.filter((lot) => selectedSet.has(lot.id));
  return {
    mode: scope?.mode === MODE_SELECTED ? MODE_SELECTED : MODE_ALL,
    allLots: availableLots,
    packageLots: lots,
    selectedLots,
    lotIds: selectedLots.map((lot) => lot.id),
    lotCodes: selectedLots.map((lot) => lot.code),
    isWholePackage: selectedLots.length === lots.length,
    isAllRemaining: selectedLots.length === availableLots.length,
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
    ...(block?.lotBatches?.[batchId] || {}),
    ...activeBlock,
    batchId,
    sequenceNo: batchSequence(batch, Object.keys(block?.lotBatches || {}).length + 1),
    lotIds,
    lotCodes: unique(batch?.lotCodes),
    isWholePackage,
    status: "ACTIVE",
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

export function finalizeEvaluationScopeMetadata(block = {}, batchId, result = {}) {
  const normalizedBatchId = String(batchId || "").trim();
  const batch = block?.lotBatches?.[normalizedBatchId];
  if (!normalizedBatchId || !batch) return block;
  return {
    ...block,
    activeLotBatchId: block.activeLotBatchId === normalizedBatchId ? "" : block.activeLotBatchId,
    lotBatches: {
      ...(block.lotBatches || {}),
      [normalizedBatchId]: {
        ...batch,
        status: "FINAL",
        finalizedAt: result.finalizedAt || new Date().toISOString(),
        result: { ...(batch.result || {}), ...result, saved: true },
      },
    },
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
  approvalMode = "STAGED_APPROVAL",
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

export async function finalizeEvaluationLotBatch({
  packageId,
  batchId,
  outcomes,
  packageAward,
  fetcher,
}) {
  const normalizedBatchId = String(batchId || "").trim();
  if (
    !packageId
    || !normalizedBatchId
    || !packageAward
    || typeof packageAward !== "object"
    || typeof fetcher !== "function"
  ) {
    throw new Error("Không thể xác nhận kết quả chính thức của đợt phần lô.");
  }
  const response = await fetcher(
    `/api/packages/${encodeURIComponent(packageId)}/lot-batches/${encodeURIComponent(normalizedBatchId)}/finalize`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcomes: outcomes || {},
        packageAward,
      }),
    },
  );
  const body = await responseBody(response);
  if (!response?.ok) {
    throw new Error(body?.error || "Không thể xác nhận kết quả chính thức của đợt phần lô.");
  }
  return body;
}

export const EVALUATION_LOT_SCOPE_MODE = Object.freeze({
  ALL: MODE_ALL,
  SELECTED: MODE_SELECTED,
});
