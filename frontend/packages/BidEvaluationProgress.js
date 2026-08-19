const STEP_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  COMPLETED: "COMPLETED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

function normalized(value) {
  return String(value ?? "").trim().toLocaleLowerCase("vi-VN");
}

function fail(value) {
  const result = normalized(value);
  return Boolean(result) && result !== "đạt";
}

function hasEvaluationResult(value) {
  const result = normalized(value);
  return result === "đạt" || result === "không đạt";
}

function validTechnical(value, requiresScore) {
  const result = normalized(value);
  if (!result) return false;
  if (!requiresScore) return true;
  const number = Number(result.replace(/,/g, "."));
  return Number.isFinite(number) && number >= 0;
}

function technicalBidStatus(bid, requiresScore) {
  const validityComplete = hasEvaluationResult(bid.danhGiaHopLe);
  const validityFailed = validityComplete && fail(bid.danhGiaHopLe);
  const capacityComplete = hasEvaluationResult(bid.danhGiaNangLuc);
  const capacityFailed = capacityComplete && fail(bid.danhGiaNangLuc);
  return {
    validity: validityComplete ? STEP_STATUS.COMPLETED : STEP_STATUS.NOT_STARTED,
    capacity: validityFailed
      ? STEP_STATUS.NOT_APPLICABLE
      : capacityComplete ? STEP_STATUS.COMPLETED : STEP_STATUS.NOT_STARTED,
    technical: validityFailed || capacityFailed
      ? STEP_STATUS.NOT_APPLICABLE
      : validTechnical(bid.danhGiaKyThuat, requiresScore)
        ? STEP_STATUS.COMPLETED
        : STEP_STATUS.NOT_STARTED,
  };
}

function financialBidStatus(bid) {
  const financialComplete = Number(bid.giaXepHang || 0) > 0
    || Boolean(String(bid.lamRoTaiChinh || "").trim());
  const financialFailed = bid.chapThuanGiaDeNghiTrungThauDuoi50 === false
    || normalized(bid.danhGiaKetLuan).startsWith("không đạt");
  const ranking = normalized(bid.danhGiaTaiChinh);
  const rankingComplete = Boolean(ranking && ranking !== "--" && ranking !== "chưa xếp hạng");
  return {
    financial: financialComplete ? STEP_STATUS.COMPLETED : STEP_STATUS.NOT_STARTED,
    ranking: financialFailed
      ? STEP_STATUS.NOT_APPLICABLE
      : rankingComplete ? STEP_STATUS.COMPLETED : STEP_STATUS.NOT_STARTED,
  };
}

function roundDefinitions(round) {
  return round === "financial"
    ? [
      ["financial", "Tài chính"],
      ["ranking", "Xếp hạng"],
    ]
    : [
      ["validity", "Hợp lệ"],
      ["capacity", "Năng lực"],
      ["technical", "Kỹ thuật"],
    ];
}

export function deriveBidEvaluationProgress({
  bids = [],
  round = "technical",
  requiresTechnicalScore = false,
} = {}) {
  const definitions = roundDefinitions(round);
  const byBid = {};
  (bids || []).forEach((bid, index) => {
    const id = String(bid?.id || `bid-${index}`);
    byBid[id] = round === "financial"
      ? financialBidStatus(bid)
      : technicalBidStatus(bid, requiresTechnicalScore);
  });
  const statuses = Object.values(byBid);
  const stages = definitions.map(([key, label]) => ({
    key,
    label,
    completed: statuses.filter((status) => status[key] === STEP_STATUS.COMPLETED).length,
    applicable: statuses.filter((status) => status[key] !== STEP_STATUS.NOT_APPLICABLE).length,
  }));
  const potentialSlots = statuses.length * definitions.length;
  const resolvedSlots = statuses.reduce((total, status) => total + definitions.filter(
    ([key]) => status[key] === STEP_STATUS.COMPLETED
      || status[key] === STEP_STATUS.NOT_APPLICABLE,
  ).length, 0);
  const percent = potentialSlots > 0 ? Math.round(resolvedSlots / potentialSlots * 100) : 0;
  return { percent, stages, resolvedSlots, potentialSlots, byBid, round };
}

export function getEvaluationProgressVisual(value) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (percent === 0) return { percent, state: "empty", startHue: 0, endHue: 0 };
  const endHue = Math.round(percent * 1.2);
  return {
    percent,
    state: percent === 100 ? "complete" : "in-progress",
    startHue: Math.max(0, endHue - 24),
    endHue,
  };
}

export function deriveDetailedEvaluationProgress({ report = {}, criteria = [] } = {}) {
  const rows = new Map((report?.chiTietList || []).map(
    (row) => [String(row.tieuChiDanhGiaId), row],
  ));
  const leafCriteria = (criteria || []).filter(
    (criterion) => criterion.isSection !== true && criterion.hasChildren !== true,
  );
  const required = leafCriteria.filter((criterion) => criterion.required !== false);
  const statuses = Object.fromEntries(leafCriteria.map((criterion) => {
    const result = String(rows.get(String(criterion.id))?.ketQua || "pending");
    return [criterion.id, result === "not_applicable"
      ? STEP_STATUS.NOT_APPLICABLE
      : result && result !== "pending"
        ? STEP_STATUS.COMPLETED
        : STEP_STATUS.NOT_STARTED];
  }));
  const completed = leafCriteria.filter(
    (criterion) => statuses[criterion.id] !== STEP_STATUS.NOT_STARTED,
  ).length;
  const requiredCompleted = required.filter(
    (criterion) => statuses[criterion.id] !== STEP_STATUS.NOT_STARTED,
  ).length;
  const percent = required.length > 0
    ? Math.round(requiredCompleted / required.length * 100)
    : 0;
  return {
    completed,
    total: leafCriteria.length,
    requiredCompleted,
    requiredTotal: required.length,
    percent,
    statuses,
  };
}

export { STEP_STATUS as BID_EVALUATION_STEP_STATUS };
