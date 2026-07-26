import assert from "node:assert/strict";
import test from "node:test";

import { buildBidEvaluationTablePresentation } from "../../frontend/packages/BidEvaluationTablePresentation.js";

const LOTS = [
  { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Phần lô 1" },
  { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Phần lô 2" },
];

test("two-envelope technical lot table exposes qualification columns and scope title", () => {
  const result = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Hàng hóa",
      phanLo: "Có",
      phanLoList: LOTS,
      phuongPhapDanhGia: "Giá thấp nhất",
    },
    isTwoEnvelope: true,
    currentTab: "technical",
    lotScope: { mode: "selected", selectedLotIds: ["lot-1"] },
  });

  assert.equal(result.caseType, "1G2T_WITH_LOT");
  assert.equal(result.showCombinedScore, false);
  assert.match(result.title, /E-HSĐXKT/);
  assert.match(result.title, /PL1/);
  assert.match(result.headerHtml, /Mã phần lô/);
  assert.match(result.headerHtml, /Đảm bảo dự thầu/);
  assert.doesNotMatch(result.headerHtml, /Giá dự thầu/);
});

test("two-envelope consulting financial table includes validity and combined-score context", () => {
  const result = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Tư vấn",
      phanLo: "Không",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    },
    isTwoEnvelope: true,
    currentTab: "financial",
  });

  assert.equal(result.caseType, "1G2T_TC_NO_LOT");
  assert.equal(result.isConsulting, true);
  assert.equal(result.showCombinedScore, true);
  assert.match(result.title, /E-HSĐXTC/);
  assert.match(result.headerHtml, /Hiệu lực E-HSĐXTC/);
  assert.ok(result.headerHtml.indexOf("Đánh giá KT") < result.headerHtml.indexOf("Điểm tổng hợp"));
  assert.ok(result.headerHtml.indexOf("Điểm tổng hợp") < result.headerHtml.indexOf("Xếp hạng"));
});

test("single-envelope consulting preserves its dedicated table and combined score", () => {
  const result = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Tư vấn",
      phanLo: "Không",
      phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    },
    currentTab: "unified",
  });

  assert.equal(result.caseType, "TU_VAN");
  assert.equal(result.showCombinedScore, true);
  assert.match(result.headerHtml, /Hiệu lực E-HSĐXKT/);
  assert.match(result.headerHtml, /Làm rõ năng lực kinh nghiệm/);
  assert.match(result.headerHtml, /Điểm tổng hợp/);
});

test("single-envelope goods tables distinguish lot columns without inventing scores", () => {
  const whole = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Không", phuongPhapDanhGia: "Giá thấp nhất" },
  });
  const lotted = buildBidEvaluationTablePresentation({
    pkg: {
      linhVuc: "Hàng hóa",
      phanLo: "Có",
      phanLoList: LOTS,
      phuongPhapDanhGia: "Giá thấp nhất",
    },
  });

  assert.equal(whole.caseType, "1G1T_NO_LOT");
  assert.equal(lotted.caseType, "1G1T_WITH_LOT");
  assert.doesNotMatch(whole.headerHtml, /Mã phần lô/);
  assert.match(lotted.headerHtml, /Mã phần lô/);
  assert.doesNotMatch(whole.headerHtml, /Điểm tổng hợp/);
  assert.doesNotMatch(lotted.headerHtml, /Điểm tổng hợp/);
});

test("every two-envelope goods case resolves a non-empty stage-specific header", () => {
  const technicalWhole = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Không" },
    isTwoEnvelope: true,
    currentTab: "technical",
  });
  const financialLots = buildBidEvaluationTablePresentation({
    pkg: { linhVuc: "Hàng hóa", phanLo: "Có", phanLoList: LOTS },
    isTwoEnvelope: true,
    currentTab: "financial",
  });

  assert.equal(technicalWhole.caseType, "1G2T_NO_LOT");
  assert.match(technicalWhole.headerHtml, /Hiệu lực E-HSĐXKT/);
  assert.equal(financialLots.caseType, "1G2T_TC_WITH_LOT");
  assert.match(financialLots.headerHtml, /Mã phần lô/);
  assert.match(financialLots.headerHtml, /Giá dự thầu/);
});
