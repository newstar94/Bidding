import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluationExcelColumnLabel,
  readEvaluationExcelValue,
} from "../../frontend/documents/bidEvaluationExcelColumns.js";
import { parseBidEvaluationImport } from "../../frontend/documents/excelImportAdapters.js";


function evaluationController(pkg, bids = null) {
  return {
    currentDanhGiaTab: "technical",
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: bids || [{
          id: "opening-1",
          goiThauId: pkg.id,
          maNhaThau: "NT-01",
          tenNhaThau: "Nhà thầu Một",
        }],
      },
      parseVND(value) {
        const parsed = Number(String(value ?? "").replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : 0;
      },
    },
    view: { customAlert: async () => {} },
  };
}


test("evaluation Excel column helper preserves present falsy canonical values", () => {
  const row = {
    [evaluationExcelColumnLabel("technicalEvaluation")]: 0,
    [evaluationExcelColumnLabel("lowPriceAcceptance")]: false,
  };

  assert.equal(readEvaluationExcelValue(row, "technicalEvaluation"), 0);
  assert.equal(readEvaluationExcelValue(row, "lowPriceAcceptance"), false);
  assert.equal(readEvaluationExcelValue({ "Lý do không đạt kỹ thuật": "Legacy" }, "technicalFailureReason"), "Legacy");
});


test("canonical export headers round-trip through evaluation import without losing clarifications", async () => {
  const pkg = {
    id: "pkg-score",
    linhVuc: "Tư vấn",
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    phanLo: "Không",
  };
  const row = {
    [evaluationExcelColumnLabel("contractorCode")]: "NT-01",
    [evaluationExcelColumnLabel("contractorName")]: "Nhà thầu Một",
    [evaluationExcelColumnLabel("validityResult")]: "Đạt",
    [evaluationExcelColumnLabel("validityClarification")]: "Làm rõ hợp lệ",
    [evaluationExcelColumnLabel("validityFailureReason")]: "Không áp dụng",
    [evaluationExcelColumnLabel("capacityResult")]: "Đạt",
    [evaluationExcelColumnLabel("capacityClarification")]: "Làm rõ năng lực",
    [evaluationExcelColumnLabel("capacityFailureReason")]: "Không áp dụng",
    [evaluationExcelColumnLabel("technicalEvaluation")]: 0,
    [evaluationExcelColumnLabel("technicalClarification")]: "Điểm bằng không hợp lệ",
    [evaluationExcelColumnLabel("technicalFailureReason")]: "Không đạt tiêu chí A",
    [evaluationExcelColumnLabel("financialClarification")]: "Làm rõ tài chính",
  };

  const [record] = await parseBidEvaluationImport(
    evaluationController(pkg), [row], { packageId: pkg.id, evaluationTab: "technical" },
  );

  assert.equal(record._valid, true);
  assert.equal(record.danhGiaKyThuat, "0");
  assert.equal(record.lamRoHopLe, "Làm rõ hợp lệ");
  assert.equal(record.nguyenNhanKhongDatHopLe, "Không áp dụng");
  assert.equal(record.lamRoNangLuc, "Làm rõ năng lực");
  assert.equal(record.nguyenNhanKhongDatNangLuc, "Không áp dụng");
  assert.equal(record.lamRoKyThuat, "Điểm bằng không hợp lệ");
  assert.equal(record.nguyenNhanKhongDatKyThuat, "Không đạt tiêu chí A");
  assert.equal(record.lamRoTaiChinh, "Làm rõ tài chính");
});


test("legacy evaluation headers remain import-compatible", async () => {
  const pkg = { id: "pkg-legacy", phanLo: "Không" };
  const [record] = await parseBidEvaluationImport(evaluationController(pkg), [{
    "Mã định danh": "NT-01",
    "Tên nhà thầu": "Nhà thầu Một",
    "Đánh giá hợp lệ": "Đạt",
    "Làm rõ hợp lệ": "Legacy validity clarification",
    "Lý do không đạt hợp lệ": "Legacy validity failure",
    "Đánh giá năng lực": "Đạt",
    "Làm rõ năng lực": "Legacy capacity clarification",
    "Lý do không đạt năng lực": "Legacy capacity failure",
    "Kỹ thuật": "Đạt",
    "Làm rõ kỹ thuật": "Legacy technical clarification",
    "Lý do không đạt kỹ thuật": "Legacy technical failure",
  }], { packageId: pkg.id });

  assert.equal(record._valid, true);
  assert.equal(record.lamRoHopLe, "Legacy validity clarification");
  assert.equal(record.nguyenNhanKhongDatHopLe, "Legacy validity failure");
  assert.equal(record.lamRoNangLuc, "Legacy capacity clarification");
  assert.equal(record.nguyenNhanKhongDatNangLuc, "Legacy capacity failure");
  assert.equal(record.lamRoKyThuat, "Legacy technical clarification");
  assert.equal(record.nguyenNhanKhongDatKyThuat, "Legacy technical failure");
});


test("financial workbook import preserves zero values and a rejected low-price decision", async () => {
  const pkg = { id: "pkg-financial", phanLo: "Không" };
  const row = {
    [evaluationExcelColumnLabel("contractorCode")]: "NT-01",
    [evaluationExcelColumnLabel("contractorName")]: "Nhà thầu Một",
    [evaluationExcelColumnLabel("bidPrice")]: 0,
    [evaluationExcelColumnLabel("discountPercent")]: 0,
    [evaluationExcelColumnLabel("rankingPrice")]: 0,
    [evaluationExcelColumnLabel("proposedAwardPrice")]: 0,
    [evaluationExcelColumnLabel("lowPriceAcceptance")]: "Không chấp thuận",
    [evaluationExcelColumnLabel("validityClarification")]: "Cần xác minh",
    [evaluationExcelColumnLabel("technicalClarification")]: "Không áp dụng",
    [evaluationExcelColumnLabel("financialClarification")]: "Giá bằng không",
    [evaluationExcelColumnLabel("technicalEvaluation")]: "Đạt",
  };

  const [record] = await parseBidEvaluationImport(
    evaluationController(pkg), [row], { packageId: pkg.id, evaluationTab: "financial" },
  );

  assert.equal(record._valid, true);
  assert.equal(record.giaDuThau, 0);
  assert.equal(record.tyLeGiamGia, 0);
  assert.equal(record.giaXepHang, 0);
  assert.equal(record.giaDeNghiTrungThau, 0);
  assert.equal(record.chapThuanGiaDeNghiTrungThauDuoi50, false);
  assert.equal(record.lamRoTaiChinh, "Giá bằng không");
});


test("score packages reject pass/fail text while lotted rows resolve their own bid", async () => {
  const scorePkg = {
    id: "pkg-score-invalid", linhVuc: "Tư vấn", phanLo: "Không",
  };
  const [invalid] = await parseBidEvaluationImport(evaluationController(scorePkg), [{
    [evaluationExcelColumnLabel("contractorCode")]: "NT-01",
    [evaluationExcelColumnLabel("contractorName")]: "Nhà thầu Một",
    [evaluationExcelColumnLabel("technicalEvaluation")]: "Đạt",
  }], { packageId: scorePkg.id, evaluationTab: "technical" });
  assert.equal(invalid._valid, false);
  assert.match(invalid._comment, /Không được nhập Đạt\/Không đạt/u);

  const lottedPkg = { id: "pkg-lotted", phanLo: "Có" };
  const [lotted] = await parseBidEvaluationImport(evaluationController(lottedPkg, [
    {
      id: "opening-lot-1", goiThauId: lottedPkg.id, maNhaThau: "NT-01",
      tenNhaThau: "Nhà thầu Một", maPhanLo: "PL1", tenPhanLo: "Lô 1",
    },
    {
      id: "opening-lot-2", goiThauId: lottedPkg.id, maNhaThau: "NT-01",
      tenNhaThau: "Nhà thầu Một", maPhanLo: "PL2", tenPhanLo: "Lô 2",
    },
  ]), [{
    [evaluationExcelColumnLabel("contractorCode")]: "NT-01",
    [evaluationExcelColumnLabel("contractorName")]: "Nhà thầu Một",
    [evaluationExcelColumnLabel("lotCode")]: "PL2",
    [evaluationExcelColumnLabel("technicalEvaluation")]: "Đạt",
  }], { packageId: lottedPkg.id, evaluationTab: "technical" });

  assert.equal(lotted._valid, true);
  assert.equal(lotted.id, "opening-lot-2");
  assert.equal(lotted.maPhanLo, "PL2");
  assert.equal(lotted.tenPhanLo, "Lô 2");
});
