import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { resolveDetailedEvaluationContext } from "../../frontend/packages/detailedEvaluationRules.js";
import {
  getDetailedEvaluationBidLabel,
  getDetailedEvaluationProgress,
  getDetailedReportForRound,
  getCriteriaForGroup,
  getEligibleFinancialEvaluationBids,
  getEvaluationRoundType,
  getPackageEvaluationBids,
  isDetailedEvaluationSummaryOwned,
} from "../../frontend/packages/detailedEvaluationSelectors.js";
import {
  createDefaultDetailedEvaluationCriteria,
  resolveDetailedEvaluationTemplate,
} from "../../frontend/packages/detailedEvaluationTemplates.js";
import {
  mapDetailedEvaluationExcelRows,
  parseMuasamcongDetailedEvaluationWorkbook,
  validateMuasamcongContractorIdentity,
} from "../../frontend/packages/detailedEvaluationExcel.js";
import { adaptDetailedEvaluationCriteriaForBid } from "../../frontend/packages/detailedEvaluationCriteria.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "../../frontend/packages/detailedEvaluationHierarchy.js";
import {
  validateDetailedEvaluationGroup,
  validateDetailedEvaluationRow,
} from "../../frontend/packages/detailedEvaluationValidation.js";
import {
  aggregateDetailedEvaluation,
  aggregateDetailedEvaluationReport,
} from "../../frontend/packages/detailedEvaluationAggregation.js";
import {
  applyDetailedEvaluationProjection,
  addDetailedEvaluationCriterion,
  buildDetailedEvaluationDraft,
  buildReopenedDetailedEvaluationReport,
  closeDetailedEvaluation,
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
  openDetailedEvaluation,
  renderDetailedEvaluation,
  saveDetailedEvaluation,
  verifyMuasamcongDetailedEvaluationContractor,
} from "../../frontend/packages/DetailedEvaluationWorkflow.js";
import {
  renderDetailedEvaluationPanel,
  scheduleDetailedEvaluationRowBatches,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";
import { renderEvaluationPanel } from "../../frontend/packages/detail/EvaluationPanel.js";
import { buildPackageTabs } from "../../frontend/packages/detail/PackageTabs.js";


test("detailed evaluation context exposes the correct groups for every envelope round", () => {
  const oneEnvelope = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  }, "single");
  assert.deepEqual(oneEnvelope.visibleGroups, [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  assert.deepEqual(oneEnvelope.editableGroups, oneEnvelope.visibleGroups);

  const technical = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  }, "technical");
  assert.deepEqual(technical.visibleGroups, [
    "validity",
    "capacity",
    "technical",
  ]);
  assert.deepEqual(technical.editableGroups, technical.visibleGroups);

  const financial = resolveDetailedEvaluationContext({
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  }, "financial");
  assert.deepEqual(financial.visibleGroups, ["financial"]);
  assert.deepEqual(financial.editableGroups, ["financial"]);
  assert.equal(financial.contractorFilter, "technical-qualified");
});

test("large detailed evaluation tables append rows in bounded frame batches", async () => {
  const frames = [];
  const batches = [];
  const rowHtml = Array.from({ length: 120 }, (_, index) => `<tr>${index}</tr>`);
  const completed = scheduleDetailedEvaluationRowBatches({
    rowHtml,
    startIndex: 20,
    chunkSize: 50,
    appendBatch: (batch, offset) => batches.push({ offset, size: batch.length }),
    scheduleFrame: (callback) => frames.push(callback),
  });

  assert.equal(frames.length, 1);
  while (frames.length) frames.shift()();
  assert.equal(await completed, true);
  assert.deepEqual(batches, [
    { offset: 20, size: 50 },
    { offset: 70, size: 50 },
  ]);
});

test("detailed evaluation resolves the supplied 14A-14D templates", () => {
  const process1 = { linhVuc: "Hàng hóa", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", quyTrinhDanhGia: "quytrinh1" };
  const process2 = { linhVuc: "Xây lắp", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", quyTrinhDanhGia: "quytrinh2" };
  const twoEnvelope = { linhVuc: "Hỗn hợp", phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ" };
  const consulting = { linhVuc: "Tư vấn", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ" };

  assert.equal(resolveDetailedEvaluationTemplate(process1).source, "14A");
  assert.equal(resolveDetailedEvaluationTemplate(process2).source, "14B");
  assert.equal(resolveDetailedEvaluationTemplate(twoEnvelope).source, "14C");
  assert.equal(resolveDetailedEvaluationTemplate(consulting).source, "14D");
  assert.deepEqual(
    resolveDetailedEvaluationContext(process2, "single").visibleGroups,
    ["validity", "capacity", "technical"],
  );
  assert.deepEqual(
    resolveDetailedEvaluationContext(consulting, "single").visibleGroups,
    ["validity", "technical", "financial"],
  );
  assert.equal(
    createDefaultDetailedEvaluationCriteria("single", { pkg: consulting })
      .find((criterion) => criterion.group === "technical").resultType,
    "score",
  );
  assert.ok(getCriteriaForGroup(process1, "single", "validity").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "capacity").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "technical").length > 1);
  assert.ok(getCriteriaForGroup(process1, "single", "financial").length > 1);
  assert.deepEqual(
    getCriteriaForGroup(process1, "single", "validity", { fallbackToTemplate: false }),
    [],
  );
});


test("detailed evaluation selects opening bids by round, lot and qualification", () => {
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  };
  const bids = [
    {
      id: "opening-pl01",
      goiThauId: "package-1",
      nhaThauId: "contractor-1",
      maPhanLo: "PL01",
      tenPhanLo: "Lô 01",
      tenNhaThau: "Công ty ABC",
      danhGiaKetLuan: "Đạt",
    },
    {
      id: "opening-pl02",
      goiThauId: "package-1",
      nhaThauId: "contractor-1",
      maPhanLo: "PL02",
      tenPhanLo: "Lô 02",
      tenNhaThau: "Công ty ABC",
      danhGiaKetLuan: "Không đạt",
    },
    {
      id: "opening-jv",
      goiThauId: "package-1",
      nhaThauId: "joint-venture-1",
      loaiNhaThau: "Liên danh",
      tenNhaThau: "Liên danh A – B",
      danhGiaKetLuan: "Đạt",
    },
    { id: "other", goiThauId: "package-2" },
  ];
  const model = { state: { thongtinmothau: bids, nhathau: [] } };

  assert.equal(getEvaluationRoundType(pkg, "eval_tech"), "technical");
  assert.equal(getEvaluationRoundType(pkg, "eval_fin"), "financial");
  assert.deepEqual(
    getPackageEvaluationBids(model, pkg).map((bid) => bid.id),
    ["opening-pl01", "opening-pl02", "opening-jv"],
  );
  assert.deepEqual(
    getEligibleFinancialEvaluationBids(model, pkg).map((bid) => bid.id),
    ["opening-pl01", "opening-jv"],
  );
  assert.match(getDetailedEvaluationBidLabel(model, bids[0]), /^\[PL01\].*Công ty ABC.*Lô 01/);
  assert.match(getDetailedEvaluationBidLabel(model, bids[1]), /^\[PL02\].*Công ty ABC.*Lô 02/);
  assert.match(getDetailedEvaluationBidLabel(model, bids[2]), /Liên danh A – B/);
});


test("detailed evaluation criteria and reports are selected without persisting defaults", () => {
  const defaults = createDefaultDetailedEvaluationCriteria("single");
  assert.deepEqual(defaults.map((criterion) => criterion.group), [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  assert.ok(defaults.every((criterion) => criterion.required));
  assert.ok(defaults.every((criterion) => criterion.resultType === "pass_fail"));

  const pkg = {
    id: "package-1",
    danhGiaHsdtMetadata: JSON.stringify({
      criteria: [{
        id: "criterion-validity",
        code: "VALIDITY-1",
        name: "Tính hợp lệ",
        group: "validity",
        resultType: "pass_fail",
        required: true,
      }],
    }),
  };
  assert.deepEqual(
    getCriteriaForGroup(pkg, "single", "validity").map((criterion) => criterion.id),
    ["criterion-validity"],
  );

  const bid = {
    baoCaoDanhGiaChiTietList: [{
      id: "report-single",
      loaiVong: "single",
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-validity",
        ketQua: "pass",
      }],
    }],
  };
  const report = getDetailedReportForRound(bid, "single");
  assert.equal(report.id, "report-single");
  assert.deepEqual(
    getDetailedEvaluationProgress(report, [
      { id: "criterion-validity", required: true },
      { id: "criterion-capacity", required: true },
    ]),
    { completed: 1, total: 2, requiredCompleted: 1, requiredTotal: 2 },
  );
});


test("detailed evaluation Excel rows map to criteria and editable fields", () => {
  const criteria = [
    { id: "criterion-1", code: "VALIDITY_SUMMARY", name: "Bảo đảm dự thầu", resultType: "pass_fail" },
    { id: "criterion-2", code: "JV_AGREEMENT", name: "Thỏa thuận liên danh", resultType: "pass_fail" },
  ];
  const imported = mapDetailedEvaluationExcelRows([
    {
      STT: 1,
      "Tiêu chí": "Bảo đảm dự thầu (1)",
      "Nội dung trong HSDT": "Thư bảo lãnh (1) số 01 (2)",
      "Kết quả": "Đạt",
      "Nhận xét": "Hợp lệ (2)",
      "Tài liệu tham chiếu": "Trang 12 (3)",
    },
    {
      "Mã tiêu chí": "JV_AGREEMENT",
      "Kết quả": "Không đạt",
      "Lý do không đạt": "Thiếu chữ ký thành viên",
      "Yêu cầu làm rõ": "Bổ sung thỏa thuận",
    },
  ], criteria);

  assert.equal(imported.matches.length, 2);
  assert.equal(imported.matches[0].criterion.id, "criterion-1");
  assert.equal(imported.matches[0].values.ketQua, "pass");
  assert.equal(imported.matches[0].values.noiDungHsdt, "Thư bảo lãnh số 01");
  assert.equal(imported.matches[0].values.nhanXet, "Hợp lệ");
  assert.equal(imported.matches[0].values.taiLieuThamChieu, "Trang 12");
  assert.equal(imported.matches[1].criterion.id, "criterion-2");
  assert.equal(imported.matches[1].values.ketQua, "fail");
  assert.equal(Object.hasOwn(imported.matches[1].values, "lyDoKhongDat"), false);
  assert.deepEqual(imported.unmatchedRows, []);
});


test("muasamcong workbook sheets are recognized without flattening merged headers", () => {
  const validity = parseMuasamcongDetailedEvaluationWorkbook([{
    name: "Mẫu số 01",
    rows: [
      ["ĐÁNH GIÁ TÍNH HỢP LỆ CỦA E-HSDT"],
      ["Gói thầu: Gói 01"],
      ["STT", "Nội dung đánh giá trong E-HSMT", "Kết quả tự động", "", "Kết quả của chuyên gia", "", "Nhận xét"],
      ["", "", "Đạt", "Không đạt", "Đạt", "Không đạt", ""],
      [1, "Bảo đảm dự thầu (1)", "x", "-", "", "", "Hợp lệ (2)"],
      [2, "Thỏa thuận liên danh", "-", "-", "", "x", "Thiếu chữ ký"],
      ["KẾT LUẬN"],
    ],
  }], {
    group: "validity",
    roundId: "evaluation-round:package-1:single",
  });
  assert.equal(validity.sheetName, "Mẫu số 01");
  assert.equal(validity.criteria.length, 2);
  assert.equal(validity.matches[0].values.ketQua, "pending");
  assert.equal(validity.matches[0].values.ketQuaTuDong, "pass");
  assert.equal(validity.criteria[0].name, "Bảo đảm dự thầu");
  assert.equal(validity.matches[0].values.nhanXet, "Hợp lệ");
  assert.equal(validity.matches[1].values.ketQua, "fail");
  assert.equal(validity.matches[1].values.ketQuaTuDong, "pending");

  const consultingTechnical = parseMuasamcongDetailedEvaluationWorkbook([{
    name: "Mẫu số 02",
    rows: [
      ["Mẫu số 02"],
      ["ĐÁNH GIÁ VỀ KỸ THUẬT"],
      ["Sử dụng tiêu chí đánh giá chấm điểm"],
      ["Gói thầu: Tư vấn"],
      ["STT", "Nội dung đánh giá", "", "Mức điểm", "", "Kết quả đánh giá"],
      ["", "", "", "Điểm tối đa", "Điểm tối thiểu", "Điểm đánh giá", "Nhận xét của chuyên gia"],
      [1, "Kinh nghiệm và năng lực", "", 15, 10, 12, "Đáp ứng"],
    ],
  }], {
    group: "technical",
    pkg: { linhVuc: "Tư vấn" },
    roundId: "evaluation-round:package-2:technical",
  });
  assert.equal(consultingTechnical.criteria[0].resultType, "score");
  assert.equal(consultingTechnical.criteria[0].maxScore, 15);
  assert.equal(consultingTechnical.matches[0].values.diem, 12);
});


test("validity import preserves hierarchical STT and adapts it to bidder type", () => {
  const sheet = {
    name: "Mẫu số 01",
    rows: [
      ["ĐÁNH GIÁ TÍNH HỢP LỆ CỦA E-HSDT"],
      ["STT", "Nội dung", "Kết quả tự động", "", "Kết quả chuyên gia"],
      ["", "", "Đạt", "Không đạt", "Đạt", "Không đạt"],
      [1, "Bảo đảm dự thầu", "x", "-", "", ""],
      [2, "Thỏa thuận liên danh (đối với nhà thầu liên danh)", "x", "-", "", ""],
      [3, "Tư cách hợp lệ của nhà thầu", "x", "-", "", ""],
      ["3.1", "Nhà thầu là tổ chức đáp ứng đủ các điều kiện sau đây:", "-", "-", "", ""],
      ["3.1.1", "Hạch toán tài chính độc lập", "x", "-", "", ""],
      [4, "Không bị tạm ngừng tham gia Hệ thống", "x", "-", "", ""],
    ],
  };
  const parseFor = (loaiNhaThau) => parseMuasamcongDetailedEvaluationWorkbook([sheet], {
    group: "validity",
    bid: { loaiNhaThau },
    roundId: "evaluation-round:package-1:single",
  });

  const independent = parseFor("Độc lập");
  assert.deepEqual(
    independent.criteria.map((criterion) => criterion.stt),
    ["1", "2", "2.1", "2.1.1", "3"],
  );
  assert.equal(
    independent.criteria.some((criterion) => criterion.name.includes("Thỏa thuận liên danh")),
    false,
  );
  assert.equal(independent.criteria.find((criterion) => criterion.stt === "2.1").isSection, true);
  assert.equal(independent.criteria.find((criterion) => criterion.stt === "2.1").required, false);
  assert.equal(independent.sourceCriteria.some((criterion) => criterion.stt === "3.1.1"), true);
  const progress = getDetailedEvaluationProgress({
    chiTietList: independent.criteria.map((criterion) => ({
      tieuChiDanhGiaId: criterion.id,
      ketQua: criterion.isSection ? "pending" : "pass",
    })),
  }, independent.criteria);
  assert.deepEqual(progress, {
    completed: 4,
    total: 4,
    requiredCompleted: 4,
    requiredTotal: 4,
  });

  const jointVenture = parseFor("Liên danh");
  assert.deepEqual(
    jointVenture.criteria.map((criterion) => criterion.stt),
    ["1", "2", "3", "3.1", "3.1.1", "4"],
  );
  assert.equal(
    jointVenture.criteria.some((criterion) => criterion.name.includes("Thỏa thuận liên danh")),
    true,
  );
});


test("validity import follows the system bidder type when the workbook is for a joint venture", () => {
  const parsed = parseMuasamcongDetailedEvaluationWorkbook([{
    name: "Mẫu số 01",
    rows: [
      ["ĐÁNH GIÁ TÍNH HỢP LỆ CỦA E-HSDT"],
      ["Gói thầu: Gói 01 - Nhà thầu: Liên danh P&T - KN"],
      ["STT", "Nội dung", "Kết quả tự động", "", "Kết quả chuyên gia"],
      ["", "", "Đạt", "Không đạt", "Đạt", "Không đạt"],
      [1, "Bảo đảm dự thầu", "x", "-", "", ""],
      [2, "Thỏa thuận liên danh (đối với nhà thầu liên danh)", "x", "-", "", ""],
      [3, "Tư cách hợp lệ của nhà thầu", "x", "-", "", ""],
      ["3.1", "Nhà thầu là tổ chức đáp ứng đủ các điều kiện sau đây:", "-", "-", "", ""],
      ["3.1.1", "Hạch toán tài chính độc lập", "x", "-", "", ""],
      [4, "Không bị tạm ngừng tham gia Hệ thống", "x", "-", "", ""],
    ],
  }], {
    group: "validity",
    bid: { loaiNhaThau: "Độc lập" },
    roundId: "evaluation-round:package-1:single",
  });

  assert.equal(parsed.detectedBidType, "Liên danh");
  assert.deepEqual(
    parsed.criteria.map((criterion) => criterion.stt),
    ["1", "2", "2.1", "2.1.1", "3"],
  );
  assert.equal(
    parsed.criteria.some((criterion) => criterion.name.includes("Thỏa thuận liên danh")),
    false,
  );
});


test("muasamcong import verifies the workbook contractor before applying data", () => {
  const matchingSheets = [{
    name: "Mẫu số 01",
    rows: [[
      "Gói thầu: Gói 01\nNhà thầu: CÔNG TY CỔ PHẦN DƯỢC - THIẾT BỊ Y TẾ ĐÀ NẴNG",
    ]],
  }, {
    name: "Mẫu số 02A",
    rows: [[
      "Gói thầu: Gói 01 - Nhà thầu: Công ty cổ phần Dược - Thiết bị Y tế Đà Nẵng",
    ]],
  }];
  assert.deepEqual(
    validateMuasamcongContractorIdentity(
      matchingSheets,
      "Công ty Cổ phần Dược – Thiết bị Y tế Đà Nẵng",
    ),
    {
      valid: true,
      reason: "match",
      expectedName: "Công ty Cổ phần Dược – Thiết bị Y tế Đà Nẵng",
      actualNames: ["CÔNG TY CỔ PHẦN DƯỢC - THIẾT BỊ Y TẾ ĐÀ NẴNG"],
    },
  );

  const mismatch = validateMuasamcongContractorIdentity(
    matchingSheets,
    "Công ty TNHH Đầu tư Phát triển BNL",
  );
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reason, "mismatch");
  assert.equal(
    mismatch.actualNames[0],
    "CÔNG TY CỔ PHẦN DƯỢC - THIẾT BỊ Y TẾ ĐÀ NẴNG",
  );

  const conflicting = validateMuasamcongContractorIdentity([
    ...matchingSheets,
    { name: "Mẫu số 03", rows: [["Nhà thầu: Công ty khác"]] },
  ], "Công ty Cổ phần Dược - Thiết bị Y tế Đà Nẵng");
  assert.equal(conflicting.valid, false);
  assert.equal(conflicting.reason, "conflicting-workbook-names");
});


test("detailed evaluation warns and continues when the user accepts a contractor mismatch", async () => {
  const confirmations = [];
  const controller = {
    model: {
      state: {
        nhathau: [{ id: "contractor-1", tenNhaThau: "Công ty đang chọn" }],
      },
    },
    view: {
      customConfirm: async (...args) => {
        confirmations.push(args);
        return true;
      },
    },
  };
  const verified = await verifyMuasamcongDetailedEvaluationContractor(
    controller,
    { bid: { nhaThauId: "contractor-1", loaiNhaThau: "Độc lập" } },
    [{ name: "Mẫu số 01", rows: [["Nhà thầu: Công ty trong file khác"]] }],
  );

  assert.equal(verified, true);
  assert.equal(confirmations.length, 1);
  assert.equal(confirmations[0][0], "Sai nhà thầu trong file Excel");
  assert.match(confirmations[0][1], /Công ty trong file khác/);
  assert.match(confirmations[0][1], /Công ty đang chọn/);
  assert.equal(confirmations[0][2], "alert-triangle");
  assert.deepEqual(confirmations[0][3], {
    confirmLabel: "Vẫn nhập",
    cancelLabel: "Hủy",
  });
});


test("detailed evaluation cancels a mismatched import when the user declines", async () => {
  const controller = {
    model: {
      state: {
        nhathau: [{ id: "contractor-1", tenNhaThau: "Công ty đang chọn" }],
      },
    },
    view: {
      customConfirm: async () => false,
    },
  };

  const verified = await verifyMuasamcongDetailedEvaluationContractor(
    controller,
    { bid: { nhaThauId: "contractor-1", loaiNhaThau: "Độc lập" } },
    [{ name: "Mẫu số 01", rows: [["Nhà thầu: Công ty trong file khác"]] }],
  );

  assert.equal(verified, false);
});


test("removing the joint-venture row does not renumber capacity criteria", () => {
  const adjusted = adaptDetailedEvaluationCriteriaForBid([
    { id: "v1", group: "validity", code: "VALIDITY_SUMMARY", name: "Bảo đảm dự thầu", stt: "1" },
    { id: "v2", group: "validity", code: "JV_AGREEMENT", name: "Thỏa thuận liên danh", stt: "2" },
    { id: "v3", group: "validity", code: "LEGAL_STATUS", name: "Tư cách hợp lệ", stt: "3" },
    { id: "c1", group: "capacity", name: "Lịch sử hợp đồng", stt: "1" },
    { id: "c2", group: "capacity", name: "Nghĩa vụ thuế", stt: "2" },
    { id: "c3", group: "capacity", name: "Năng lực tài chính", stt: "3" },
    { id: "c31", group: "capacity", name: "Doanh thu", stt: "3.1" },
  ], { loaiNhaThau: "Độc lập" });

  assert.deepEqual(
    adjusted.filter((criterion) => criterion.group === "capacity").map((criterion) => criterion.stt),
    ["1", "2", "3", "3.1"],
  );
});


test("muasamcong financial sheet follows the package evaluation method", () => {
  const financialSheet = (name, methodTitle, value) => ({
    name,
    rows: [
      [name],
      [`TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ VỀ TÀI CHÍNH (${methodTitle})`],
      ["Gói thầu: Gói 01"],
      ["STT", "Nội dung", "", "Giá trị"],
      [1, "Giá dự thầu", "", value],
    ],
  });
  const sheets = [
    financialSheet("Mẫu số 06A", "Phương pháp giá đánh giá", "100 VND"),
    financialSheet("Mẫu số 06B", "Phương pháp kết hợp giữa kỹ thuật và giá", "200 VND"),
    financialSheet("Mẫu số 06C", "Phương pháp giá thấp nhất", "300 VND"),
  ];
  const selected = (phuongPhapDanhGia) => parseMuasamcongDetailedEvaluationWorkbook(sheets, {
    group: "financial",
    pkg: { phuongPhapDanhGia },
    roundId: "evaluation-round:package-1:financial",
  });

  assert.equal(selected("Giá đánh giá").sheetName, "Mẫu số 06A");
  assert.equal(selected("Kết hợp giữa kỹ thuật và giá").sheetName, "Mẫu số 06B");
  assert.equal(selected("Giá thấp nhất").sheetName, "Mẫu số 06C");
});


test("financial template number follows package field, envelope and evaluation method", () => {
  const financialSheet = (name) => ({
    name,
    rows: [
      [name],
      ["TỔNG HỢP KẾT QUẢ ĐÁNH GIÁ VỀ TÀI CHÍNH"],
      ["Gói thầu: Gói 01"],
      ["STT", "Nội dung", "", "Giá trị"],
      [1, "Giá dự thầu", "", `${name} value`],
    ],
  });
  const sheets = ["02", "02B", "06A", "06B", "06C", "07A", "07B"]
    .map((code) => financialSheet(`Mẫu số ${code}`));
  const selected = (pkg) => parseMuasamcongDetailedEvaluationWorkbook(sheets, {
    group: "financial",
    pkg,
    roundId: "evaluation-round:package-1:financial",
  }).sheetName;

  const oneEnvelope = "Một giai đoạn một túi hồ sơ";
  const twoEnvelope = "Một giai đoạn hai túi hồ sơ";
  assert.equal(selected({
    linhVuc: "Hàng hóa",
    phuongThucLuaChon: oneEnvelope,
    phuongPhapDanhGia: "Giá đánh giá",
  }), "Mẫu số 07A");
  assert.equal(selected({
    linhVuc: "Xây lắp",
    phuongThucLuaChon: oneEnvelope,
    phuongPhapDanhGia: "Giá thấp nhất",
  }), "Mẫu số 07B");
  assert.equal(selected({
    linhVuc: "Hàng hóa",
    phuongThucLuaChon: twoEnvelope,
    phuongPhapDanhGia: "Giá đánh giá",
  }), "Mẫu số 06A");
  assert.equal(selected({
    linhVuc: "Hỗn hợp",
    phuongThucLuaChon: twoEnvelope,
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
  }), "Mẫu số 06B");
  assert.equal(selected({
    linhVuc: "Phi tư vấn",
    phuongThucLuaChon: twoEnvelope,
    phuongPhapDanhGia: "Giá thấp nhất",
  }), "Mẫu số 06C");
  assert.equal(selected({
    linhVuc: "Tư vấn",
    phuongThucLuaChon: twoEnvelope,
    phuongPhapDanhGia: "Dựa trên kỹ thuật",
  }), "Mẫu số 02");
  assert.equal(selected({
    linhVuc: "Tư vấn",
    phuongThucLuaChon: twoEnvelope,
    phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
  }), "Mẫu số 02B");
});


test("muasamcong lot sheets enrich capacity criteria for the selected lot only", () => {
  const parsed = parseMuasamcongDetailedEvaluationWorkbook([
    {
      name: "Mẫu số 02A",
      rows: [
        ["ĐÁNH GIÁ VỀ NĂNG LỰC VÀ KINH NGHIỆM"],
        ["Gói thầu: Gói phân lô"],
        ["Tiêu chí", "", "", "Thông tin HSDT", "", "", "", "", "", "", "", "", "", "", "", "Kết quả tự động", "", "Kết quả chuyên gia"],
        ["STT", "Mô tả", "Yêu cầu", "", "", "", "", "", "", "", "", "", "", "", "", "Đạt", "Không đạt", "Đạt", "Không đạt", "Nhận xét"],
        [1, "Doanh thu bình quân hằng năm", "Yêu cầu chung", "Thông tin doanh thu", "", "", "", "", "", "", "", "", "", "", "", "x", "-", "", "", ""],
        [2, "Hợp đồng tương tự", "Yêu cầu chung", "Hợp đồng số 01", "", "", "", "", "", "", "", "", "", "", "", "-", "-", "", "", ""],
      ],
    },
    {
      name: "Bảng X",
      rows: [
        ["STT", "Mã phần (lô)", "Tên phần", "Giá", "Doanh thu", "Mã HS", "Lĩnh vực", "Hợp đồng tương tự", "Năng lực sản xuất", "Bảo hành"],
        [1, "LOT-01", "Lô 01", 100, 500, "", "", 250, "100 sản phẩm", "24 tháng"],
      ],
    },
    {
      name: "Mẫu số 02A_Phụ lục",
      rows: [
        ["Mã phần lô", "Đánh giá năng lực"],
        ["", "Hợp đồng tương tự", "Năng lực sản xuất", "Bảo hành", "Ý kiến"],
        ["LOT-01", "Đạt", "", "", "Đáp ứng theo lô"],
      ],
    },
  ], {
    group: "capacity",
    bid: { maPhanLo: "LOT-01" },
    roundId: "evaluation-round:package-1:single",
  });

  assert.equal(parsed.criteria[0].requirement, "500");
  assert.equal(parsed.criteria[1].requirement, "250");
  assert.equal(parsed.matches[1].values.ketQua, "pass");
  assert.equal(parsed.matches[1].values.nhanXet, "Đáp ứng theo lô");
});


test("detailed evaluation validation enforces required results and score bounds", () => {
  const requiredPassFail = {
    id: "criterion-validity",
    resultType: "pass_fail",
    required: true,
  };
  assert.deepEqual(validateDetailedEvaluationRow({
    tieuChiDanhGiaId: "criterion-validity",
    ketQua: "fail",
    lyDoKhongDat: "",
  }, requiredPassFail).errors, []);

  const scoreCriterion = {
    id: "criterion-score",
    resultType: "score",
    required: true,
    maxScore: 100,
  };
  assert.equal(validateDetailedEvaluationRow({
    tieuChiDanhGiaId: "criterion-score",
    ketQua: "pass",
    diem: 101,
  }, scoreCriterion).errors[0].field, "diem");

  const group = validateDetailedEvaluationGroup([
    { tieuChiDanhGiaId: "criterion-validity", ketQua: "pending" },
  ], [requiredPassFail], { completing: true });
  assert.equal(group.valid, false);
  assert.equal(group.errors[0].field, "ketQua");
});


test("detailed evaluation aggregation projects group and overall conclusions", () => {
  const criteria = [
    { id: "required-1", group: "technical", required: true },
    { id: "optional-1", group: "technical", required: false },
  ];
  const passed = aggregateDetailedEvaluation({
    report: {
      chiTietList: [
        { tieuChiDanhGiaId: "required-1", ketQua: "pass", diem: 80 },
        { tieuChiDanhGiaId: "optional-1", ketQua: "not_applicable", diem: null },
      ],
    },
    criteria,
    group: "technical",
  });
  assert.deepEqual(passed, {
    status: "Đạt",
    score: 80,
    clarification: "",
  });

  const failedReport = {
    chiTietList: [{
      tieuChiDanhGiaId: "required-1",
      ketQua: "fail",
      lyDoKhongDat: "Không đáp ứng thông số kỹ thuật",
      yeuCauLamRo: "Yêu cầu làm rõ catalogue",
    }],
  };
  assert.deepEqual(
    aggregateDetailedEvaluation({ report: failedReport, criteria, group: "technical" }),
    {
      status: "Không đạt",
      score: null,
      clarification: "Yêu cầu làm rõ catalogue",
    },
  );
  assert.equal(
    aggregateDetailedEvaluationReport({
      report: failedReport,
      criteria,
      groups: ["technical"],
    }).overall.status,
    "Không đạt",
  );
});


test("draft reports do not overwrite the legacy projection and completed reports do", () => {
  const pkg = { id: "package-1" };
  const bid = {
    id: "opening-1",
    danhGiaHopLe: "Kết quả cũ",
    danhGiaKetLuan: "Kết luận cũ",
  };
  bid.lamRoHopLe = "General report clarification";
  bid.nguyenNhanKhongDatHopLe = "General report validity reason";
  bid.lyDoTruot = "General report overall reason";
  const criteria = [
    { id: "validity-1", group: "validity", required: true },
    { id: "technical-1", group: "technical", required: true },
  ];
  const draft = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria,
  });
  assert.equal(draft.vongDanhGiaId, "evaluation-round:package-1:single");
  assert.equal(Object.hasOwn(draft, "nguoiChamId"), false);
  assert.deepEqual(draft.chiTietList.map((row) => row.ketQua), ["pending", "pending"]);
  assert.equal(draft.chiTietList.some((row) => Object.hasOwn(row, "lyDoKhongDat")), false);
  assert.equal(bid.baoCaoDanhGiaChiTietList, undefined);

  assert.deepEqual(
    applyDetailedEvaluationProjection(bid, draft, criteria, ["validity", "technical"]),
    bid,
  );

  const completed = {
    ...draft,
    trangThai: "completed",
    chiTietList: [
      { tieuChiDanhGiaId: "validity-1", ketQua: "pass" },
      {
        tieuChiDanhGiaId: "technical-1",
        ketQua: "fail",
        lyDoKhongDat: "Không đáp ứng kỹ thuật",
      },
    ],
  };
  completed.chiTietList[0].yeuCauLamRo = "Old detailed report clarification";
  const projection = applyDetailedEvaluationProjection(
    bid,
    completed,
    criteria,
    ["validity", "technical"],
  );
  assert.equal(projection.lamRoHopLe, "General report clarification");
  assert.equal(projection.nguyenNhanKhongDatHopLe, "General report validity reason");
  assert.equal(projection.lyDoTruot, "General report overall reason");
  assert.equal(projection.danhGiaHopLe, "Đạt");
  assert.equal(projection.danhGiaKyThuat, "Không đạt");
  assert.equal(projection.danhGiaKetLuan, "Không đạt");
  assert.equal(bid.danhGiaHopLe, "Kết quả cũ");
});


test("reopened reports retain ownership of the stale legacy projection", () => {
  const completed = {
    id: "report-1",
    trangThai: "completed",
    extension: { completedGroups: ["validity"] },
  };
  assert.equal(isDetailedEvaluationSummaryOwned(completed), true);

  const reopened = buildReopenedDetailedEvaluationReport(completed);
  assert.equal(reopened.trangThai, "draft");
  assert.equal(reopened.extension.projectionPending, true);
  assert.equal(isDetailedEvaluationSummaryOwned(reopened), true);
  assert.equal(completed.extension.projectionPending, undefined);
});


test("evaluation summary opens a child detailed-report page keyed by opening bid", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
  const summaryContainer = { innerHTML: "" };
  renderEvaluationPanel(summaryContainer, {
    id: "package-1",
    tenGoiThau: "Gói thầu 01",
  });
  assert.match(summaryContainer.innerHTML, /id="btn-danhgiahsdt-detail"/);
  assert.match(summaryContainer.innerHTML, /id="danhgiahsdt-summary-view"/);
  assert.match(summaryContainer.innerHTML, /id="danhgiahsdt-detail-view"/);

  const detailContainer = { innerHTML: "" };
  renderDetailedEvaluationPanel(detailContainer, {
    pkg: {
      id: "package-1",
      tenGoiThau: "Gói thầu 01",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      linhVuc: "Hàng hóa",
    },
    bids: [
      { id: "opening-pl01", label: "[PL01] Công ty ABC – Lô 01" },
      { id: "opening-pl02", label: "[PL02] Công ty ABC – Lô 02" },
    ],
    selectedBidId: "opening-pl01",
    context: resolveDetailedEvaluationContext({}, "single"),
    activeGroup: "validity",
    criteria: [{
      id: "criterion-validity",
      code: "VALIDITY_SUMMARY",
      name: "Tính hợp lệ",
      resultType: "pass_fail",
      required: true,
      maxScore: null,
    }],
    report: {
      trangThai: "draft",
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-validity",
        ketQua: "pass",
      }],
    },
    progress: { completed: 1, total: 1 },
    readOnly: false,
  });
  assert.match(detailContainer.innerHTML, /value="opening-pl01" selected/);
  assert.match(detailContainer.innerHTML, /value="opening-pl02"/);
  assert.match(detailContainer.innerHTML, /data-detailed-evaluation-group="validity"/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-tabs" role="tablist"/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-tabs-toolbar"/);
  assert.doesNotMatch(detailContainer.innerHTML, /detailed-evaluation-hero/);
  assert.doesNotMatch(detailContainer.innerHTML, /Báo cáo đánh giá chi tiết<\/span>/);
  assert.match(
    detailContainer.innerHTML,
    /class="btn package-workflow-tab active"[^>]*data-no-icon/,
  );
  assert.match(detailContainer.innerHTML, /data-no-sort="true"/);
  assert.match(detailContainer.innerHTML, /<th rowspan="2">STT<\/th>/);
  assert.doesNotMatch(detailContainer.innerHTML, /<th>Mã<\/th>/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-stt">1<\/strong>/);
  assert.doesNotMatch(detailContainer.innerHTML, /\$\{index \+ 1\}/);
  assert.match(detailContainer.innerHTML, /detailed-evaluation-header-group/);
  assert.match(detailContainer.innerHTML, /class="detailed-evaluation-field-stack"/);
  assert.match(detailContainer.innerHTML, /id="btn-detailed-evaluation-save-draft"/);
  assert.match(detailContainer.innerHTML, /id="btn-detailed-evaluation-import-excel"/);
  assert.match(detailContainer.innerHTML, /id="detailed-evaluation-excel-input"[^>]*accept="\.xlsx,\.xls"/);
  assert.match(detailContainer.innerHTML, /id="btn-detailed-evaluation-complete-report"/);
  assert.doesNotMatch(detailContainer.innerHTML, /<th[^>]*>Làm rõ<\/th>/);
  assert.doesNotMatch(detailContainer.innerHTML, /data-detailed-field="yeuCauLamRo"/);
  assert.doesNotMatch(detailContainer.innerHTML, /data-detailed-field="ketQuaLamRo"/);
  assert.doesNotMatch(detailContainer.innerHTML, /data-detailed-field="taiLieuThamChieu"/);
  assert.doesNotMatch(detailContainer.innerHTML, /data-detailed-field="lyDoKhongDat"/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("imported system result is displayed without completing the expert result", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const container = { innerHTML: "" };
    renderDetailedEvaluationPanel(container, {
      bids: [{ id: "opening-1", label: "Nhà thầu A" }],
      selectedBidId: "opening-1",
      context: {
        visibleGroups: ["validity"],
        editableGroups: ["validity"],
        templateSource: "14A",
      },
      activeGroup: "validity",
      criteria: [{
        id: "criterion-validity",
        name: "Bảo đảm dự thầu",
        group: "validity",
        resultType: "pass_fail",
      }],
      report: {
        trangThai: "draft",
        chiTietList: [{
          tieuChiDanhGiaId: "criterion-validity",
          ketQua: "pending",
          extension: { ketQuaTuDong: "pass" },
        }],
      },
      progress: { completed: 0, total: 1 },
    });

    const systemPass = container.innerHTML.match(
      /<input[^>]*data-detailed-field="ketQuaTuDong"[^>]*data-detailed-result-value="pass"[^>]*>/,
    )?.[0] || "";
    const expertPass = container.innerHTML.match(
      /<input[^>]*data-detailed-field="ketQua"[^>]*data-detailed-result-value="pass"[^>]*>/,
    )?.[0] || "";
    assert.match(container.innerHTML, /<th colspan="2">Kết quả đánh giá tự động từ Hệ thống<\/th>/);
    assert.match(container.innerHTML, /<th>Đạt<\/th><th>Không đạt<\/th><th>Đạt<\/th><th>Không đạt<\/th>/);
    assert.match(systemPass, /checked/);
    assert.doesNotMatch(systemPass, /disabled/);
    assert.doesNotMatch(expertPass, /checked/);
    assert.doesNotMatch(container.innerHTML, /data-detailed-field="noiDungHsdt"/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("a new detailed report shows only table headers and row configuration actions", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const container = { innerHTML: "" };
    renderDetailedEvaluationPanel(container, {
      bids: [{ id: "opening-1", label: "Nhà thầu A" }],
      selectedBidId: "opening-1",
      context: { visibleGroups: ["validity"], editableGroups: ["validity"] },
      activeGroup: "validity",
      criteria: [],
      report: { trangThai: "draft", chiTietList: [] },
      progress: { completed: 0, total: 0 },
    });

    assert.match(container.innerHTML, /id="btn-detailed-evaluation-add-row"/);
    assert.match(container.innerHTML, /id="btn-detailed-evaluation-import-excel"/);
    assert.match(container.innerHTML, /<thead>[\s\S]*Kết quả đánh giá của chuyên gia[\s\S]*<\/thead>/);
    assert.match(container.innerHTML, /<tbody id="detailed-evaluation-criteria-body"><\/tbody>/);
    assert.doesNotMatch(container.innerHTML, /data-detailed-criterion-id/);
    assert.doesNotMatch(container.innerHTML, /Chưa có tiêu chí trong nhóm này/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("a manually added row exposes editable STT, criterion content and requirement", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const container = { innerHTML: "" };
    const criterion = {
      id: "custom-criterion-1",
      stt: "1",
      name: "",
      requirement: "",
      group: "validity",
      resultType: "pass_fail",
      isCustom: true,
      required: true,
    };
    renderDetailedEvaluationPanel(container, {
      bids: [{ id: "opening-1", label: "Nhà thầu A" }],
      selectedBidId: "opening-1",
      context: { visibleGroups: ["validity"], editableGroups: ["validity"] },
      activeGroup: "validity",
      criteria: [criterion],
      report: {
        trangThai: "draft",
        chiTietList: [{ tieuChiDanhGiaId: criterion.id, ketQua: "pending" }],
      },
      progress: { completed: 0, total: 1 },
    });

    assert.match(container.innerHTML, /data-detailed-config-field="stt"/);
    assert.match(container.innerHTML, /data-detailed-config-field="name"/);
    assert.match(container.innerHTML, /data-detailed-config-field="requirement"/);
    assert.match(container.innerHTML, /data-detailed-remove-criterion="custom-criterion-1"/);

    const field = (value) => ({ value });
    const rowElement = {
      getAttribute: () => criterion.id,
      querySelector: (selector) => {
        if (selector.includes('="stt"')) return field("2.1.");
        if (selector.includes('="name"')) return field("  Năng lực tài chính  ");
        if (selector.includes('="requirement"')) return field("  Doanh thu tối thiểu  ");
        return null;
      },
    };
    const configured = collectConfiguredDetailedEvaluationCriteria(
      { querySelectorAll: () => [rowElement] },
      [criterion],
    );
    assert.equal(configured[0].stt, "2.1");
    assert.equal(configured[0].name, "Năng lực tài chính");
    assert.equal(configured[0].requirement, "Doanh thu tối thiểu");
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("add-row action creates a custom criterion and matching draft row", async () => {
  let renderCount = 0;
  let focused = false;
  const detail = {
    querySelectorAll: () => [],
    querySelector: () => ({ focus: () => { focused = true; } }),
  };
  const controller = {
    model: {
      state: {
        goithau: [{
          id: "package-1",
          phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
          trangThai: "Đang chấm thầu",
        }],
        thongtinmothau: [{
          id: "opening-1",
          goiThauId: "package-1",
          nhaThauId: "contractor-1",
        }],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
    },
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-1",
    renderDetailedEvaluation: async () => { renderCount += 1; },
  };

  assert.equal(await addDetailedEvaluationCriterion.call(controller), true);
  const criteria = controller._detailedEvaluationCriteriaOverrides.get("package-1:single");
  const report = controller._detailedEvaluationDrafts.get("package-1:opening-1:single");
  assert.equal(criteria.length, 1);
  assert.equal(criteria[0].isCustom, true);
  assert.equal(criteria[0].stt, "1");
  assert.equal(report.chiTietList.length, 1);
  assert.equal(report.chiTietList[0].tieuChiDanhGiaId, criteria[0].id);
  assert.equal(controller._detailedEvaluationDirty, true);
  assert.equal(renderCount, 1);
  assert.equal(focused, true);
});


test("financial evaluation follows the source workbook's three-column layout", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const container = { innerHTML: "" };
    renderDetailedEvaluationPanel(container, {
      bids: [{ id: "opening-1", label: "Nhà thầu A" }],
      selectedBidId: "opening-1",
      context: { visibleGroups: ["financial"], editableGroups: ["financial"] },
      activeGroup: "financial",
      criteria: [{
        id: "financial-criterion-1",
        stt: "1",
        name: "Giá dự thầu",
        group: "financial",
        resultType: "pass_fail",
        required: true,
      }],
      report: {
        trangThai: "draft",
        chiTietList: [{
          tieuChiDanhGiaId: "financial-criterion-1",
          ketQua: "pass",
          noiDungHsdt: "1.289.900.000 VND",
          nhanXet: "Không được hiển thị",
        }],
      },
      progress: { completed: 1, total: 1 },
    });

    assert.match(container.innerHTML, /detailed-evaluation-table-financial/);
    assert.match(container.innerHTML, /<th>STT<\/th>[\s\S]*<th>Nội dung<\/th>[\s\S]*<th>Giá trị<\/th>/);
    assert.match(container.innerHTML, /1\.289\.900\.000 VND/);
    assert.doesNotMatch(container.innerHTML, /Kết quả đánh giá/);
    assert.doesNotMatch(container.innerHTML, /Nhận xét/);
    assert.doesNotMatch(container.innerHTML, /data-detailed-field="ketQua"/);
    assert.doesNotMatch(container.innerHTML, /data-detailed-field="nhanXet"/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("a financial row is internally complete when its value is entered", () => {
  const field = (value) => ({ value });
  const rowElement = {
    getAttribute: () => "financial-criterion-1",
    querySelector: (selector) => {
      if (selector.includes('data-detailed-field="noiDungHsdt"')) {
        return field("1.289.900.000 VND");
      }
      return null;
    },
  };
  const rows = collectActiveGroupRows(
    { querySelectorAll: () => [rowElement] },
    { id: "report-1", chiTietList: [] },
    [{
      id: "financial-criterion-1",
      group: "financial",
      resultType: "pass_fail",
    }],
  );
  assert.equal(rows[0].ketQua, "pass");
  assert.equal(rows[0].noiDungHsdt, "1.289.900.000 VND");
});


test("edited system and expert result marks are collected into separate fields", () => {
  const choice = (value) => ({
    getAttribute: (name) => name === "data-detailed-result-value" ? value : "",
  });
  const rowElement = {
    getAttribute: () => "criterion-validity",
    querySelector: (selector) => {
      if (selector.includes('data-detailed-field="ketQuaTuDong"')
        && selector.includes(":checked")) return choice("fail");
      if (selector.includes('data-detailed-field="ketQuaTuDong"')) return choice("pass");
      if (selector.includes('data-detailed-field="ketQua"')
        && selector.includes(":checked")) return choice("pass");
      if (selector.includes('data-detailed-field="ketQua"')) return choice("pass");
      return { value: "" };
    },
  };
  const rows = collectActiveGroupRows(
    { querySelectorAll: () => [rowElement] },
    {
      id: "report-1",
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-validity",
        ketQua: "pending",
        extension: { ketQuaTuDong: "pending" },
      }],
    },
    [{ id: "criterion-validity", resultType: "pass_fail" }],
  );

  assert.equal(rows[0].ketQua, "pass");
  assert.equal(rows[0].extension.ketQuaTuDong, "fail");
});


test("parent criteria are aggregated bottom-up for system and expert results", () => {
  const criteria = markHierarchicalDetailedEvaluationCriteria([
    { id: "2", stt: "2", group: "validity", resultType: "pass_fail" },
    { id: "2.1", stt: "2.1", group: "validity", resultType: "pass_fail" },
    { id: "2.1.1", stt: "2.1.1", group: "validity", resultType: "pass_fail" },
    { id: "2.1.2", stt: "2.1.2", group: "validity", resultType: "pass_fail" },
  ]);
  assert.equal(criteria.find((criterion) => criterion.id === "2").hasChildren, true);
  assert.equal(criteria.find((criterion) => criterion.id === "2.1").hasChildren, true);
  assert.equal(criteria.find((criterion) => criterion.id === "2.1.1").hasChildren, false);

  const report = applyHierarchicalDetailedEvaluationResults({
    id: "report-1",
    chiTietList: [
      { tieuChiDanhGiaId: "2", ketQua: "pending", extension: { ketQuaTuDong: "pending" } },
      { tieuChiDanhGiaId: "2.1", ketQua: "pending", extension: { ketQuaTuDong: "pending" } },
      { tieuChiDanhGiaId: "2.1.1", ketQua: "pass", extension: { ketQuaTuDong: "pass" } },
      { tieuChiDanhGiaId: "2.1.2", ketQua: "pass", extension: { ketQuaTuDong: "fail" } },
    ],
  }, criteria);
  const rows = new Map(report.chiTietList.map(
    (row) => [String(row.tieuChiDanhGiaId), row],
  ));
  assert.equal(rows.get("2.1").ketQua, "pass");
  assert.equal(rows.get("2").ketQua, "pass");
  assert.equal(rows.get("2.1").extension.ketQuaTuDong, "fail");
  assert.equal(rows.get("2").extension.ketQuaTuDong, "fail");

  rows.get("2.1.2").ketQua = "pending";
  const pending = applyHierarchicalDetailedEvaluationResults({
    ...report,
    chiTietList: [...rows.values()],
  }, criteria);
  const pendingRows = new Map(pending.chiTietList.map(
    (row) => [String(row.tieuChiDanhGiaId), row],
  ));
  assert.equal(pendingRows.get("2.1").ketQua, "pending");
  assert.equal(pendingRows.get("2").ketQua, "pending");
});


test("parent criteria show calculated marks without editable result checkboxes", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    const criteria = markHierarchicalDetailedEvaluationCriteria([
      {
        id: "criterion-parent",
        stt: "2",
        name: "Tư cách hợp lệ của nhà thầu",
        group: "validity",
        resultType: "pass_fail",
      },
      {
        id: "criterion-child",
        stt: "2.1",
        name: "Hạch toán tài chính độc lập",
        group: "validity",
        resultType: "pass_fail",
      },
    ]);
    const report = applyHierarchicalDetailedEvaluationResults({
      chiTietList: [{
        tieuChiDanhGiaId: "criterion-child",
        ketQua: "pass",
        extension: { ketQuaTuDong: "fail" },
      }],
    }, criteria);
    const container = { innerHTML: "" };
    renderDetailedEvaluationPanel(container, {
      bids: [{ id: "opening-1", label: "Nhà thầu A" }],
      selectedBidId: "opening-1",
      context: { visibleGroups: ["validity"], editableGroups: ["validity"] },
      activeGroup: "validity",
      criteria,
      report,
      progress: { completed: 1, total: 1 },
    });

    const parentRow = container.innerHTML.match(
      /<tr[^>]*detailed-evaluation-parent-row[^>]*data-detailed-criterion-id="criterion-parent"[^>]*>[\s\S]*?<\/tr>/,
    )?.[0] || "";
    assert.match(parentRow, /detailed-evaluation-derived-mark/);
    assert.doesNotMatch(parentRow, /data-detailed-result-value/);
    assert.match(parentRow, /Hệ thống tự tính không đạt/);
    assert.match(parentRow, /Chuyên gia tự tính đạt/);
    assert.match(container.innerHTML, /data-detailed-criterion-id="criterion-child"/);
    assert.match(container.innerHTML, /data-detailed-result-value="pass"/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("detailed evaluation remains a child page and does not add a package tab", () => {
  const tabs = buildPackageTabs({
    id: "package-1",
    trangThai: "Đang chấm thầu",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  }, [{ id: "opening-1", danhGiaKetLuan: "" }]).tabs;
  assert.equal(tabs.some((tab) => String(tab.id).includes("detailed")), false);
  assert.equal(tabs.some((tab) => tab.id === "eval_tech"), true);
});


test("opening detailed evaluation selects the active opening-bid identity", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const classList = { add: () => {}, remove: () => {} };
  const summary = { classList };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const packageSelect = { value: "package-1" };
  const controller = {
    model: {
      state: {
        goithau: [{
          id: "package-1",
          tenGoiThau: "Gói thầu 01",
          phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
          trangThai: "Đang chấm thầu",
        }],
        thongtinmothau: [{
          id: "opening-1",
          goiThauId: "package-1",
          nhaThauId: "contractor-1",
          tenNhaThau: "Công ty ABC",
        }],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": packageSelect,
        "danhgiahsdt-summary-view": summary,
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      createIconsScoped: () => {},
    },
    currentDanhGiaTab: "unified",
  };
  controller.renderDetailedEvaluation = () => renderDetailedEvaluation.call(controller);

  try {
    await openDetailedEvaluation.call(controller);

    assert.equal(controller.selectedEvaluationBidId, "opening-1");
    assert.match(detail.innerHTML, /value="opening-1" selected/);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("a new report does not render stored system template seed criteria", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const classList = { add: () => {}, remove: () => {} };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const pkg = {
    id: "package-template-seed",
    linhVuc: "Hàng hóa",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const seededCriteria = createDefaultDetailedEvaluationCriteria("single", {
    roundId: `evaluation-round:${pkg.id}:single`,
    pkg,
  });
  pkg.danhGiaHsdtMetadata = JSON.stringify({ criteria: seededCriteria });
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [{
          id: "opening-template-seed",
          goiThauId: pkg.id,
          nhaThauId: "contractor-1",
          baoCaoDanhGiaChiTietList: [{
            id: "report-template-seed",
            loaiVong: "single",
            trangThai: "draft",
            chiTietList: seededCriteria.map((criterion) => ({
              tieuChiDanhGiaId: criterion.id,
              ketQua: "pending",
            })),
          }],
        }],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: pkg.id },
        "danhgiahsdt-summary-view": { classList },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      createIconsScoped: () => {},
    },
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-template-seed",
  };

  try {
    await renderDetailedEvaluation.call(controller);
    assert.match(detail.innerHTML, /id="btn-detailed-evaluation-add-row"/);
    assert.match(detail.innerHTML, /id="btn-detailed-evaluation-import-excel"/);
    assert.doesNotMatch(detail.innerHTML, /data-detailed-criterion-id/);
    assert.match(detail.innerHTML, /<tbody id="detailed-evaluation-criteria-body"><\/tbody>/);
    assert.deepEqual(
      controller._detailedEvaluationDrafts
        .get(`${pkg.id}:opening-template-seed:single`)
        .chiTietList,
      [],
    );
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("reopened reports follow the system bidder type instead of the workbook identity", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const classList = { add: () => {}, remove: () => {} };
  const summary = { classList };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const criteria = [
    { id: "v1", code: "BID_SECURITY", name: "Bảo đảm dự thầu", group: "validity", resultType: "pass_fail", required: true, stt: "1", order: 0 },
    { id: "v2", code: "JV_AGREEMENT", name: "Thỏa thuận liên danh (đối với nhà thầu liên danh)", group: "validity", resultType: "pass_fail", required: true, stt: "2", order: 1 },
    { id: "v3", code: "LEGAL_STATUS", name: "Tư cách hợp lệ của nhà thầu", group: "validity", resultType: "pass_fail", required: true, stt: "3", order: 2 },
    { id: "v31", code: "LEGAL_STATUS_SECTION", name: "Nhà thầu là tổ chức", group: "validity", resultType: "pass_fail", required: false, stt: "3.1", order: 3 },
  ];
  const report = {
    id: "report-1",
    loaiVong: "single",
    trangThai: "draft",
    extension: { excelBidType: "Liên danh" },
    chiTietList: criteria.map((criterion) => ({
      tieuChiDanhGiaId: criterion.id,
      ketQua: "pass",
    })),
  };
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({ criteria }),
  };
  const bid = {
    id: "opening-1",
    goiThauId: pkg.id,
    nhaThauId: "contractor-1",
    loaiNhaThau: "Độc lập",
    baoCaoDanhGiaChiTietList: [report],
  };
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [bid],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: pkg.id },
        "danhgiahsdt-summary-view": summary,
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      createIconsScoped: () => {},
    },
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: bid.id,
  };

  try {
    await renderDetailedEvaluation.call(controller);
    assert.doesNotMatch(detail.innerHTML, /Thỏa thuận liên danh/);
    assert.match(detail.innerHTML, /class="detailed-evaluation-stt">2<\/strong>/);
    assert.match(detail.innerHTML, /class="detailed-evaluation-stt">2\.1<\/strong>/);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("locked completed reports do not offer a reopen action", () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const container = { innerHTML: "" };

  try {
    renderDetailedEvaluationPanel(container, {
      pkg: { tenGoiThau: "Gói thầu đã có kết quả" },
      bids: [{ id: "opening-1", label: "Công ty ABC" }],
      selectedBidId: "opening-1",
      context: resolveDetailedEvaluationContext({}, "single"),
      activeGroup: "validity",
      criteria: [{
        id: "criterion-validity",
        code: "VALIDITY",
        name: "Tính hợp lệ",
        group: "validity",
        resultType: "pass_fail",
        required: true,
      }],
      report: {
        trangThai: "completed",
        chiTietList: [{
          tieuChiDanhGiaId: "criterion-validity",
          ketQua: "pass",
        }],
      },
      readOnly: true,
      canReopen: false,
    });

    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-reopen/);
    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-save-draft/);
    assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-previous/);
  assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-next/);
  assert.doesNotMatch(container.innerHTML, /btn-detailed-evaluation-import-excel/);
    assert.match(container.innerHTML, /data-detailed-field="ketQua"[^>]*disabled/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("saving a lot-scoped draft persists by opening bid and survives reload", async () => {
  const packageRecord = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const pl01 = {
    id: "opening-pl01",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    maPhanLo: "PL01",
  };
  const pl02 = {
    id: "opening-pl02",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    maPhanLo: "PL02",
  };
  const criterionId = "evaluation-criterion:evaluation-round:package-1:single:VALIDITY_SUMMARY";
  packageRecord.danhGiaHsdtMetadata = JSON.stringify({
    criteria: [{
      id: criterionId,
      code: "CONFIGURED_VALIDITY",
      name: "Tính hợp lệ",
      group: "validity",
      resultType: "pass_fail",
      required: true,
      stt: "1",
      order: 0,
    }],
  });
  const fields = {
    ketQua: "pass",
    diem: "",
    noiDungHsdt: "Giấy đăng ký kinh doanh",
    nhanXet: "Đáp ứng",
    lyDoKhongDat: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "Mục I",
  };
  const criterionElement = {
    getAttribute: () => criterionId,
    querySelector: (selector) => {
      const field = selector.match(/data-detailed-field="([^"]+)"/)?.[1];
      return field ? { value: fields[field] ?? "" } : null;
    },
  };
  const detail = {
    querySelectorAll: (selector) => (
      selector === "[data-detailed-criterion-id]" ? [criterionElement] : []
    ),
    querySelector: () => null,
  };
  const persisted = [];
  let syncCount = 0;
  const controller = {
    model: {
      state: {
        goithau: [packageRecord],
        thongtinmothau: [pl01, pl02],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
      persistData: async (key) => { persisted.push(key); },
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customAlert: async () => true,
    },
    autoSync: async () => {
      syncCount += 1;
      return { ok: true };
    },
    renderDetailedEvaluation: () => {},
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-pl01",
  };

  assert.equal(await saveDetailedEvaluation.call(controller), true);
  assert.deepEqual(persisted, ["goithau", "thongtinmothau"]);
  assert.equal(syncCount, 1);
  assert.equal(pl02.baoCaoDanhGiaChiTietList, undefined);
  const savedReport = getDetailedReportForRound(pl01, "single");
  assert.equal(savedReport.trangThai, "draft");
  assert.equal(
    savedReport.chiTietList.find(
      (row) => row.tieuChiDanhGiaId === criterionId,
    ).noiDungHsdt,
    "Giấy đăng ký kinh doanh",
  );

  const reloadedBid = JSON.parse(JSON.stringify(pl01));
  assert.equal(
    getDetailedReportForRound(reloadedBid, "single").chiTietList.find(
      (row) => row.tieuChiDanhGiaId === criterionId,
    ).ketQua,
    "pass",
  );
});


test("later draft saves persist newly configured criteria across tabs", async () => {
  const pkg = {
    id: "package-criteria-draft",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const bid = {
    id: "opening-criteria-draft",
    goiThauId: pkg.id,
    nhaThauId: "contractor-1",
  };
  const validity = {
    id: "configured-validity",
    code: "CONFIGURED_VALIDITY",
    name: "Bảo đảm dự thầu",
    group: "validity",
    resultType: "pass_fail",
    required: true,
    stt: "1",
    order: 0,
  };
  const capacity = {
    id: "configured-capacity",
    code: "CONFIGURED_CAPACITY",
    name: "Năng lực tài chính",
    group: "capacity",
    resultType: "pass_fail",
    required: true,
    stt: "1",
    order: 1,
  };
  let controller;
  const detail = {
    querySelectorAll: (selector) => {
      if (selector !== "[data-detailed-criterion-id]") return [];
      const criteria = controller._detailedEvaluationCriteriaOverrides
        .get(`${pkg.id}:single`)
        .filter((criterion) => criterion.group === controller.selectedDetailedEvaluationTab);
      return criteria.map((criterion) => ({
        getAttribute: () => criterion.id,
        querySelector: (fieldSelector) => {
          if (fieldSelector.includes("data-detailed-config-field")) return null;
          const field = fieldSelector.match(/data-detailed-field="([^"]+)"/)?.[1];
          if (!field) return null;
          return { value: field === "ketQua" ? "pass" : `${criterion.group} value` };
        },
      }));
    },
    querySelector: () => null,
  };
  controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [bid],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
      persistData: async () => {},
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: pkg.id },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customAlert: async () => true,
    },
    autoSync: async () => ({ ok: true }),
    renderDetailedEvaluation: () => {},
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: bid.id,
    _detailedEvaluationCriteriaOverrides: new Map([[`${pkg.id}:single`, [validity]]]),
  };
  const firstDraft = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria: [validity],
  });
  controller._detailedEvaluationDrafts = new Map([[
    `${pkg.id}:${bid.id}:single`,
    firstDraft,
  ]]);
  assert.equal(await saveDetailedEvaluation.call(controller), true);

  const secondDraftRow = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria: [capacity],
  }).chiTietList[0];
  controller._detailedEvaluationCriteriaOverrides.set(
    `${pkg.id}:single`,
    [validity, capacity],
  );
  controller._detailedEvaluationDrafts.set(`${pkg.id}:${bid.id}:single`, {
    ...getDetailedReportForRound(bid, "single"),
    chiTietList: [
      ...getDetailedReportForRound(bid, "single").chiTietList,
      secondDraftRow,
    ],
  });
  controller.selectedDetailedEvaluationTab = "capacity";
  assert.equal(await saveDetailedEvaluation.call(controller), true);

  const metadata = JSON.parse(pkg.danhGiaHsdtMetadata);
  assert.deepEqual(
    metadata.criteria.map((criterion) => criterion.id),
    [validity.id, capacity.id],
  );
  assert.equal(
    getDetailedReportForRound(bid, "single").chiTietList.some(
      (row) => row.tieuChiDanhGiaId === capacity.id,
    ),
    true,
  );
});


test("completing a detailed report updates the legacy summary projection", async () => {
  const pkg = {
    id: "package-1",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const criteria = createDefaultDetailedEvaluationCriteria("single", {
    roundId: "evaluation-round:package-1:single",
    pkg,
  });
  const bid = {
    id: "opening-1",
    goiThauId: "package-1",
    nhaThauId: "contractor-1",
    danhGiaKetLuan: "Kết luận cũ",
  };
  const draft = buildDetailedEvaluationDraft({
    pkg,
    bid,
    roundType: "single",
    criteria,
  });
  draft.chiTietList = draft.chiTietList.map((row) => ({
    ...row,
    ketQua: "pass",
  }));
  draft.extension = { projectionPending: true };
  bid.baoCaoDanhGiaChiTietList = [draft];
  const validityId = criteria.find((criterion) => criterion.group === "validity").id;
  const fields = {
    ketQua: "pass",
    diem: "",
    noiDungHsdt: "Đầy đủ",
    nhanXet: "Đạt",
    lyDoKhongDat: "",
    yeuCauLamRo: "",
    ketQuaLamRo: "",
    taiLieuThamChieu: "",
  };
  const criterionElement = {
    getAttribute: () => validityId,
    querySelector: (selector) => {
      const field = selector.match(/data-detailed-field="([^"]+)"/)?.[1];
      return field ? { value: fields[field] ?? "" } : null;
    },
  };
  const detail = {
    querySelectorAll: (selector) => (
      selector === "[data-detailed-criterion-id]" ? [criterionElement] : []
    ),
    querySelector: () => null,
  };
  const controller = {
    model: {
      state: {
        goithau: [pkg],
        thongtinmothau: [bid],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
      persistData: async () => {},
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customAlert: async () => true,
    },
    autoSync: async () => ({ ok: true }),
    renderDetailedEvaluation: () => {},
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-1",
  };

  assert.equal(
    await saveDetailedEvaluation.call(controller, { completeReport: true }),
    true,
  );
  const completed = getDetailedReportForRound(bid, "single");
  assert.equal(completed.trangThai, "completed");
  assert.equal(completed.ketLuan, "Đạt");
  assert.ok(completed.hoanThanhLuc);
  assert.equal(completed.extension.projectionPending, undefined);
  assert.equal(bid.danhGiaHopLe, "Đạt");
  assert.equal(bid.danhGiaNangLuc, "Đạt");
  assert.equal(bid.danhGiaKyThuat, "Đạt");
  assert.equal(bid.danhGiaTaiChinh, "Đạt");
  assert.equal(bid.danhGiaKetLuan, "Đạt");
});


test("MVP workflows complete 1G1T and 1G2T reports across every round", async () => {
  const createController = (pkg, bids, currentTab) => {
    const twoEnvelope = String(pkg.phuongThucLuaChon || "").includes("hai túi hồ sơ");
    const metadata = pkg.danhGiaHsdtMetadata
      ? JSON.parse(pkg.danhGiaHsdtMetadata)
      : {};
    if (twoEnvelope) {
      metadata.technical = {
        ...(metadata.technical || {}),
        criteria: createDefaultDetailedEvaluationCriteria("technical", {
          roundId: `evaluation-round:${pkg.id}:technical`,
          pkg,
        }).map((criterion) => ({ ...criterion, source: "custom" })),
      };
      metadata.financial = {
        ...(metadata.financial || {}),
        criteria: createDefaultDetailedEvaluationCriteria("financial", {
          roundId: `evaluation-round:${pkg.id}:financial`,
          pkg,
        }).map((criterion) => ({ ...criterion, source: "custom" })),
      };
    } else {
      metadata.criteria = createDefaultDetailedEvaluationCriteria("single", {
        roundId: `evaluation-round:${pkg.id}:single`,
        pkg,
      }).map((criterion) => ({ ...criterion, source: "custom" }));
    }
    pkg.danhGiaHsdtMetadata = JSON.stringify(metadata);
    const controller = {
      model: {
        state: {
          goithau: [pkg],
          thongtinmothau: bids,
          nhathau: [],
          activeuser: { id: "reviewer-1" },
        },
        hasPermission: () => true,
        persistData: async () => {},
      },
      view: {
        getActiveElement: (id) => ({
          "danhgiahsdt-goithau-select": { value: pkg.id },
          "danhgiahsdt-detail-view": detail,
        })[id] || null,
        customAlert: async () => true,
      },
      autoSync: async () => ({ ok: true }),
      renderDetailedEvaluation: () => {},
      currentDanhGiaTab: currentTab,
      selectedDetailedEvaluationTab: "validity",
      selectedEvaluationBidId: bids[0]?.id,
    };
    const detail = {
      querySelectorAll: (selector) => {
        if (selector !== "[data-detailed-criterion-id]") return [];
        const roundType = getEvaluationRoundType(pkg, controller.currentDanhGiaTab);
        const criteria = getCriteriaForGroup(
          pkg,
          roundType,
          controller.selectedDetailedEvaluationTab,
        );
        return criteria.map((criterion) => ({
          getAttribute: () => criterion.id,
          querySelector: (fieldSelector) => {
            const field = fieldSelector.match(/data-detailed-field="([^"]+)"/)?.[1];
            const value = field === "ketQua"
              ? "pass"
              : controller.selectedDetailedEvaluationTab === "financial"
                && field === "noiDungHsdt"
                ? "100 VND"
                : "";
            return { value };
          },
        }));
      },
      querySelector: () => null,
    };
    return controller;
  };
  const completeGroups = async (controller, groups) => {
    for (const [index, group] of groups.entries()) {
      controller.selectedDetailedEvaluationTab = group;
      const completeReport = index === groups.length - 1;
      assert.equal(await saveDetailedEvaluation.call(
        controller,
        completeReport ? { completeReport: true } : { completeGroup: true },
      ), true);
    }
  };

  const singlePackage = {
    id: "package-single-e2e",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const singleBid = {
    id: "opening-single-e2e",
    goiThauId: singlePackage.id,
    nhaThauId: "contractor-single-e2e",
  };
  const singleController = createController(singlePackage, [singleBid], "unified");
  await completeGroups(singleController, [
    "validity",
    "capacity",
    "technical",
    "financial",
  ]);
  const singleReport = getDetailedReportForRound(singleBid, "single");
  assert.equal(singleReport.trangThai, "completed");
  assert.equal(singleReport.ketLuan, "Đạt");
  assert.equal(singleBid.danhGiaKetLuan, "Đạt");
  assert.equal(
    getDetailedReportForRound(JSON.parse(JSON.stringify(singleBid)), "single").trangThai,
    "completed",
  );

  const twoEnvelopePackage = {
    id: "package-two-envelope-e2e",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: {},
      financial: {},
    }),
  };
  const qualifiedBid = {
    id: "opening-qualified-e2e",
    goiThauId: twoEnvelopePackage.id,
    nhaThauId: "contractor-qualified-e2e",
  };
  const rejectedBid = {
    id: "opening-rejected-e2e",
    goiThauId: twoEnvelopePackage.id,
    nhaThauId: "contractor-rejected-e2e",
    danhGiaKetLuan: "Không đạt",
  };
  const twoEnvelopeController = createController(
    twoEnvelopePackage,
    [qualifiedBid, rejectedBid],
    "technical",
  );
  await completeGroups(twoEnvelopeController, ["validity", "capacity", "technical"]);
  assert.equal(getDetailedReportForRound(qualifiedBid, "technical").ketLuan, "Đạt");

  const metadata = JSON.parse(twoEnvelopePackage.danhGiaHsdtMetadata);
  metadata.technical.saved = true;
  metadata.technical.qualifiedSaved = true;
  twoEnvelopePackage.danhGiaHsdtMetadata = JSON.stringify(metadata);
  assert.deepEqual(
    getEligibleFinancialEvaluationBids(twoEnvelopeController.model, twoEnvelopePackage)
      .map((bid) => bid.id),
    [qualifiedBid.id],
  );
  qualifiedBid.giaDuThau = 100;
  twoEnvelopeController.currentDanhGiaTab = "financial";
  twoEnvelopeController.selectedDetailedEvaluationTab = "financial";
  assert.equal(await saveDetailedEvaluation.call(
    twoEnvelopeController,
    { completeReport: true },
  ), true);

  assert.deepEqual(
    qualifiedBid.baoCaoDanhGiaChiTietList.map((report) => report.loaiVong),
    ["technical", "financial"],
  );
  assert.equal(getDetailedReportForRound(qualifiedBid, "financial").ketLuan, "Đạt");
  assert.equal(qualifiedBid.danhGiaKetLuan, "Đạt");
  assert.equal(rejectedBid.baoCaoDanhGiaChiTietList, undefined);
});


test("leaving a dirty detailed report requires explicit confirmation", async () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class Element {};
  const operations = [];
  const classList = {
    add: (value) => operations.push(["add", value]),
    remove: (value) => operations.push(["remove", value]),
  };
  let allowDiscard = false;
  const controller = {
    currentEvaluationView: "contractor-detail",
    _detailedEvaluationDirty: true,
    view: {
      customConfirm: async () => allowDiscard,
      getActiveElement: (id) => ({
        "danhgiahsdt-summary-view": { classList },
        "danhgiahsdt-detail-view": { classList },
      })[id] || null,
    },
  };

  try {
    assert.equal(await closeDetailedEvaluation.call(controller), false);
    assert.equal(controller.currentEvaluationView, "contractor-detail");
    assert.equal(controller._detailedEvaluationDirty, true);
    assert.deepEqual(operations, []);

    allowDiscard = true;
    assert.equal(await closeDetailedEvaluation.call(controller), true);
    assert.equal(controller.currentEvaluationView, "summary");
    assert.equal(controller._detailedEvaluationDirty, false);
    assert.deepEqual(operations, [
      ["remove", "is-hidden"],
      ["add", "is-hidden"],
    ]);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});


test("next-bid command navigates by opening-bid order", async () => {
  const previousElement = globalThis.Element;
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  globalThis.Element = class Element {};
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const listeners = {};
  const button = (id) => ({
    addEventListener: (_event, handler) => { listeners[id] = handler; },
  });
  const elements = {
    "#btn-detailed-evaluation-back": button("back"),
    "#detailed-evaluation-bid-select": { value: "opening-1" },
    "#btn-detailed-evaluation-previous": button("previous"),
    "#btn-detailed-evaluation-next": button("next"),
    "#btn-detailed-evaluation-save-draft": button("save"),
    "#btn-detailed-evaluation-complete-group": button("complete-group"),
    "#btn-detailed-evaluation-complete-report": button("complete-report"),
  };
  const classList = { add: () => {}, remove: () => {} };
  const detail = {
    classList,
    innerHTML: "",
    querySelector: (selector) => elements[selector] || null,
    querySelectorAll: () => [],
  };
  let renderCount = 0;
  const controller = {
    model: {
      state: {
        goithau: [{
          id: "package-1",
          phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
          trangThai: "Đang chấm thầu",
        }],
        thongtinmothau: [
          {
            id: "opening-pl01",
            goiThauId: "package-1",
            nhaThauId: "contractor-1",
            maPhanLo: "PL01",
          },
          {
            id: "opening-pl02",
            goiThauId: "package-1",
            nhaThauId: "contractor-1",
            maPhanLo: "PL02",
          },
        ],
        nhathau: [],
        activeuser: { id: "reviewer-1" },
      },
      hasPermission: () => true,
    },
    view: {
      getActiveElement: (id) => ({
        "danhgiahsdt-goithau-select": { value: "package-1" },
        "danhgiahsdt-summary-view": { classList },
        "danhgiahsdt-detail-view": detail,
      })[id] || null,
      customConfirm: async () => true,
      createIconsScoped: () => {},
    },
    renderDetailedEvaluation: () => { renderCount += 1; },
    currentDanhGiaTab: "unified",
    selectedDetailedEvaluationTab: "validity",
    selectedEvaluationBidId: "opening-pl01",
  };

  try {
    await renderDetailedEvaluation.call(controller);
    await listeners.next();

    assert.equal(controller.selectedEvaluationBidId, "opening-pl02");
    assert.equal(renderCount, 1);
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});


test("workflow locks view-only, qualified technical, and unopened financial rounds", async () => {
  const lockedSave = async ({ pkg, bid, currentTab, hasPermission = true }) => {
    let persistCount = 0;
    const controller = {
      model: {
        state: {
          goithau: [pkg],
          thongtinmothau: [bid],
          nhathau: [],
          activeuser: { id: "reviewer-1" },
        },
        hasPermission: () => hasPermission,
        persistData: async () => { persistCount += 1; },
      },
      view: {
        getActiveElement: (id) => ({
          "danhgiahsdt-goithau-select": { value: pkg.id },
          "danhgiahsdt-detail-view": {
            querySelectorAll: () => [],
            querySelector: () => null,
          },
        })[id] || null,
      },
      currentDanhGiaTab: currentTab,
      selectedDetailedEvaluationTab: "validity",
      selectedEvaluationBidId: bid.id,
    };
    const result = await saveDetailedEvaluation.call(controller);
    return { result, persistCount };
  };

  const oneEnvelopePackage = {
    id: "package-single",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    trangThai: "Đang chấm thầu",
  };
  const oneEnvelopeBid = {
    id: "opening-single",
    goiThauId: "package-single",
  };
  assert.deepEqual(await lockedSave({
    pkg: oneEnvelopePackage,
    bid: oneEnvelopeBid,
    currentTab: "unified",
    hasPermission: false,
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: { ...oneEnvelopePackage, trangThai: "Đã có kết quả" },
    bid: oneEnvelopeBid,
    currentTab: "unified",
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: {
      ...oneEnvelopePackage,
      danhGiaHsdtMetadata: JSON.stringify({ saved: true }),
    },
    bid: oneEnvelopeBid,
    currentTab: "unified",
  }), { result: false, persistCount: 0 });

  const twoEnvelopePackage = {
    id: "package-two-envelope",
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: false },
    }),
  };
  const qualifiedBid = {
    id: "opening-qualified",
    goiThauId: "package-two-envelope",
    danhGiaKetLuan: "Đạt",
  };
  assert.deepEqual(await lockedSave({
    pkg: twoEnvelopePackage,
    bid: qualifiedBid,
    currentTab: "technical",
  }), { result: false, persistCount: 0 });
  assert.deepEqual(await lockedSave({
    pkg: twoEnvelopePackage,
    bid: qualifiedBid,
    currentTab: "financial",
  }), { result: false, persistCount: 0 });

  const completedFinancialPackage = {
    ...twoEnvelopePackage,
    danhGiaHsdtMetadata: JSON.stringify({
      is1G2T: true,
      technical: { saved: true, qualifiedSaved: true },
      financial: { saved: true },
    }),
  };
  assert.deepEqual(await lockedSave({
    pkg: completedFinancialPackage,
    bid: { ...qualifiedBid, giaDuThau: 100 },
    currentTab: "financial",
  }), { result: false, persistCount: 0 });
});
