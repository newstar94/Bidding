export const EVALUATION_METHOD_CODES = Object.freeze({
  LOWEST_PRICE: "LOWEST_PRICE",
  EVALUATED_PRICE: "EVALUATED_PRICE",
  FIXED_PRICE: "FIXED_PRICE",
  COMBINED_TECHNICAL_PRICE: "COMBINED_TECHNICAL_PRICE",
  TECHNICAL_BASED: "TECHNICAL_BASED",
});

export const EVALUATION_METHOD_LABELS = Object.freeze({
  [EVALUATION_METHOD_CODES.LOWEST_PRICE]: "Giá thấp nhất",
  [EVALUATION_METHOD_CODES.EVALUATED_PRICE]: "Giá đánh giá",
  [EVALUATION_METHOD_CODES.FIXED_PRICE]: "Giá cố định",
  [EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE]: "Kết hợp giữa kỹ thuật và giá",
  [EVALUATION_METHOD_CODES.TECHNICAL_BASED]: "Dựa trên kỹ thuật",
});

// Compatibility labels for existing select values and persisted workspaces.
export const EVALUATION_METHODS = Object.freeze({
  LOWEST_PRICE: EVALUATION_METHOD_LABELS[EVALUATION_METHOD_CODES.LOWEST_PRICE],
  EVALUATED_PRICE: EVALUATION_METHOD_LABELS[EVALUATION_METHOD_CODES.EVALUATED_PRICE],
  FIXED_PRICE: EVALUATION_METHOD_LABELS[EVALUATION_METHOD_CODES.FIXED_PRICE],
  COMBINED: EVALUATION_METHOD_LABELS[EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE],
  TECHNICAL: EVALUATION_METHOD_LABELS[EVALUATION_METHOD_CODES.TECHNICAL_BASED],
});

function normalizeToken(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("vi")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const EVALUATION_METHOD_CODE_BY_TOKEN = new Map([
  ["lowest price", EVALUATION_METHOD_CODES.LOWEST_PRICE],
  ["gia thap nhat", EVALUATION_METHOD_CODES.LOWEST_PRICE],
  ["evaluated price", EVALUATION_METHOD_CODES.EVALUATED_PRICE],
  ["gia danh gia", EVALUATION_METHOD_CODES.EVALUATED_PRICE],
  ["fixed price", EVALUATION_METHOD_CODES.FIXED_PRICE],
  ["gia co dinh", EVALUATION_METHOD_CODES.FIXED_PRICE],
  ["combined technical price", EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE],
  ["ket hop giua ky thuat va gia", EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE],
  ["ket hop ky thuat va gia", EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE],
  ["technical based", EVALUATION_METHOD_CODES.TECHNICAL_BASED],
  ["dua tren ky thuat", EVALUATION_METHOD_CODES.TECHNICAL_BASED],
]);

export function normalizeEvaluationMethod(valueOrPackage) {
  const value = valueOrPackage && typeof valueOrPackage === "object"
    ? valueOrPackage.evaluationMethodCode ?? valueOrPackage.phuongPhapDanhGia
    : valueOrPackage;
  return EVALUATION_METHOD_CODE_BY_TOKEN.get(normalizeToken(value)) || "";
}

export function evaluationMethodLabel(valueOrPackage) {
  const code = normalizeEvaluationMethod(valueOrPackage);
  return EVALUATION_METHOD_LABELS[code] || String(
    valueOrPackage && typeof valueOrPackage === "object"
      ? valueOrPackage.phuongPhapDanhGia || ""
      : valueOrPackage || "",
  );
}

export function isCombinedEvaluationMethod(valueOrPackage) {
  return normalizeEvaluationMethod(valueOrPackage)
    === EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE;
}

export function evaluationMethodUsesTechnicalScore(valueOrPackage) {
  return [
    EVALUATION_METHOD_CODES.FIXED_PRICE,
    EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE,
    EVALUATION_METHOD_CODES.TECHNICAL_BASED,
  ].includes(normalizeEvaluationMethod(valueOrPackage));
}

export function evaluationMethodDisplay(valueOrPackage) {
  const label = evaluationMethodLabel(valueOrPackage);
  if (!label || !valueOrPackage || typeof valueOrPackage !== "object") return label;
  const weight = valueOrPackage.trongSoKyThuat;
  return isCombinedEvaluationMethod(valueOrPackage) && weight !== undefined
    && weight !== null && String(weight).trim() !== ""
    ? `${label} (${weight}%)`
    : label;
}

/**
 * The combined technical/price method uses a numeric technical score in the
 * summary bid-evaluation table.  Keep this rule in one place so the editor,
 * import path, and ranking logic agree on what constitutes a score.
 */
export function requiresTechnicalScoreInput(packageOrMethod) {
  return isCombinedEvaluationMethod(packageOrMethod);
}

export function parseTechnicalScore(value) {
  if (!["string", "number"].includes(typeof value)) return null;
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
