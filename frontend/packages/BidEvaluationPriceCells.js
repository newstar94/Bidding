import { escapeHtml, safeAttr } from "../shared/view_helpers.js";
import {
  isProposedAwardPriceBelowHalf,
  normalizeLowPriceAcceptance,
} from "./bidEvaluationLowPriceRules.js";

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

export function buildEvaluationPriceCells({ pkg, bid, model, rowReadOnly, disabled = "" }) {
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
  if (rowReadOnly) {
    return `
      <td><span class="bf-money-display">${escapeHtml(rankingPrice || "--")}</span></td>
      <td>
        <span class="evaluation-proposed-award-price bf-money-display${warningClass}">${escapeHtml(proposedAwardPrice || "--")}</span>
        ${lowPriceDecision.html}
      </td>
    `;
  }
  return `
    <td><input type="text" class="form-control mt-gia-xep-hang" value="${escapeHtml(rankingPrice)}" placeholder="Nhập giá xếp hạng..."${disabled}></td>
    <td>
      <input type="text" class="form-control mt-gia-de-nghi-trung-thau${warningClass}" value="${escapeHtml(proposedAwardPrice)}" placeholder="Nhập giá đề nghị..."${disabled}>
      ${lowPriceDecision.html}
    </td>
  `;
}
