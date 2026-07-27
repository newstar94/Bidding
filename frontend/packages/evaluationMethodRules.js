export const EVALUATION_METHODS = Object.freeze({
  LOWEST_PRICE: "Giá thấp nhất",
  EVALUATED_PRICE: "Giá đánh giá",
  FIXED_PRICE: "Giá cố định",
  COMBINED: "Kết hợp giữa kỹ thuật và giá",
  TECHNICAL: "Dựa trên kỹ thuật",
});

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
const TENDER_FORMS = new Set(["Đấu thầu rộng rãi", "Đấu thầu hạn chế"]);

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
