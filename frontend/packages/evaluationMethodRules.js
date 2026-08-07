export const EVALUATION_METHODS = Object.freeze({
  LOWEST_PRICE: "Giá thấp nhất",
  EVALUATED_PRICE: "Giá đánh giá",
  FIXED_PRICE: "Giá cố định",
  COMBINED: "Kết hợp giữa kỹ thuật và giá",
  TECHNICAL: "Dựa trên kỹ thuật",
});

/**
 * The combined technical/price method uses a numeric technical score in the
 * summary bid-evaluation table.  Keep this rule in one place so the editor,
 * import path, and ranking logic agree on what constitutes a score.
 */
export function requiresTechnicalScoreInput(packageOrMethod) {
  const method = typeof packageOrMethod === "string"
    ? packageOrMethod
    : packageOrMethod?.phuongPhapDanhGia;
  return method === EVALUATION_METHODS.COMBINED;
}

export function parseTechnicalScore(value) {
  const normalized = String(value ?? "").trim().replace(/,/g, ".");
  if (!normalized || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const score = Number(normalized);
  return Number.isFinite(score) && score >= 0 ? score : null;
}

export function validateTechnicalScore(value, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return required
      ? { valid: false, message: "Vui lòng nhập điểm kỹ thuật." }
      : { valid: true, score: null };
  }
  const score = parseTechnicalScore(normalized);
  return score === null
    ? { valid: false, message: "Điểm kỹ thuật phải là số không âm." }
    : { valid: true, score };
}

const STANDARD_METHODS = Object.freeze([
  EVALUATION_METHODS.LOWEST_PRICE,
  EVALUATION_METHODS.EVALUATED_PRICE,
]);

const ADVANCED_METHODS = Object.freeze([
  ...STANDARD_METHODS,
  EVALUATION_METHODS.COMBINED,
  EVALUATION_METHODS.TECHNICAL,
]);

const CONSULTING_METHODS = Object.freeze([
  EVALUATION_METHODS.LOWEST_PRICE,
  EVALUATION_METHODS.FIXED_PRICE,
  EVALUATION_METHODS.COMBINED,
  EVALUATION_METHODS.TECHNICAL,
]);

const STANDARD_FIELDS = new Set(["Hàng hóa", "Xây lắp", "Phi tư vấn", "Hỗn hợp"]);
const TWO_STAGE_FIELDS = new Set(["Hàng hóa", "Xây lắp", "Hỗn hợp"]);
const TENDER_FORMS = new Set([
  "Đấu thầu rộng rãi",
  "Đấu thầu hạn chế",
  "Chỉ định thầu",
]);

export function getEvaluationMethods({
  linhVuc = "",
  hinhThucLuaChon = "",
  phuongThucLuaChon = "",
} = {}) {
  if (linhVuc === "Tư vấn") {
    return TENDER_FORMS.has(hinhThucLuaChon)
      && phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ"
      ? [...CONSULTING_METHODS]
      : [];
  }

  if (!STANDARD_FIELDS.has(linhVuc)) return [];

  if (hinhThucLuaChon === "Chào hàng cạnh tranh") {
    return phuongThucLuaChon === "Một giai đoạn một túi hồ sơ"
      ? [...STANDARD_METHODS]
      : [];
  }

  if (!TENDER_FORMS.has(hinhThucLuaChon)) return [];

  if (phuongThucLuaChon === "Một giai đoạn một túi hồ sơ") {
    return [...STANDARD_METHODS];
  }
  if (phuongThucLuaChon === "Một giai đoạn hai túi hồ sơ") {
    return [...ADVANCED_METHODS];
  }
  if (TWO_STAGE_FIELDS.has(linhVuc)) {
    if (phuongThucLuaChon === "Hai giai đoạn một túi hồ sơ") {
      return [...STANDARD_METHODS];
    }
    if (phuongThucLuaChon === "Hai giai đoạn hai túi hồ sơ") {
      return [...ADVANCED_METHODS];
    }
  }
  return [];
}
