import assert from "node:assert/strict";
import test from "node:test";

import { analyzeDetailedEvaluationWorkbook } from "../../frontend/packages/DetailedEvaluationImport.js";

function state(overrides = {}) {
  const criterion = {
    id: "criterion-1",
    code: "BID_SECURITY",
    name: "Bảo đảm dự thầu",
    group: "validity",
    resultType: "pass_fail",
    required: true,
    stt: "1",
    order: 0,
    source: "custom",
    isCustom: true,
  };
  return {
    pkg: { id: "pkg-1", linhVuc: "Hàng hóa" },
    bid: { id: "bid-1", loaiNhaThau: "Độc lập" },
    report: {
      id: "report-1",
      extension: { excelBidType: "legacy", keep: true },
      chiTietList: [{
        id: "row-1",
        tieuChiDanhGiaId: criterion.id,
        ketQua: "pending",
        lyDoKhongDat: "Dữ liệu cũ cần giữ khi Excel để trống",
      }],
    },
    roundType: "single",
    context: { editableGroups: ["validity"] },
    criteria: [criterion],
    baseCriteria: [criterion],
    ...overrides,
  };
}

test("generic workbook analysis maps the active group without mutating source state", () => {
  const source = state();
  const original = structuredClone(source.report);
  const analysis = analyzeDetailedEvaluationWorkbook({
    state: source,
    activeGroup: "validity",
    sheets: [{
      name: "Sheet1",
      rows: [
        ["Mã tiêu chí", "Kết quả", "Nhận xét"],
        ["BID_SECURITY", "Đạt", "Hợp lệ"],
      ],
    }],
  });

  assert.equal(analysis.isMuasamcong, false);
  assert.equal(analysis.stats.matched, 1);
  assert.equal(analysis.report.chiTietList[0].ketQua, "pass");
  assert.equal(analysis.report.chiTietList[0].nhanXet, "Hợp lệ");
  assert.equal(
    analysis.report.chiTietList[0].lyDoKhongDat,
    "Dữ liệu cũ cần giữ khi Excel để trống",
  );
  assert.equal(analysis.report.extension.keep, true);
  assert.equal(Object.hasOwn(analysis.report.extension, "excelBidType"), false);
  assert.deepEqual(source.report, original);
});

test("muasamcong analysis replaces the imported group and preserves hierarchical STT", () => {
  const analysis = analyzeDetailedEvaluationWorkbook({
    state: state(),
    activeGroup: "validity",
    sheets: [{
      name: "Mẫu số 01",
      rows: [
        ["ĐÁNH GIÁ TÍNH HỢP LỆ CỦA E-HSDT"],
        ["STT", "Nội dung", "Kết quả tự động", "", "Kết quả chuyên gia"],
        ["", "", "Đạt", "Không đạt", "Đạt", "Không đạt"],
        [1, "Bảo đảm dự thầu (1)", "x", "-", "", ""],
        [2, "Tư cách hợp lệ của nhà thầu", "x", "-", "", ""],
        ["2.1", "Hạch toán tài chính độc lập", "x", "-", "", ""],
      ],
    }],
  });

  assert.equal(analysis.isMuasamcong, true);
  assert.equal(analysis.muasamcongImports[0].sheetName, "Mẫu số 01");
  assert.deepEqual(
    analysis.criteriaOverride.map((criterion) => criterion.stt),
    ["1", "2", "2.1"],
  );
  assert.equal(analysis.report.chiTietList.length, 3);
  assert.equal(analysis.report.chiTietList[0].extension.ketQuaTuDong, "pass");
});

test("workbook without matching criteria returns a non-mutating empty plan", () => {
  const source = state();
  const analysis = analyzeDetailedEvaluationWorkbook({
    state: source,
    activeGroup: "validity",
    sheets: [{
      name: "Sheet1",
      rows: [["Mã tiêu chí", "Kết quả"], ["UNKNOWN", "Đạt"]],
    }],
  });

  assert.equal(analysis.report, null);
  assert.equal(analysis.criteriaOverride, null);
  assert.equal(analysis.imported.matches.length, 0);
  assert.equal(source.report.chiTietList[0].ketQua, "pending");
});
