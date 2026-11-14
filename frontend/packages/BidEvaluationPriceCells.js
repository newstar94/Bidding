import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import {
  isProposedAwardPriceBelowHalf,
  normalizeLowPriceAcceptance,
} from "./bidEvaluationLowPriceRules.js";
import {
  formatSignedMoney,
  resolveEvaluationPriceDefaults,
  usesDeltaG,
} from "./bidEvaluationPriceDefaults.js";

// ADR 0107: error correction, deviation adjustment and (evaluated price method) ΔG
// are entered per bid, right before the ranking and proposed award prices.
export const PRICE_ADJUSTMENT_FIELDS = Object.freeze([
  Object.freeze({ field: "giaTriSuaLoi", className: "mt-gia-tri-sua-loi", label: "Giá trị sửa lỗi" }),
  Object.freeze({ field: "giaTriHieuChinhSaiLech", className: "mt-gia-tri-hieu-chinh-sai-lech", label: "Giá trị hiệu chỉnh sai lệch" }),
  Object.freeze({ field: "giaTriQuyDoi", className: "mt-gia-tri-quy-doi", label: "Giá trị quy đổi ΔG", deltaG: true }),
]);

export function priceAdjustmentFields(pkg) {
  return PRICE_ADJUSTMENT_FIELDS.filter((definition) => !definition.deltaG || usesDeltaG(pkg));
}

function formatOptionalMoney(model, value) {
  return value === null || value === void 0 || value === ""
    ? ""
    : model.formatVND(value) || "";
}

function buildLowPriceDecision({ pkg, bid, proposedAwardPrice, rowReadOnly, disabled }) {
  const isWarning = isProposedAwardPriceBelowHalf(pkg, bid, proposedAwardPrice);
  const decision = normalizeLowPriceAcceptance(bid.chapThuanGiaDeNghiTrungThauDuoi50);
  const radioName = `low-price-acceptance-${String(bid.id || "bid")}`;
  const controlDisabled = rowReadOnly || Boolean(disabled);
  return {
    isWarning,
    html: `
      <div class="evaluation-low-price-decision" role="radiogroup" aria-label="Xử lý giá đề nghị trúng thầu dưới 50%"${isWarning ? "" : " hidden"}>
        <span class="evaluation-low-price-decision-title">Giá dưới 50%:</span>
        <label class="evaluation-low-price-option">
          <input type="radio" class="mt-low-price-acceptance" name="${safeAttr(radioName)}" value="true"${decision === true ? " checked" : ""}${controlDisabled ? " disabled" : ""}>
          <span>Chấp thuận</span>
        </label>
        <label class="evaluation-low-price-option">
          <input type="radio" class="mt-low-price-acceptance" name="${safeAttr(radioName)}" value="false"${decision === false ? " checked" : ""}${controlDisabled ? " disabled" : ""}>
          <span>Không chấp thuận</span>
        </label>
      </div>
    `,
  };
}

function autoAttributes(resolved) {
  if (!resolved.auto) return ' data-price-auto="false"';
  return ` data-price-auto="true" title="${safeAttr(`${resolved.label}. Có thể nhập giá khác.`)}"`;
}

function buildAdjustmentCells({ pkg, bid, model, rowReadOnly, disabled }) {
  return priceAdjustmentFields(pkg).map(({ field, className, label }) => {
    const value = formatSignedMoney(bid[field], (amount) => model.formatVND(amount));
    if (rowReadOnly) {
      return `<td><span class="bf-money-display">${escapeHtml(value || "--")}</span></td>`;
    }
    return `<td><input type="text" class="form-control ${className}" value="${escapeHtml(value)}" placeholder="0" inputmode="numeric" aria-label="${safeAttr(label)}" title="${safeAttr(`${label} (nhập số âm nếu làm giảm giá)`)}"${disabled}></td>`;
  }).join("");
}

export function buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly, disabled = "" }) {
  const adjustmentCells = buildAdjustmentCells({ pkg, bid, model, rowReadOnly, disabled });
  if (rowReadOnly) {
    const rankingPrice = formatOptionalMoney(model, bid.giaXepHang);
    const proposedAwardPrice = formatOptionalMoney(model, bid.giaDeNghiTrungThau);
    const lowPriceDecision = buildLowPriceDecision({
      pkg,
      bid,
      proposedAwardPrice: bid.giaDeNghiTrungThau,
      rowReadOnly,
      disabled,
    });
    const warningClass = lowPriceDecision.isWarning ? " is-low-price-warning" : "";
    return `
      ${adjustmentCells}
      <td><span class="bf-money-display">${escapeHtml(rankingPrice || "--")}</span></td>
      <td>
        <span class="evaluation-proposed-award-price bf-money-display${warningClass}">${escapeHtml(proposedAwardPrice || "--")}</span>
        ${lowPriceDecision.html}
      </td>
    `;
  }
  const defaults = resolveEvaluationPriceDefaults(bid, pkg);
  const rankingPrice = formatOptionalMoney(model, defaults.ranking.value);
  const proposedAwardPrice = formatOptionalMoney(model, defaults.proposedAward.value);
  const lowPriceDecision = buildLowPriceDecision({
    pkg,
    bid,
    proposedAwardPrice: defaults.proposedAward.value,
    rowReadOnly,
    disabled,
  });
  const warningClass = lowPriceDecision.isWarning ? " is-low-price-warning" : "";
  return `
    ${adjustmentCells}
    <td><input type="text" class="form-control mt-gia-xep-hang" value="${escapeHtml(rankingPrice)}" placeholder="Nhập giá xếp hạng..."${autoAttributes(defaults.ranking)}${disabled}></td>
    <td>
      <input type="text" class="form-control mt-gia-de-nghi-trung-thau${warningClass}" value="${escapeHtml(proposedAwardPrice)}" placeholder="Nhập giá đề nghị..."${autoAttributes(defaults.proposedAward)}${disabled}>
      ${lowPriceDecision.html}
    </td>
  `;
}
