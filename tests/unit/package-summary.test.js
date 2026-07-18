import test from "node:test";
import assert from "node:assert/strict";
import { renderPackageSummary } from "../../frontend/packages/detail/PackageSummary.js";

test("package summary uses shared Vietnamese currency and datetime formatters", () => {
  const html = renderPackageSummary({
    pkg: { giaGoiThau: 25000000, thoiGianDongThau: "close", thoiGianMoThau: "open" },
    planName: "Kế hoạch A", investorName: "Chủ đầu tư A",
    formatCurrency: () => "25.000.000 đ",
    formatDateTime: (value) => value === "close" ? "08:30 ngày 13/7/2026" : "09:00 ngày 13/7/2026"
  });
  assert.match(html, /25\.000\.000 đ/);
  assert.match(html, /08:30 ngày 13\/7\/2026/);
  assert.match(html, /09:00 ngày 13\/7\/2026/);
});
