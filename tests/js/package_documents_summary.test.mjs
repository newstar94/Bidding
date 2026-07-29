import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPackageDocumentsMarkup,
  packageDocumentSlotKey,
  renderPackageDocumentsSummary,
} from "../../frontend/packages/detail/PackageDocumentsPanel.js";

test("documents tab renders the shared package summary before the document list", () => {
  const pkg = {
    id: "package-1",
    keHoachId: "plan-1",
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    giaGoiThau: 1_000_000,
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    phuongPhapDanhGia: "Giá thấp nhất",
    thoiGianDongThau: "2026-07-05T08:00:00",
    thoiGianMoThau: "2026-07-05T08:05:00",
  };
  const view = {
    model: {
      state: {
        chudautu: [{ id: "investor-1", tenChuDauTu: "Chủ đầu tư A" }],
      },
      getLatestPlan: () => ({
        id: "plan-1",
        chuDauTuId: "investor-1",
        tenKeHoach: "Kế hoạch A",
      }),
      formatCurrency: () => "1.000.000 ₫",
      formatDateWithTime: (value) => value.includes("08:05")
        ? "08:05 ngày 05/07/2026"
        : "08:00 ngày 05/07/2026",
    },
  };

  const summary = renderPackageDocumentsSummary(view, pkg);
  const markup = buildPackageDocumentsMarkup({ slots: [] }, { summaryMarkup: summary });

  assert.match(markup, /Thông số Gói thầu/);
  assert.match(markup, /Chủ đầu tư A/);
  assert.match(markup, /Kế hoạch A/);
  assert.match(markup, /Một giai đoạn một túi hồ sơ/);
  assert.match(markup, /Giá thấp nhất/);
  assert.match(markup, /1\.000\.000 ₫/);
  assert.match(markup, /08:00 ngày 05\/07\/2026/);
  assert.match(markup, /08:05 ngày 05\/07\/2026/);
  assert.match(markup, /class="bf-s-8bd3eb473c"/);
  assert.match(markup, /class="bf-s-5d398becec"/);
  assert.match(markup, /class="bf-s-13b5590e90"/);
  assert.match(markup, /strong class="bf-s-fcb5ddef65"/);
  assert.ok(markup.indexOf("bf-s-8bd3eb473c") < markup.indexOf("package-documents-empty-state"));
});

test("documents tab groups repeated report types by evaluation round and lot scope", () => {
  const report = (batchId, filename, canUpload) => ({
    type: "BID_EVALUATION_REPORT",
    label: "Báo cáo đánh giá E-HSDT",
    icon: "file-check-2",
    evaluationBatchId: batchId,
    canUpload,
    canDelete: canUpload,
    document: {
      originalFilename: filename,
      sizeBytes: 1024,
      uploadedByName: "Chuyên viên A",
      uploadedAt: "2026-07-29T08:00:00Z",
    },
  });
  const first = report("batch-1", "BCĐG lần 1.pdf", false);
  const second = report("batch-2", "BCĐG lần 2.pdf", true);
  const markup = buildPackageDocumentsMarkup({
    sections: [
      {
        scopeKey: "batch:batch-1",
        title: "Đợt đánh giá 1",
        sequenceNo: 1,
        status: "CLOSED",
        lotCodes: ["Lô 01", "Lô 02"],
        slots: [first],
      },
      {
        scopeKey: "batch:batch-2",
        title: "Đợt đánh giá 2",
        sequenceNo: 2,
        status: "ACTIVE",
        lotCodes: ["Lô 03"],
        slots: [second],
      },
    ],
  });

  assert.match(markup, /Đợt đánh giá 1/);
  assert.match(markup, /Đợt đánh giá 2/);
  assert.match(markup, /Lô 01, Lô 02/);
  assert.match(markup, /Lô 03/);
  assert.match(markup, /BCĐG lần 1\.pdf/);
  assert.match(markup, /BCĐG lần 2\.pdf/);
  assert.equal(packageDocumentSlotKey(first), "batch-1::BID_EVALUATION_REPORT");
  assert.equal(packageDocumentSlotKey(second), "batch-2::BID_EVALUATION_REPORT");
  assert.doesNotMatch(
    markup.match(/data-document-section="batch:batch-1"[\s\S]*?data-document-section="batch:batch-2"/)?.[0] || "",
    /data-document-upload="batch-1::BID_EVALUATION_REPORT"/,
  );
  assert.match(markup, /data-document-upload="batch-2::BID_EVALUATION_REPORT"/);
});
