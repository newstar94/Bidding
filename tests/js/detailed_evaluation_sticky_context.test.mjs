import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildDetailedEvaluationContextItems,
  renderDetailedEvaluationContextStrip,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";

test("sticky evaluation context keeps package, lot, contractor, round, method, group and status", () => {
  const pkg = {
    tenGoiThau: "Mua sắm thiết bị",
    maGoiThau: "IB-2026-01",
    phanLo: "Có",
    phanLoList: [
      { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Máy chủ" },
      { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Thiết bị mạng" },
    ],
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
  };
  const items = buildDetailedEvaluationContextItems({
    pkg,
    selectedBid: { label: "Liên danh Sao Việt", maPhanLo: "L02" },
    lotScope: {
      mode: "selected",
      selectedLotIds: ["lot-2"],
      availableLotIds: ["lot-1", "lot-2"],
    },
    roundType: "technical",
    context: { technicalEvaluationMethod: "score" },
    activeGroup: "technical",
    status: "Bản nháp",
  });

  assert.deepEqual(Object.fromEntries(items.map(({ key, value }) => [key, value])), {
    package: "IB-2026-01 — Mua sắm thiết bị",
    lot: "L02 — Thiết bị mạng",
    contractor: "Liên danh Sao Việt",
    round: "Vòng kỹ thuật",
    group: "Kỹ thuật",
    method: "Kỹ thuật: Chấm điểm",
    status: "Bản nháp",
  });
});

test("sticky evaluation context has safe fallbacks and escaped accessible markup", () => {
  const items = buildDetailedEvaluationContextItems({
    pkg: { tenGoiThau: "Gói <thử>", phanLo: "Không" },
    selectedBid: null,
    roundType: "single",
    activeGroup: "validity",
    status: "Chưa đánh giá",
  });
  const markup = renderDetailedEvaluationContextStrip(items);

  assert.match(markup, /aria-label="Ngữ cảnh đánh giá đang hiển thị"/);
  assert.match(markup, /Gói &lt;thử&gt;/);
  assert.match(markup, /Không phân lô/);
  assert.match(markup, /Chưa chọn hồ sơ dự thầu/);
  assert.doesNotMatch(markup, /Gói <thử>/);
});

test("sticky evaluation context CSS remains sticky and horizontally scrollable on mobile", async () => {
  const css = await readFile(new URL("../../views/css/views.css", import.meta.url), "utf8");

  assert.match(css, /\.detailed-evaluation-sticky-context\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /@media \(max-width:\s*768px\)[\s\S]*?\.detailed-evaluation-context-list\s*\{[^}]*overflow-x:\s*auto;/s);
});
