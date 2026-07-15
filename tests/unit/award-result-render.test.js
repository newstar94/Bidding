import test from "node:test";
import assert from "node:assert/strict";

import { renderAwardedResultPanel } from "../../frontend/packages/detail/AwardResultPanel.js";

test("awarded result panel formats scalar values and hides appraisal for competitive quotation", () => {
  const container = { innerHTML: "" };
  renderAwardedResultPanel(container, {
    pkg: { hinhThucLuaChon: "Chào hàng cạnh tranh", giaTrungThau: 1000, soQuyetDinhKetQua: "1<QĐ" },
    winnerHtml: "<b>A</b>", bidderRowsHtml: "<tr></tr>", tableHeaderHtml: "<tr></tr>",
    appraisalNumber: "2/BC", appraisalDate: "2026-07-13", isEditable: true,
    formatCurrency: () => "1.000 đ", formatDate: () => "13/07/2026"
  });
  assert.match(container.innerHTML, /1\.000 đ/);
  assert.match(container.innerHTML, /1&lt;QĐ/);
  assert.doesNotMatch(container.innerHTML, /2\/BC/);
  assert.match(container.innerHTML, /btn-edit-result-bottom/);
});
