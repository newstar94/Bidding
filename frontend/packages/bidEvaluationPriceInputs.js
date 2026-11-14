import { parseSignedMoney } from "./bidEvaluationPriceDefaults.js";

const ADJUSTMENT_SELECTORS = Object.freeze({
  giaTriSuaLoi: ".mt-gia-tri-sua-loi",
  giaTriHieuChinhSaiLech: ".mt-gia-tri-hieu-chinh-sai-lech",
  giaTriQuyDoi: ".mt-gia-tri-quy-doi",
});

// Reads the ADR 0107 adjustment inputs and the manual/automatic state of the
// ranking and proposed award prices from one evaluation row. Fields whose input
// is not on the row are left out, so their stored values are kept.
export function readEvaluationPriceAdjustments(row) {
  const result = {};
  Object.entries(ADJUSTMENT_SELECTORS).forEach(([field, selector]) => {
    const input = row?.querySelector?.(selector);
    if (!input) return;
    const amount = parseSignedMoney(input.value);
    result[field] = amount === null ? null : amount.toString();
  });
  const rankingPrice = row?.querySelector?.(".mt-gia-xep-hang");
  if (rankingPrice?.dataset?.priceAuto) {
    result.giaXepHangNhapTay = rankingPrice.dataset.priceAuto !== "true";
  }
  const proposedAwardPrice = row?.querySelector?.(".mt-gia-de-nghi-trung-thau");
  if (proposedAwardPrice?.dataset?.priceAuto) {
    result.giaDeNghiTrungThauNhapTay = proposedAwardPrice.dataset.priceAuto !== "true";
  }
  return result;
}
