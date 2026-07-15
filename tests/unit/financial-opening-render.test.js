import test from "node:test";
import assert from "node:assert/strict";

import { renderFinancialOpeningTable, validateFinancialOpeningRows } from "../../frontend/packages/detail/FinancialOpeningPanel.js";

test("financial opening table renders editable values and escapes bidder cells", () => {
  const model = {
    state: { nhathau: [] },
    formatVND: value => value ? "1.000" : ""
  };
  const html = renderFinancialOpeningTable({
    model,
    pkg: { id: "gt-1", phanLo: "Có", linhVuc: "Tư vấn" },
    bids: [{ id: "bid-1", maPhanLo: "01<", tenPhanLo: "Lô A", maNhaThau: "VN01", tenNhaThau: "Nhà thầu A", giaDuThau: 1000 }],
    isReadOnly: false,
    canEdit: true
  });
  assert.match(html, /data-opening-bid-id="bid-1"/);
  assert.match(html, /01&lt;/);
  assert.match(html, /op-gia-du-thau/);
  assert.match(html, /op-hieu-luc-hsdt/);
  assert.match(html, /btn-save-opening-fin/);
});

function createFinancialOpeningRow(values = {}) {
  const inputs = {
    ".op-gia-du-thau": { value: values.price ?? "" },
    ".op-ty-le-giam": { value: values.discount ?? "" },
    ".op-gia-sau-giam": { value: values.finalPrice ?? "" },
    ".op-hieu-luc-hsdt": { value: values.validity ?? "" }
  };
  return { inputs, querySelector: selector => inputs[selector] || null };
}

test("financial opening rejects missing or invalid bidder values", () => {
  const row = createFinancialOpeningRow({ price: "", discount: "101", finalPrice: "", validity: "abc" });
  const result = validateFinancialOpeningRows([row], {
    parseVND: value => Number(String(value).replaceAll(".", "")) || 0,
    isConsulting: true
  });
  assert.equal(result.valid, false);
  assert.equal(result.invalidInputs.includes(row.inputs[".op-gia-du-thau"]), true);
  assert.equal(result.invalidInputs.includes(row.inputs[".op-ty-le-giam"]), true);
  assert.equal(result.invalidInputs.includes(row.inputs[".op-hieu-luc-hsdt"]), true);
});

test("financial opening accepts complete bidder values", () => {
  const row = createFinancialOpeningRow({ price: "100.000", discount: "5", finalPrice: "95.000", validity: "90 ngày" });
  const result = validateFinancialOpeningRows([row], {
    parseVND: value => Number(String(value).replaceAll(".", "")) || 0,
    isConsulting: true
  });
  assert.equal(result.valid, true);
});
