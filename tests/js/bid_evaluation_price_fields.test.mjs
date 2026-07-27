import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { parseBidEvaluationImport } from "../../frontend/documents/excelImportAdapters.js";
import { buildBidEvaluationTablePresentation } from "../../frontend/packages/BidEvaluationTablePresentation.js";
import { resolveBidEvaluationRowReadOnly } from "../../frontend/packages/BidEvaluationRowRenderer.js";
import { applyAwardResultToPackage } from "../../frontend/packages/bidProcessAwardResult.js";
import {
  getLowPriceRejectionReason,
  isProposedAwardPriceBelowHalf,
} from "../../frontend/packages/bidEvaluationLowPriceRules.js";
import { checkBidQualified } from "../../frontend/packages/detail/PackageTabs.js";
import { calculateRankings } from "../../frontend/shared/BiddingCalculations.js";

test("shows both price columns in 1G1T and financial 1G2T reports only", () => {
  const single = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Không", phuongPhapDanhGia: "Giá thấp nhất" },
  });
  const financial = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Không", phuongPhapDanhGia: "Giá thấp nhất" },
    isTwoEnvelope: true,
    currentTab: "financial",
  });
  const technical = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Không", phuongPhapDanhGia: "Giá thấp nhất" },
    isTwoEnvelope: true,
    currentTab: "technical",
  });
  for (const report of [single, financial]) {
    assert.match(report.headerHtml, /Giá xếp hạng/);
    assert.match(report.headerHtml, /Giá đề nghị trúng thầu/);
    const discountedIndex = report.headerHtml.indexOf("Giá sau giảm");
    const rankingIndex = report.headerHtml.indexOf("Giá xếp hạng");
    const proposedIndex = report.headerHtml.indexOf("Giá đề nghị trúng thầu");
    assert.ok(discountedIndex < rankingIndex);
    assert.ok(rankingIndex < proposedIndex);
    assert.equal(
      report.headerHtml.slice(discountedIndex, proposedIndex).match(/<th/g)?.length,
      2,
      "the two award-price columns must immediately follow the discounted price",
    );
  }
  assert.doesNotMatch(technical.headerHtml, /Giá xếp hạng|Giá đề nghị trúng thầu/);
});

test("uses an entered ranking price when ordering qualified bids", () => {
  const pkg = { linhVuc: "Hàng hóa", phanLo: "Không", phuongPhapDanhGia: "Giá thấp nhất" };
  const bids = [
    { id: "a", danhGiaKetLuan: "Đạt", giaSauGiamGia: 90, giaXepHang: 120 },
    { id: "b", danhGiaKetLuan: "Đạt", giaSauGiamGia: 100, giaXepHang: 110 },
  ];
  assert.deepEqual(calculateRankings(pkg, bids).rankings, { b: 1, a: 2 });
});

test("imports both price columns from a unified 1G1T evaluation workbook", async () => {
  const controller = {
    currentDanhGiaTab: "unified",
    model: {
      parseVND(value) {
        const normalized = String(value ?? "").replace(/[^0-9-]/g, "");
        return normalized ? Number(normalized) : 0;
      },
      state: {
        goithau: [{ id: "gt-1", phanLo: "Không" }],
        thongtinmothau: [{ id: "bid-1", goiThauId: "gt-1", maNhaThau: "NT-01", tenNhaThau: "Nhà thầu 01" }],
      },
    },
  };
  const [row] = await parseBidEvaluationImport(controller, [{
    "Mã nhà thầu": "NT-01",
    "Tên nhà thầu": "Nhà thầu 01",
    "Giá xếp hạng (VND)": 950,
    "Giá đề nghị trúng thầu (VND)": 940,
    "Xử lý giá đề nghị trúng thầu dưới 50%": "Không chấp thuận",
  }], { packageId: "gt-1", evaluationTab: "unified" });
  assert.equal(row.giaXepHang, 950);
  assert.equal(row.giaDeNghiTrungThau, 940);
  assert.equal(row.chapThuanGiaDeNghiTrungThauDuoi50, false);
});

test("renders editable controls for both persisted prices", () => {
  const source = fs.readFileSync("frontend/packages/BidEvaluationRowRenderer.js", "utf8");
  assert.match(source, /class="form-control mt-gia-xep-hang"/);
  assert.match(source, /class="form-control mt-gia-de-nghi-trung-thau/);
  assert.match(source, /class="mt-low-price-acceptance"/);
});

test("a detailed evaluation report does not lock the outer summary row", () => {
  assert.equal(resolveBidEvaluationRowReadOnly({
    isReadOnly: false,
    detailedProjectionReport: { id: "report-1" },
  }), false);
  assert.equal(resolveBidEvaluationRowReadOnly({
    isReadOnly: true,
    detailedProjectionReport: { id: "report-1" },
  }), true);
});

test("does not render a detailed-report summary badge in the contractor cell", () => {
  const source = fs.readFileSync("frontend/packages/BidEvaluationRowRenderer.js", "utf8");
  assert.doesNotMatch(source, /Tổng hợp từ báo cáo chi tiết/);
});

test("warns only when the proposed award price is strictly below half of the package price", () => {
  const pkg = { phanLo: "Không", giaGoiThau: "1000" };
  const bid = { giaDeNghiTrungThau: 499 };
  assert.equal(isProposedAwardPriceBelowHalf(pkg, bid), true);
  assert.equal(isProposedAwardPriceBelowHalf(pkg, bid, 500), false);
  assert.match(getLowPriceRejectionReason(pkg, bid), /50% giá gói thầu/);
});

test("uses the matching lot price as the 50% reference", () => {
  const pkg = {
    phanLo: "Có",
    giaGoiThau: 10_000,
    phanLoList: [
      { maPhanLo: "L1", giaTriPhanLo: 300 },
      { maPhanLo: "L2", giaTriPhanLo: 800 },
    ],
  };
  const bid = { maPhanLo: "L1", giaDeNghiTrungThau: 149 };
  assert.equal(isProposedAwardPriceBelowHalf(pkg, bid), true);
  assert.equal(isProposedAwardPriceBelowHalf(pkg, bid, 151), false);
  assert.match(getLowPriceRejectionReason(pkg, bid), /50% giá phần lô/);
});

test("a rejected low-price bid is excluded from ranking and award qualification", () => {
  const pkg = {
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    giaGoiThau: 1000,
    phuongPhapDanhGia: "Giá thấp nhất",
  };
  const rejected = {
    id: "a",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 100,
    giaDeNghiTrungThau: 400,
    chapThuanGiaDeNghiTrungThauDuoi50: false,
  };
  const accepted = {
    id: "b",
    danhGiaKetLuan: "Đạt",
    giaXepHang: 200,
    giaDeNghiTrungThau: 450,
    chapThuanGiaDeNghiTrungThauDuoi50: true,
  };
  assert.deepEqual(calculateRankings(pkg, [rejected, accepted]).rankings, { b: 1 });
  assert.equal(checkBidQualified(rejected, pkg), false);
  assert.equal(checkBidQualified(accepted, pkg), true);
});

test("a rejected low-price bid is never selected by the legacy award fallback", () => {
  const pkg = { phanLo: "Không", giaGoiThau: 1000, nhaThauTrungThauId: "old", giaTrungThau: 999 };
  const bid = {
    id: "bid-1",
    nhaThauId: "contractor-1",
    giaDeNghiTrungThau: 400,
    chapThuanGiaDeNghiTrungThauDuoi50: false,
  };
  const model = {
    state: { thongtinmothau: [bid] },
    parseVND: (value) => Number(value || 0),
  };
  applyAwardResultToPackage({ gt: pkg, bids: [bid], winnerRows: [], tbodyResult: null, model });
  assert.equal(pkg.nhaThauTrungThauId, "");
  assert.equal(pkg.giaTrungThau, 0);
});
