const EMPTY_AWARD = Object.freeze({
  nhaThauTrungThauId: "",
  giaTrungThau: 0,
  thoiGianGoiThau: "",
  thoiGianHopDong: "",
});

function normalizedIdentity(value) {
  return String(value ?? "").trim();
}

function normalizedLotCode(value) {
  return normalizedIdentity(value).toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
}

function immutableLotId(lot) {
  return normalizedIdentity(lot?.id ?? lot?.lotId ?? lot?.lot_id);
}

function lotCode(lot) {
  return normalizedLotCode(lot?.maPhanLo ?? lot?.ma_phan_lo ?? lot?.code);
}

function isLotInScope(lot, scope) {
  const id = immutableLotId(lot);
  if (id) {
    const selectedIds = new Set((scope?.lotIds || []).map(normalizedIdentity).filter(Boolean));
    return selectedIds.has(id);
  }
  const code = lotCode(lot);
  const selectedCodes = new Set((scope?.lotCodes || []).map(normalizedLotCode).filter(Boolean));
  return Boolean(code && selectedCodes.has(code));
}

function findScopedResult(lot, scopedLotResults) {
  const id = immutableLotId(lot);
  if (id) {
    return scopedLotResults.find((result) => immutableLotId(result) === id);
  }
  const code = lotCode(lot);
  return code ? scopedLotResults.find((result) => lotCode(result) === code) : undefined;
}

function awardPrice(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = normalizedIdentity(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function projectPackageAward(phanLoList) {
  const winningLots = phanLoList.filter((lot) => normalizedIdentity(lot?.nhaThauTrungThauId));
  const winnerById = new Map();
  winningLots.forEach((lot) => {
    const rawWinnerId = lot.nhaThauTrungThauId;
    const normalizedWinnerId = normalizedIdentity(rawWinnerId);
    if (!winnerById.has(normalizedWinnerId)) winnerById.set(normalizedWinnerId, rawWinnerId);
  });
  return {
    nhaThauTrungThauId: winnerById.size === 1 ? winnerById.values().next().value : "",
    giaTrungThau: winningLots.reduce((total, lot) => total + awardPrice(lot.giaTrungThau), 0),
  };
}

/**
 * Applies the complete award outcome for a selected lot scope without touching
 * lot objects outside that scope. A scoped lot omitted from scopedLotResults is
 * a deliberate no-winner outcome and has its legacy award fields cleared.
 */
export function mergeScopedAwardLotResults({ phanLoList = [], scope = {}, scopedLotResults = [] } = {}) {
  const fullList = Array.isArray(phanLoList) ? phanLoList : [];
  const updates = Array.isArray(scopedLotResults) ? scopedLotResults : [];
  const mergedList = fullList.map((lot) => {
    if (!isLotInScope(lot, scope)) return lot;
    const result = findScopedResult(lot, updates);
    if (!result || !normalizedIdentity(result.nhaThauTrungThauId)) {
      return { ...lot, ...(result || {}), ...EMPTY_AWARD };
    }
    return { ...lot, ...result };
  });

  return {
    phanLoList: mergedList,
    ...projectPackageAward(mergedList),
  };
}
