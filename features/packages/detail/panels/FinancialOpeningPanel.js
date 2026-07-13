import { bindCurrencyElement } from "../../../../controllers/main_controller/domUtils.js";
import { renderBidContractorLink } from "../components/BidderTable.js";
import { escapeHtml } from "../../../../views/subviews/view_helpers.js";

export function renderFinancialOpeningTable({
  model,
  pkg,
  bids = [],
  isReadOnly = false,
  canEdit = false,
  hasTechnicalScore = false
} = {}) {
  const hasLots = pkg?.phanLo === "Có";
  const isConsulting = pkg?.linhVuc === "Tư vấn";
  const rows = bids.map((bid) => {
    const bidPrice = model.formatVND(bid.giaDuThau) || "";
    const discount = String(bid.tyLeGiamGia || 0).replace(".", ",");
    const finalPrice = model.formatVND(bid.giaSauGiamGia) || "";
    const validity = bid.hieuLucHsdt || bid.hieuLucHsdxt || "";
    const identity = escapeHtml(bid.maNhaThau || bid.maDinhDanh || "--");
    const contractor = renderBidContractorLink(model, bid, `${pkg.id}_financial_${isReadOnly ? "readonly" : "edit"}_${bid.id}`);
    const lotCells = hasLots ? `<td>${escapeHtml(bid.maPhanLo || "--")}</td><td>${escapeHtml(bid.tenPhanLo || "--")}</td>` : "";
    const scoreCell = hasTechnicalScore ? `<td class="text-center">${escapeHtml(bid.danhGiaKyThuat || "--")}</td>` : "";
    if (isReadOnly) {
      const validityText = validity ? `${validity}${String(validity).includes("ngày") ? "" : " ngày"}` : "--";
      return `<tr>${lotCells}<td>${identity}</td><td>${contractor}</td>${scoreCell}<td>${escapeHtml(bidPrice || "--")}</td><td class="text-right">${escapeHtml(discount)}</td><td>${escapeHtml(finalPrice || "--")}</td>${isConsulting ? `<td>${escapeHtml(validityText)}</td>` : ""}</tr>`;
    }
    const validityValue = validity ? `${validity}${String(validity).includes("ngày") ? "" : " ngày"}` : "";
    return `<tr data-opening-bid-id="${escapeHtml(bid.id)}">${lotCells}<td>${identity}</td><td>${contractor}</td>${scoreCell}
      <td><input type="text" class="form-control op-gia-du-thau table-input-compact" value="${escapeHtml(bidPrice)}" placeholder="Nhập giá..."></td>
      <td><input type="text" class="form-control op-ty-le-giam table-input-compact text-right" value="${escapeHtml(discount)}" placeholder="0"></td>
      <td><input type="text" class="form-control op-gia-sau-giam table-input-compact readonly-soft" value="${escapeHtml(finalPrice)}" readonly></td>
      ${isConsulting ? `<td><input type="text" class="form-control op-hieu-luc-hsdt table-input-compact" value="${escapeHtml(validityValue)}" placeholder="Ví dụ: 90 ngày"></td>` : ""}
    </tr>`;
  }).join("");
  return `<p class="text-muted package-help-text">Nhập giá dự thầu, tỷ lệ giảm giá của các nhà thầu vượt qua bước đánh giá kỹ thuật.</p>
    <div class="table-container package-table-frame has-bottom-space">
      <table class="data-table table-full-width" id="opening-fin-table"><thead><tr>
        ${hasLots ? '<th class="col-number">Mã phần lô</th><th class="col-lot-name">Tên phần lô</th>' : ""}
        <th>Mã nhà thầu</th><th>Tên nhà thầu</th>${hasTechnicalScore ? '<th class="col-score text-center">Điểm kỹ thuật</th>' : ""}
        <th class="col-price">Giá dự thầu (VNĐ)</th><th class="col-index">Tỷ lệ %</th><th class="col-price">Giá sau giảm</th>
        ${isConsulting ? '<th class="col-validity">Hiệu lực E-HSĐXTC</th>' : ""}
      </tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="workflow-action-row">${isReadOnly
      ? canEdit ? '<button class="btn btn-primary workflow-primary-action" id="btn-edit-opening-fin"><i data-lucide="edit"></i> Chỉnh sửa</button>' : ""
      : '<button class="btn btn-primary workflow-primary-action" id="btn-save-opening-fin"><i data-lucide="save"></i> Lưu Biên bản mở E-HSĐXTC</button>'}
    </div>`;
}

export function bindFinancialOpeningRows(container, { parseVND, formatVND } = {}) {
  const rows = Array.from(container?.querySelectorAll?.("#opening-fin-table tbody tr") || []);
  rows.forEach((row) => {
    const priceInput = row.querySelector(".op-gia-du-thau");
    const discountInput = row.querySelector(".op-ty-le-giam");
    const finalPriceInput = row.querySelector(".op-gia-sau-giam");
    const recalculate = () => {
      const base = parseVND(priceInput?.value || "");
      const percent = Number.parseFloat(String(discountInput?.value || "0").replace(/,/g, ".")) || 0;
      if (finalPriceInput) finalPriceInput.value = formatVND(base * (1 - percent / 100)) || "";
    };
    if (priceInput) {
      bindCurrencyElement(priceInput, formatVND);
      priceInput.addEventListener("input", recalculate);
    }
    discountInput?.addEventListener("input", recalculate);
  });
  return rows;
}

export function collectFinancialOpeningRows(rows, { parseVND } = {}) {
  return (rows || []).map((row) => {
    const validityInput = row.querySelector(".op-hieu-luc-hsdt");
    return {
      id: row.getAttribute("data-opening-bid-id"),
      giaDuThau: parseVND(row.querySelector(".op-gia-du-thau")?.value || ""),
      tyLeGiamGia: Number.parseFloat(String(row.querySelector(".op-ty-le-giam")?.value || "0").replace(/,/g, ".")) || 0,
      giaSauGiamGia: parseVND(row.querySelector(".op-gia-sau-giam")?.value || ""),
      hieuLucHsdt: validityInput ? Number.parseInt(validityInput.value, 10) || 0 : null
    };
  });
}
