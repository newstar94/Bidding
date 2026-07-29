import test from "node:test";
import assert from "node:assert/strict";

import {
  renderDetailedEvaluationLowPriceSummary,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";

test("detailed evaluation report shows the accepted below-half award-price decision", () => {
  const bid = {
    id: "bid-jv",
    label: "Liên danh Alpha",
    giaDeNghiTrungThau: 400_000,
    chapThuanGiaDeNghiTrungThauDuoi50: true,
  };

  const html = renderDetailedEvaluationLowPriceSummary({
    pkg: { phanLo: "Không", giaGoiThau: 1_000_000 },
    bid,
  });

  assert.match(html, /Xử lý giá đề nghị trúng thầu dưới 50%/);
  assert.match(html, />Chấp thuận</);
});
