import assert from "node:assert/strict";
import test from "node:test";

import { buildAwardedResultPanelMarkup } from "../../frontend/packages/detail/AwardResultPanel.js";

test("completed package summary and aggregate precede multi-round lot results", () => {
  const html = buildAwardedResultPanelMarkup({
    pkg: {
      hinhThucLuaChon: "Đấu thầu rộng rãi",
      giaTrungThau: 3,
      thoiGianGoiThau: "60 ngày",
      soQuyetDinhKetQua: "01/QĐ",
      ngayQuyetDinhKetQua: "2026-07-23",
    },
    winnerHtml: "<strong>Có nhiều nhà thầu trúng thầu</strong>",
    bidderRowsHtml: "<tr><td>Nhà thầu 1</td></tr>",
    tableHeaderHtml: "<tr><th>Nhà thầu</th></tr>",
    resultHistoryHtml: '<section class="official-result-history">Lần 1 · Lần 2</section>',
    isEditable: true,
    formatCurrency: (value) => `${value} đ`,
    formatDate: (value) => value,
  });

  const summaryPosition = html.indexOf("award-result-card");
  const historyPosition = html.indexOf("official-result-history");
  const aggregatePosition = html.indexOf("package-list-heading");

  assert.ok(summaryPosition >= 0);
  assert.ok(aggregatePosition > summaryPosition);
  assert.ok(historyPosition > aggregatePosition);
  assert.equal(html.includes('id="btn-edit-result-bottom"'), false);
});

test("a completed package without result rounds keeps the whole-result edit action below its table", () => {
  const html = buildAwardedResultPanelMarkup({
    pkg: { hinhThucLuaChon: "Đấu thầu rộng rãi" },
    winnerHtml: "--",
    bidderRowsHtml: "<tr><td>Nhà thầu 1</td></tr>",
    tableHeaderHtml: "<tr><th>Nhà thầu</th></tr>",
    isEditable: true,
    formatCurrency: (value) => String(value || 0),
    formatDate: (value) => value,
  });

  assert.ok(html.indexOf("package-table-frame") < html.indexOf('id="btn-edit-result-bottom"'));
  assert.match(html, /id="btn-edit-result-bottom"[\s\S]*data-lucide="edit-3"[\s\S]*Sửa kết quả/);
});
