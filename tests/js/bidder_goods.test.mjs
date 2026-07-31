import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import {
  buildBidderGoodsTemplateRows,
  escapeSpreadsheetFormula,
  findBidderGoodsSheet,
  findGoodsPreferenceSheet,
  parseGoodsPreferenceBoolean,
  parseBidderGoodsWorkbookSheets,
} from "../../frontend/packages/BidderGoodsExcel.js";
import { calculateBidderGoodsPreference } from "../../frontend/packages/bidderGoodsPreference.js";
import {
  deriveBidderGoodsLineTotal,
  withDerivedBidderGoodsFinancials,
} from "../../frontend/packages/bidderGoodsFinancials.js";
import {
  resolveAccessibleDetailedEvaluationGroups,
  resolveDetailedEvaluationContext,
} from "../../frontend/packages/detailedEvaluationRules.js";
import {
  calculateRankings,
  goodsPreferenceRankingBlockReason,
} from "../../frontend/shared/BiddingCalculations.js";
import {
  applyManualBidderGoodsMapping,
  mapBidderGoodsRows,
} from "../../frontend/packages/bidderGoodsMapping.js";
import { shouldShowBidderGoodsTab } from "../../frontend/packages/bidderGoodsSelectors.js";
import {
  validateBidderGoodsRow,
  validateBidderGoodsSubmission,
} from "../../frontend/packages/bidderGoodsValidation.js";
import {
  bindBidderGoodsPanel,
  buildBidderGoodsPanelState,
  buildBidderGoodsMappingModalMarkup,
  confirmBidderGoodsImport,
  applyBidderGoodsUnitPriceInput,
  bidderGoodsSummaryPresentation,
  formatBidderGoodsMoneyEdit,
  formatBidderGoodsMoneyInput,
  initializeBidderGoodsFromRequirements,
  renderBidderGoodsPanelMarkup,
  saveBidderGoods,
  sanitizeBidderGoodsMoneyInput,
  updateBidderGoodsPreferenceCode,
} from "../../frontend/packages/BidderGoodsWorkflow.js";
import {
  shouldValidateBidderGoodsOnCompletion,
} from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";

const sharedPreferenceVectors = JSON.parse(
  fs.readFileSync(
    new URL("../fixtures/goods_preference_vectors.json", import.meta.url),
    "utf8",
  ),
);
const require = createRequire(import.meta.url);
const sheetModule = { exports: {} };
const sheetExports = sheetModule.exports;
Function("module", "exports", "require", fs.readFileSync(
  new URL("../../views/vendor/xlsx/xlsx.full.min.js", import.meta.url),
  "utf8",
))(sheetModule, sheetExports, require);
const XLSX = Object.keys(sheetModule.exports).length
  ? sheetModule.exports : sheetExports;

const header = [
  "STT", "Mã phần (lô)", "Tên phần (lô)", "Danh mục hàng hóa",
  "Mặt hàng dự thầu", "Mã hàng hóa", "Phân nhóm", "Kỹ mã hiệu",
  "Nhãn hiệu", "Năm sản xuất", "Xuất xứ (quốc gia, vùng lãnh thổ)",
  "Hãng sản xuất", "Cấu hình, tính năng kỹ thuật cơ bản", "Đơn vị tính",
  "Khối lượng", "Mã HS", "Đơn giá dự thầu", "Thành tiền",
];

test("parser detects Sheet 12.1, dynamic header, aliases, and lot parent rows", () => {
  const pkg = {
    linhVuc: "Hàng hóa",
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "L01", tenPhanLo: "Phần 1" }],
  };
  const sheets = [{
    name: "Mẫu số 12.1B. Bảng giá dự thầu ",
    rows: [
      ["Tiêu đề"], [], [], header,
      ["1", "L01", "Phần 1", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "100"],
      ["1.1", "", "", "Hóa chất A", "bỏ", "bỏ", "bỏ", "K-01", "Nhãn A", "Từ 2026 trở đi", "Việt Nam", "Hãng A", "Thông số", "Hộp", "2", "0382.20", "50", "100"],
      ["Tổng cộng giá dự thầu", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "100"],
    ],
  }];
  assert.equal(findBidderGoodsSheet(sheets)?.name.trim(), "Mẫu số 12.1B. Bảng giá dự thầu");
  const result = parseBidderGoodsWorkbookSheets(sheets, { pkg });
  assert.equal(result.headerRow, 4);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].phanLoId, "lot-1");
  assert.equal(result.rows[0].kyMaHieu, "K-01");
  assert.equal(result.rows[0].maHs, "0382.20");
  assert.equal(result.rows[0].namSanXuat, "Từ 2026 trở đi");
  assert.equal(Object.hasOwn(result.rows[0], "matHangDuThau"), false);
  assert.equal(Object.hasOwn(result.rows[0], "maHangHoa"), false);
  assert.equal(Object.hasOwn(result.rows[0], "phanNhom"), false);
});

test("parser handles case-insensitive sheet names, shifted headers, ignored rows, and unknown lots", () => {
  const pkg = {
    linhVuc: "Hàng hóa",
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "L01", tenPhanLo: "Phần 1" }],
  };
  const sheets = [{
    name: "  MẪU SỐ 12.1B. BẢNG GIÁ DỰ THẦU  ",
    rows: [
      ["Tiêu đề"], ["Phụ đề"], [], [], [], header,
      ["1", "L99", "Phần không tồn tại", "Hóa chất lạ", "", "", "", "K-99", "", "2026", "Việt Nam", "Hãng", "Thông số", "Hộp", "1", "001.20", "100", "100"],
      ["Số tiền bằng chữ: Một trăm đồng"],
      ["Ghi chú"],
      [],
    ],
  }];
  assert.equal(findBidderGoodsSheet(sheets), sheets[0]);
  const result = parseBidderGoodsWorkbookSheets(sheets, { pkg });
  assert.equal(result.headerRow, 6);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].phanLoId, null);
  assert.equal(result.rows[0].mappingStatus, "lot_not_found");
  assert.equal(result.rows[0].maHs, "001.20");
  assert.equal(result.skipped.length, 2);
  assert.throws(
    () => parseBidderGoodsWorkbookSheets([{ name: "Sheet1", rows: [] }], { pkg }),
    /Không tìm thấy Sheet/,
  );
});

test("mapping is unique and official validation reconciles line and bid totals", () => {
  const requirements = [
    { id: "required-1", phanLoId: null, tenHangHoa: "Hóa chất A", donViTinh: "Hộp", soLuong: 2, sortOrder: 0 },
  ];
  const rows = mapBidderGoodsRows([{ sttNguon: "1", phanLoId: null, danhMucHangHoa: "Hóa chất A", donViTinh: "Hộp", khoiLuong: 2, donGiaDuThau: 50, thanhTienDuThau: 100 }], requirements);
  assert.equal(rows[0].goiThauHangHoaId, "required-1");
  assert.equal(rows[0].mappingStatus, "matched");
  assert.deepEqual(validateBidderGoodsSubmission({ rows, requirements, bidPrice: 100 }).errors, []);
  assert.equal(validateBidderGoodsSubmission({ rows: [{ ...rows[0], thanhTienDuThau: 103 }], requirements, bidPrice: 103 }).valid, false);
});

test("mapping reports unmatched and duplicate manual assignments within a lot", () => {
  const requirements = [
    { id: "required-1", phanLoId: "lot-1", tenHangHoa: "Hóa chất A", donViTinh: "Hộp", soLuong: 2, sortOrder: 0 },
    { id: "required-2", phanLoId: "lot-1", tenHangHoa: "Hóa chất B", donViTinh: "Chai", soLuong: 1, sortOrder: 1 },
  ];
  const mapped = mapBidderGoodsRows([
    { id: "row-1", sttNguon: "1", phanLoId: "lot-1", danhMucHangHoa: "Không khớp", donViTinh: "Hộp", khoiLuong: 2 },
    { id: "row-2", sttNguon: "2", phanLoId: "lot-1", danhMucHangHoa: "Hóa chất B", donViTinh: "Chai", khoiLuong: 1 },
  ], requirements);
  assert.equal(mapped[0].mappingStatus, "unmatched");
  assert.equal(mapped[1].goiThauHangHoaId, "required-2");
  const duplicate = applyManualBidderGoodsMapping(mapped, "row-1", "required-2");
  assert.deepEqual(duplicate.map((row) => row.mappingStatus), ["duplicate", "duplicate"]);
});

test("financial validation accepts one-VND tolerance and rejects invalid amounts", () => {
  const valid = {
    danhMucHangHoa: "Hóa chất A",
    khoiLuong: 3,
    donGiaDuThau: 10,
    thanhTienDuThau: 31,
    mappingStatus: "matched",
  };
  assert.deepEqual(validateBidderGoodsRow(valid, { official: true }), []);
  assert.ok(validateBidderGoodsRow({ ...valid, thanhTienDuThau: 32 }).length > 0);
  assert.ok(validateBidderGoodsRow({ ...valid, khoiLuong: 0 }).length > 0);
  const negativePriceErrors = validateBidderGoodsRow({ ...valid, donGiaDuThau: -1 });
  assert.ok(negativePriceErrors.length > 0);
  assert.equal(negativePriceErrors.some((message) => message.includes("không âm")), false);
  assert.ok(validateBidderGoodsRow({ ...valid, thanhTienDuThau: Number.MAX_SAFE_INTEGER + 1 }).length > 0);
  assert.deepEqual(validateBidderGoodsRow({
    danhMucHangHoa: "Thiết bị giá trị lớn",
    khoiLuong: 1,
    donGiaDuThau: "9007199254740993000",
    thanhTienDuThau: "9007199254740993000",
    mappingStatus: "matched",
    maUuDai: 0,
  }, { official: true }), []);
});

test("manual bidder unit-price input accepts digits only", () => {
  assert.equal(sanitizeBidderGoodsMoneyInput("1250000"), "1250000");
  assert.equal(sanitizeBidderGoodsMoneyInput("1.250.000"), "1250000");
  assert.equal(sanitizeBidderGoodsMoneyInput(""), "");
  assert.equal(sanitizeBidderGoodsMoneyInput("-1"), "");
  assert.equal(sanitizeBidderGoodsMoneyInput("1e3"), "");
  assert.equal(sanitizeBidderGoodsMoneyInput("12.5"), "");
});

test("bidder unit price formats Vietnamese thousands and preserves the typing caret", () => {
  assert.equal(formatBidderGoodsMoneyInput("1250000"), "1.250.000");
  assert.deepEqual(formatBidderGoodsMoneyEdit("1111", 4), {
    digits: "1111",
    formatted: "1.111",
    caret: 5,
  });
  assert.deepEqual(formatBidderGoodsMoneyEdit("1.1111", 6), {
    digits: "11111",
    formatted: "11.111",
    caret: 6,
  });
  assert.deepEqual(formatBidderGoodsMoneyEdit("11.1111", 7), {
    digits: "111111",
    formatted: "111.111",
    caret: 7,
  });
});

test("each bidder unit-price keystroke recalculates all four money columns without rendering", () => {
  const pkg = { id: "package-1", phanLo: "Không", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: 199998, tyLeGiamGia: 0 };
  const requirement = { id: "required-1", goiThauId: pkg.id, phanLoId: null };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    goiThauHangHoaId: requirement.id,
    danhMucHangHoa: "Hóa chất A",
    khoiLuong: 18,
    donGiaDuThau: null,
    thanhTienDuThau: null,
    mappingStatus: "matched",
    maUuDai: 1,
  };
  let renderCount = 0;
  const controller = {
    model: {
      state: {
        goithauhanghoa: [requirement],
        hanghoaduthaunhathau: [row],
      },
    },
    renderDetailedEvaluation() { renderCount += 1; },
  };

  for (const [digits, expectedTotal] of [
    ["1", "18"],
    ["11", "198"],
    ["111", "1998"],
    ["1111", "19998"],
    ["11111", "199998"],
  ]) {
    const realtime = applyBidderGoodsUnitPriceInput(
      controller, { pkg, bid }, row.id, digits,
    );
    const preview = realtime.row;
    assert.equal(String(preview.donGiaDuThau), digits);
    assert.equal(preview.thanhTienDuThau, expectedTotal);
    assert.equal(preview.giaDuThauSauUuDai, digits);
    assert.equal(preview.thanhTienSauUuDai, expectedTotal);
  }
  assert.equal(renderCount, 0);
  assert.equal(controller._detailedEvaluationDirty, true);
  assert.equal(bid.trangThaiTinhUuDai, "draft");
});

test("realtime preference preview remains available while another scope row is incomplete", () => {
  const pkg = { id: "package-1", phanLo: "Không", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: 18, tyLeGiamGia: 0 };
  const requirements = [
    { id: "required-1", goiThauId: pkg.id, phanLoId: null },
    { id: "required-2", goiThauId: pkg.id, phanLoId: null },
  ];
  const controller = {
    model: {
      state: {
        goithauhanghoa: requirements,
        hanghoaduthaunhathau: [
          {
            id: "offered-1", goiThauId: pkg.id, thongTinMoThauId: bid.id,
            goiThauHangHoaId: "required-1", danhMucHangHoa: "A",
            khoiLuong: 18, donGiaDuThau: null, mappingStatus: "matched", maUuDai: 1,
          },
          {
            id: "offered-2", goiThauId: pkg.id, thongTinMoThauId: bid.id,
            goiThauHangHoaId: "required-2", danhMucHangHoa: "B",
            khoiLuong: 1, donGiaDuThau: null, mappingStatus: "matched", maUuDai: 5,
          },
        ],
      },
    },
  };

  const realtime = applyBidderGoodsUnitPriceInput(
    controller, { pkg, bid }, "offered-1", "1",
  );
  const preview = realtime.row;
  assert.equal(preview.thanhTienDuThau, "18");
  assert.equal(preview.giaDuThauSauUuDai, "1.075");
  assert.equal(preview.thanhTienSauUuDai, "19");
});

test("bidder-goods summary presentation recalculates total and bid-price difference", () => {
  assert.deepEqual(bidderGoodsSummaryPresentation({
    rows: [{ id: "offered-1" }],
    summary: {
      total: 200000016,
      difference: 16,
      invalidRows: 0,
      matchesBidPrice: false,
    },
  }), {
    totalLabel: "200.000.016 đ",
    differenceLabel: "Chênh lệch +16 đ",
    comparisonClass: "text-warning",
  });
});

test("preference code changes immediately without confirmation or reason dialog", () => {
  const updated = updateBidderGoodsPreferenceCode([{
    id: "offered-1",
    maUuDai: 1,
    uuDaiSourceSheet: "Mẫu 15A",
    uuDaiManualReason: "Lý do cũ",
    preferenceWarnings: [{ message: "Cảnh báo cũ" }],
  }], "offered-1", 4, {
    actorId: "user-1",
    updatedAt: "2026-07-30T00:00:00.000Z",
  })[0];
  assert.equal(updated.maUuDai, 4);
  assert.equal(updated.uuDaiMatchStatus, "matched");
  assert.equal(updated.uuDaiManualOverride, true);
  assert.equal(updated.uuDaiManualActorId, "user-1");
  assert.equal(updated.uuDaiManualUpdatedAt, "2026-07-30T00:00:00.000Z");
  assert.equal(updated.uuDaiManualReason, "");
  assert.deepEqual(updated.preferenceWarnings, []);

  const workflowSource = fs.readFileSync(
    new URL("../../frontend/packages/BidderGoodsWorkflow.js", import.meta.url),
    "utf8",
  );
  const handler = workflowSource.slice(
    workflowSource.indexOf('root.querySelectorAll("[data-bidder-goods-preference]")'),
    workflowSource.indexOf('root.querySelectorAll("[data-bidder-goods-nonnegative-money]")'),
  );
  assert.doesNotMatch(handler, /customConfirm|customPrompt/);
});

test("line total is derived exactly from quantity and unit price", () => {
  assert.equal(deriveBidderGoodsLineTotal({ khoiLuong: "2,5", donGiaDuThau: "13" }), "33");
  assert.equal(deriveBidderGoodsLineTotal({ khoiLuong: "0.5", donGiaDuThau: "13" }), "7");
  assert.equal(
    deriveBidderGoodsLineTotal({ khoiLuong: "2", donGiaDuThau: "9007199254740993000" }),
    "18014398509481986000",
  );
  assert.equal(deriveBidderGoodsLineTotal({ khoiLuong: "", donGiaDuThau: "13" }), null);
  const derived = withDerivedBidderGoodsFinancials({
    khoiLuong: 2,
    donGiaDuThau: 50,
    thanhTienDuThau: 999,
    giaDuThauSauUuDai: "500",
    thanhTienSauUuDai: "1000",
  });
  assert.equal(derived.thanhTienDuThau, "100");
  assert.equal(derived.giaDuThauSauUuDai, null);
  assert.equal(derived.thanhTienSauUuDai, null);
});

test("bidder goods panel derives totals and preference values without editable result fields", () => {
  const pkg = { id: "package-1", tenGoiThau: "Gói thử", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: "100", tyLeGiamGia: 0 };
  const requirement = { id: "required-1", goiThauId: pkg.id, phanLoId: null, tenHangHoa: "Hóa chất A" };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    phanLoId: null,
    goiThauHangHoaId: requirement.id,
    sttNguon: "1",
    danhMucHangHoa: "Hóa chất A",
    khoiLuong: 2,
    donGiaDuThau: 50,
    thanhTienDuThau: 999,
    maUuDai: 0,
    mappingStatus: "matched",
  };
  const controller = {
    model: { state: { goithauhanghoa: [requirement], hanghoaduthaunhathau: [row] } },
  };

  const state = buildBidderGoodsPanelState(controller, {
    pkg,
    bid,
    roundType: "single",
    readOnly: false,
  });
  const calculated = state.pageRows[0];
  assert.equal(calculated.thanhTienDuThau, "100");
  assert.equal(calculated.giaDuThauSauUuDai, "50");
  assert.equal(calculated.thanhTienSauUuDai, "100");

  const markup = renderBidderGoodsPanelMarkup(state);
  assert.doesNotMatch(markup, /data-bidder-goods-field="thanhTienDuThau"/);
  assert.match(markup, /data-bidder-goods-derived="thanhTienDuThau"/);
  assert.match(markup, /data-bidder-goods-derived="giaDuThauSauUuDai"/);
  assert.match(markup, /data-bidder-goods-derived="thanhTienSauUuDai"/);
  assert.doesNotMatch(markup, /Nguồn:\s*(?:Không có 15A|15A|Thủ công)/);
  assert.match(markup, /data-bidder-goods-edit="offered-1"/);
  assert.doesNotMatch(markup, /data-bidder-goods-delete|data-bidder-goods-field="kyMaHieu"/);

  const editingMarkup = renderBidderGoodsPanelMarkup({ ...state, editingId: row.id });
  for (const field of ["kyMaHieu", "nhanHieu", "namSanXuat", "xuatXu", "hangSanXuat", "cauHinhTinhNangKyThuat", "maHs", "donGiaDuThau"]) {
    assert.match(editingMarkup, new RegExp(`data-bidder-goods-field="${field}"`));
  }
  for (const sourceField of ["sttNguon", "phanLoId", "danhMucHangHoa", "donViTinh", "khoiLuong"]) {
    assert.doesNotMatch(editingMarkup, new RegExp(`data-bidder-goods-field="${sourceField}"`));
  }
  const formattedMoneyMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    editingId: row.id,
    pageRows: [{ ...calculated, donGiaDuThau: 1_250_000 }],
  });
  assert.match(
    formattedMoneyMarkup,
    /type="text" inputmode="numeric"[^>]*data-bidder-goods-field="donGiaDuThau"[^>]*value="1\.250\.000"/,
  );
});

test("bidder goods panel defers aggregate price warnings and orders toolbar actions consistently", () => {
  const state = {
    pkg: { tenGoiThau: "GÃ³i thá»­", phanLo: "KhÃ´ng", phanLoList: [] },
    bid: { id: "opening-1", giaDuThau: 110, trangThaiTinhUuDai: "draft" },
    roundType: "single",
    lot: null,
    requirements: [{ id: "required-1" }],
    rows: [{
      id: "offered-1",
      danhMucHangHoa: "HÃ³a cháº¥t A",
      khoiLuong: 2,
      donGiaDuThau: 50,
      thanhTienDuThau: 100,
      goiThauHangHoaId: "required-1",
      mappingStatus: "matched",
      maUuDai: 0,
    }],
    pageRows: [],
    summary: {
      total: 100,
      difference: -10,
      matchesBidPrice: false,
      missing: [],
      unmatched: 0,
      duplicate: 0,
      invalidRows: 0,
    },
    preferenceCalculation: null,
    page: 1,
    pageCount: 1,
    filter: "",
    importPreview: null,
    readOnly: false,
    busy: "",
    error: "",
  };

  const markup = renderBidderGoodsPanelMarkup(state);
  assert.doesNotMatch(markup, /bidder-goods-total-warning/);
  assert.match(markup, /Lỗi cần xử lý[\s\S]*?>0<\/span>/);
  const searchIndex = markup.indexOf('id="bidder-goods-search"');
  const importIndex = markup.indexOf('id="btn-bidder-goods-import"');
  const exportIndex = markup.indexOf('id="btn-bidder-goods-export-menu"');
  const addIndex = markup.indexOf('id="btn-bidder-goods-add"');
  assert.ok(searchIndex < importIndex && importIndex < exportIndex && exportIndex < addIndex);
  assert.match(markup, /class="btn btn-primary" id="btn-bidder-goods-add"/);
  assert.match(markup, /btn-bidder-goods-add[^>]*>[\s\S]*?Thêm hàng hóa<\/button>/);

  const incompleteMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    rows: [{ ...state.rows[0], donGiaDuThau: null, thanhTienDuThau: null }],
    summary: { ...state.summary, total: 0, difference: -110, invalidRows: 1 },
  });
  assert.doesNotMatch(incompleteMarkup, /bidder-goods-total-warning/);

  const matchedMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    bid: { ...state.bid, giaDuThau: 100 },
    summary: { ...state.summary, difference: 0, matchesBidPrice: true },
  });
  assert.doesNotMatch(matchedMarkup, /bidder-goods-total-warning/);
});

test("official bidder-goods save shows a popup when the aggregate total differs", async () => {
  const pkg = { id: "package-1", phanLo: "Không", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: 110 };
  const requirement = { id: "required-1", goiThauId: pkg.id, phanLoId: null };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    goiThauHangHoaId: requirement.id,
    danhMucHangHoa: "Hóa chất A",
    khoiLuong: 2,
    donGiaDuThau: 50,
    thanhTienDuThau: 100,
    mappingStatus: "matched",
    maUuDai: 0,
  };
  const alerts = [];
  const controller = {
    model: { state: { goithauhanghoa: [requirement], hanghoaduthaunhathau: [row] } },
    view: {
      getActiveElement: () => null,
      customAlert: async (...args) => alerts.push(args),
    },
  };

  assert.equal(await saveBidderGoods(controller, { pkg, bid }, { official: true }), false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "Chưa thể lưu chính thức");
  assert.match(alerts[0][1], /Tổng thành tiền không khớp giá dự thầu/);
  assert.equal(alerts[0][2], "alert-triangle");
});

test("official bidder-goods save stages goods and their opening in one sync batch", async () => {
  const pkg = { id: "package-1", phanLo: "KhÃ´ng", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: 100, tyLeGiamGia: 0 };
  const requirement = { id: "required-1", goiThauId: pkg.id, phanLoId: null };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    goiThauHangHoaId: requirement.id,
    danhMucHangHoa: "HÃ³a cháº¥t A",
    khoiLuong: 2,
    donGiaDuThau: 50,
    thanhTienDuThau: 100,
    mappingStatus: "matched",
    maUuDai: 0,
  };
  const dirty = [];
  const persisted = [];
  const controller = {
    model: {
      state: {
        goithauhanghoa: [requirement],
        hanghoaduthaunhathau: [row],
        thongtinmothau: [bid],
      },
      markRecordDirty: async (table, records) => dirty.push([table, records]),
      persistData: async (table) => persisted.push(table),
      flushMutationOutbox: async () => {},
    },
    view: { getActiveElement: () => null, customAlert: async () => {} },
    autoSync: async () => ({ ok: true }),
    renderDetailedEvaluation() {},
  };

  assert.equal(await saveBidderGoods(controller, { pkg, bid }, { official: true }), true);
  assert.deepEqual(dirty.map(([table]) => table), [
    "hanghoaduthaunhathau",
    "thongtinmothau",
  ]);
  assert.equal(dirty[0][1][0].isDraft, false);
  assert.equal(dirty[1][1], bid);
  assert.equal(bid.trangThaiTinhUuDai, "ready");
  assert.deepEqual(persisted, ["hanghoaduthaunhathau", "thongtinmothau"]);
  assert.match(controller._bidderGoodsSavedAt, /^\d{2}:\d{2}$/);
});

test("post-preference unit price is derived from the offered item unit price, not the opening total", () => {
  const pkg = { id: "package-1", tenGoiThau: "Gói thử", phanLo: "Không", phanLoList: [] };
  const bid = {
    id: "opening-1",
    giaDuThau: "200000000",
    giaSauGiamGia: "200000000",
    tyLeGiamGia: 0,
  };
  const requirement = { id: "required-1", goiThauId: pkg.id, phanLoId: null, tenHangHoa: "Hóa chất A" };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    phanLoId: null,
    goiThauHangHoaId: requirement.id,
    sttNguon: "1",
    danhMucHangHoa: "Hóa chất A",
    khoiLuong: 18,
    donGiaDuThau: 1,
    thanhTienDuThau: 18,
    maUuDai: 0,
    mappingStatus: "matched",
  };
  const controller = {
    model: { state: { goithauhanghoa: [requirement], hanghoaduthaunhathau: [row] } },
  };

  const calculated = buildBidderGoodsPanelState(controller, {
    pkg,
    bid,
    roundType: "single",
    readOnly: false,
  }).pageRows[0];

  assert.equal(calculated.giaDuThauSauUuDai, "1");
  assert.equal(calculated.thanhTienSauUuDai, "18");
});

test("opening bidder goods seeds requirement basics once and leaves contractor fields editable", () => {
  const pkg = {
    id: "package-1",
    tenGoiThau: "Gói thử",
    phanLo: "Có",
    phanLoList: [{ id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lô 1" }],
  };
  const bid = { id: "opening-1", maPhanLo: "PL1", giaDuThau: "0" };
  const requirements = [
    { id: "required-1", goiThauId: pkg.id, phanLoId: "lot-1", tenHangHoa: "Hóa chất A", donViTinh: "Hộp", soLuong: 2, sortOrder: 0 },
    { id: "required-2", goiThauId: pkg.id, phanLoId: "lot-1", tenHangHoa: "Hóa chất B", donViTinh: "Chai", soLuong: 1.5, sortOrder: 1 },
  ];
  const controller = {
    model: { state: { goithauhanghoa: requirements, hanghoaduthaunhathau: [] } },
  };
  const detailedState = { pkg, bid, roundType: "single", readOnly: false };

  assert.equal(initializeBidderGoodsFromRequirements(controller, detailedState), 2);
  assert.equal(initializeBidderGoodsFromRequirements(controller, detailedState), 0);
  assert.equal(controller.model.state.hanghoaduthaunhathau.length, 2);
  assert.deepEqual(
    controller.model.state.hanghoaduthaunhathau.map((row) => row.mappingMethod),
    ["auto", "auto"],
  );
  assert.deepEqual(
    controller.model.state.hanghoaduthaunhathau.map((row) => ({
      stt: row.sttNguon,
      lotCode: row.maPhanLoNguon,
      lotName: row.tenPhanLoNguon,
      name: row.danhMucHangHoa,
      unit: row.donViTinh,
      quantity: row.khoiLuong,
      model: row.kyMaHieu,
      price: row.donGiaDuThau,
    })),
    [
      { stt: "1.1", lotCode: "PL1", lotName: "Lô 1", name: "Hóa chất A", unit: "Hộp", quantity: 2, model: "", price: null },
      { stt: "1.2", lotCode: "PL1", lotName: "Lô 1", name: "Hóa chất B", unit: "Chai", quantity: 1.5, model: "", price: null },
    ],
  );

  const state = buildBidderGoodsPanelState(controller, detailedState);
  const markup = renderBidderGoodsPanelMarkup(state);
  assert.doesNotMatch(markup, /data-bidder-goods-field="donViTinh"/);
  assert.doesNotMatch(markup, /data-bidder-goods-field="khoiLuong"/);
  assert.doesNotMatch(markup, /data-bidder-goods-field="kyMaHieu"/);
  assert.doesNotMatch(markup, /data-bidder-goods-field="donGiaDuThau"/);
  assert.doesNotMatch(markup, /data-bidder-goods-nonnegative-money/);
  assert.match(markup, /data-bidder-goods-edit=/);
  assert.match(markup, /<th>Mã phần \(lô\)<\/th><th>Tên phần lô<\/th>/);
  assert.match(markup, /class="bidder-goods-lot-row">[\s\S]*?<td>1<\/td>[\s\S]*?<td>PL1<\/td>[\s\S]*?<td>Lô 1<\/td>/);
  assert.doesNotMatch(markup, /has-validation-error|Vui lòng nhập đơn giá dự thầu hợp lệ|aria-invalid="true"/);

  const attemptedMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    validationAttempted: true,
    editingId: state.rows[0].id,
  });
  assert.match(attemptedMarkup, /data-bidder-goods-field="kyMaHieu"/);
  assert.match(attemptedMarkup, /data-bidder-goods-field="donGiaDuThau"[^>]*aria-invalid="true"/);
  assert.match(attemptedMarkup, /bidder-goods-field-error[^>]*>Vui lòng nhập đơn giá dự thầu hợp lệ\.<\/div>/);
});

test("saving invalid bidder goods focuses the first invalid field without a modal alert", async () => {
  const pkg = { id: "package-1", phanLo: "Không", phanLoList: [] };
  const bid = { id: "opening-1", giaDuThau: 100 };
  const requirement = {
    id: "required-1",
    goiThauId: pkg.id,
    phanLoId: null,
    tenHangHoa: "Hóa chất A",
    donViTinh: "Hộp",
    soLuong: 2,
  };
  const row = {
    id: "offered-1",
    goiThauId: pkg.id,
    thongTinMoThauId: bid.id,
    phanLoId: null,
    goiThauHangHoaId: requirement.id,
    danhMucHangHoa: requirement.tenHangHoa,
    donViTinh: requirement.donViTinh,
    khoiLuong: requirement.soLuong,
    donGiaDuThau: null,
    mappingStatus: "matched",
    maUuDai: 0,
  };
  const invalidControl = { id: "unit-price", focus() {} };
  let focusedControl = null;
  let renderCount = 0;
  let alertCount = 0;
  const root = {
    querySelector: (selector) => selector === '[aria-invalid="true"]' ? invalidControl : null,
    querySelectorAll: () => [],
  };
  const controller = {
    model: { state: { goithauhanghoa: [requirement], hanghoaduthaunhathau: [row] } },
    view: {
      getActiveElement: () => root,
      focusInvalidControl: (control) => { focusedControl = control; },
      customAlert: async () => { alertCount += 1; },
    },
    async renderDetailedEvaluation() { renderCount += 1; },
  };

  assert.equal(await saveBidderGoods(controller, { pkg, bid }, { official: true }), false);
  assert.equal(renderCount, 1);
  assert.equal(focusedControl, invalidControl);
  assert.equal(alertCount, 0);
  assert.equal(controller._bidderGoodsEditingId, row.id);
});

test("bidder-goods edit action opens only the selected row", async () => {
  const editButton = new EventTarget();
  editButton.getAttribute = (name) => name === "data-bidder-goods-edit" ? "offered-1" : null;
  const root = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "[data-bidder-goods-edit]" ? [editButton] : [],
    addEventListener() {},
  };
  let renderCount = 0;
  const controller = {
    model: {
      state: {
        goithauhanghoa: [{ id: "required-1", goiThauId: "package-1", phanLoId: null }],
        hanghoaduthaunhathau: [{
          id: "offered-1",
          goiThauId: "package-1",
          thongTinMoThauId: "opening-1",
          goiThauHangHoaId: "required-1",
          danhMucHangHoa: "Hóa chất A",
          khoiLuong: 1,
          donGiaDuThau: 1,
          mappingStatus: "matched",
          maUuDai: 0,
        }],
      },
    },
    view: { getActiveElement: () => root, createIconsScoped() {} },
    async renderDetailedEvaluation() { renderCount += 1; },
  };
  bindBidderGoodsPanel(controller, {
    pkg: { id: "package-1", phanLo: "Không", phanLoList: [] },
    bid: { id: "opening-1", giaDuThau: 1 },
    readOnly: false,
    roundType: "single",
  }, root);

  editButton.dispatchEvent(new Event("click"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller._bidderGoodsEditingId, "offered-1");
  assert.equal(renderCount, 1);
});

test("goods tab is limited to goods packages and financial contexts", () => {
  const goods = { linhVuc: "Hàng hóa" };
  const mixed = { linhVuc: " Hỗn hợp " };
  assert.equal(shouldShowBidderGoodsTab(goods, "single"), true);
  assert.equal(shouldShowBidderGoodsTab(goods, "financial", { id: "bid-1" }), true);
  assert.equal(shouldShowBidderGoodsTab(goods, "technical", { id: "bid-1" }), false);
  assert.equal(shouldShowBidderGoodsTab(mixed, "single"), true);
  assert.equal(shouldShowBidderGoodsTab(mixed, "financial", { id: "bid-1" }), true);
  assert.equal(shouldShowBidderGoodsTab(mixed, "technical", { id: "bid-1" }), false);
  assert.equal(shouldShowBidderGoodsTab({ linhVuc: "Xây lắp" }, "single"), false);
  const panelSource = fs.readFileSync(
    new URL("../../frontend/packages/detail/DetailedEvaluationPanel.js", import.meta.url),
    "utf8",
  );
  assert.match(panelSource, /bidder_goods:\s*"Danh mục hàng hóa dự thầu"/);
});

test("bidder goods gate applies to 1G1T and 1G2T financial completion only", () => {
  const goods = { pkg: { linhVuc: "Hàng hóa" } };
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "single" }, true), true);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "financial" }, true), true);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "technical" }, true), false);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "financial" }, false), false);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ pkg: { linhVuc: "Xây lắp" }, roundType: "single" }, true), false);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ pkg: { linhVuc: "Hỗn hợp" }, roundType: "single" }, true), true);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ pkg: { linhVuc: "Hỗn hợp" }, roundType: "financial" }, true), true);
});

test("read-only panel hides mutation actions and exposes loading and error states", () => {
  const row = {
    id: "offered-1",
    sttNguon: "1",
    danhMucHangHoa: "Hóa chất A",
    donViTinh: "Hộp",
    khoiLuong: 2,
    donGiaDuThau: 50,
    thanhTienDuThau: 100,
    goiThauHangHoaId: "required-1",
    mappingStatus: "matched",
  };
  const state = {
    pkg: { tenGoiThau: "Gói thử", phanLo: "Không" },
    bid: { id: "opening-1", giaDuThau: 100 },
    roundType: "single",
    lot: null,
    requirements: [{ id: "required-1", tenHangHoa: "Hóa chất A", phanLoId: null }],
    rows: [row],
    pageRows: [row],
    summary: { total: 100, difference: 0, missing: [], unmatched: 0, duplicate: 0, invalidRows: 0 },
    page: 1,
    pageCount: 1,
    filter: "",
    importPreview: null,
    readOnly: true,
    busy: "",
    error: "",
  };
  const readOnlyMarkup = renderBidderGoodsPanelMarkup(state);
  assert.equal(readOnlyMarkup.includes("btn-bidder-goods-import"), false);
  assert.equal(readOnlyMarkup.includes("btn-bidder-goods-add"), false);
  assert.equal(readOnlyMarkup.includes("btn-bidder-goods-save-official"), false);
  assert.equal(readOnlyMarkup.includes("data-bidder-goods-delete"), false);
  assert.equal(readOnlyMarkup.includes("data-bidder-goods-open-mapping"), false);

  const busyMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    readOnly: false,
    busy: "import",
    error: "File thử không hợp lệ.",
  });
  assert.match(busyMarkup, /aria-busy="true"/);
  assert.match(busyMarkup, /Đang đọc và kiểm tra file Excel/);
  assert.match(busyMarkup, /File thử không hợp lệ/);
  assert.match(busyMarkup, /id="btn-bidder-goods-import" disabled/);
  assert.doesNotMatch(busyMarkup, /bidder-goods-import-mode/);
  assert.doesNotMatch(busyMarkup, /Khi nhập trùng/);
  assert.match(busyMarkup, /class="pagination-container bidder-goods-pagination"/);
  assert.match(busyMarkup, /id="btn-bidder-goods-save-draft"><i data-lucide="save"/);

  const unresolvedRow = { ...row, mappingStatus: "unmatched", goiThauHangHoaId: null };
  const unresolvedMarkup = renderBidderGoodsPanelMarkup({
    ...state,
    readOnly: false,
    rows: [unresolvedRow],
    pageRows: [unresolvedRow],
  });
  assert.doesNotMatch(unresolvedMarkup, /<th>Trạng thái ghép<\/th>/);
  assert.match(unresolvedMarkup, /data-bidder-goods-open-mapping/);
  assert.doesNotMatch(unresolvedMarkup, /data-bidder-goods-mapping(?:\s|=)/);

  const modalMarkup = buildBidderGoodsMappingModalMarkup(unresolvedRow, state.requirements);
  assert.match(modalMarkup, /Đối chiếu danh mục yêu cầu/);
  assert.match(modalMarkup, /id="bidder-goods-mapping-choice"/);
  assert.match(modalMarkup, /value="required-1"/);
});

test("realtime goods search preserves typed text and waits for Vietnamese IME composition", async () => {
  const search = new EventTarget();
  Object.assign(search, {
    value: "Hóa chất ",
    selectionStart: 9,
    focus() {},
    setSelectionRange() {},
  });
  const root = {
    querySelector: (selector) => selector === "#bidder-goods-search" ? search : null,
    querySelectorAll: () => [],
  };
  let renderCount = 0;
  const controller = {
    _bidderGoodsSearch: "",
    model: { state: { goithauhanghoa: [], hanghoaduthaunhathau: [] } },
    view: {
      getActiveElement: () => root,
      createIconsScoped() {},
    },
    async renderDetailedEvaluation() { renderCount += 1; },
  };
  const detailedState = {
    pkg: { id: "package-1", phanLoList: [] },
    bid: { id: "opening-1" },
    roundType: "single",
    readOnly: false,
  };

  const panelState = buildBidderGoodsPanelState(controller, detailedState);
  assert.equal(panelState.filter, "");
  bindBidderGoodsPanel(controller, detailedState, root);

  const composingInput = new Event("input");
  Object.defineProperty(composingInput, "isComposing", { value: true });
  search.dispatchEvent(composingInput);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderCount, 0);
  assert.equal(controller._bidderGoodsSearch, "");

  search.dispatchEvent(new Event("compositionend"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderCount, 1);
  assert.equal(controller._bidderGoodsSearch, "Hóa chất ");
  assert.equal(buildBidderGoodsPanelState(controller, detailedState).filter, "Hóa chất ");
});

test("Excel import always replaces incoming bid scopes without a replacement prompt", async () => {
  const existing = [
    { id: "old-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-1", sttNguon: "1" },
    { id: "old-b", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-2", sttNguon: "2" },
    { id: "other", thongTinMoThauId: "opening-2", goiThauHangHoaId: "required-3", sttNguon: "1" },
  ];
  let confirmCalls = 0;
  const controller = {
    _bidderGoodsImportPreview: {
      // A stale caller may still provide the former mode; Excel remains authoritative.
      mode: "merge",
      rows: [
        { id: "new-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-1", sttNguon: "1", rowVersion: 99 },
      ],
    },
    model: { state: { hanghoaduthaunhathau: existing.map((row) => ({ ...row })) } },
    view: {
      customAlert: async () => {},
      customConfirm: async () => { confirmCalls += 1; return false; },
    },
    renderDetailedEvaluation() {},
  };
  assert.equal(await confirmBidderGoodsImport(controller), true);
  assert.deepEqual(
    controller.model.state.hanghoaduthaunhathau.map((row) => row.id).sort(),
    ["old-a", "other"],
  );
  assert.equal(confirmCalls, 0);

  controller._bidderGoodsImportPreview = {
    mode: "replace",
    rows: [
      { id: "replacement", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-4", sttNguon: "4" },
    ],
  };
  assert.equal(await confirmBidderGoodsImport(controller), true);
  assert.deepEqual(
    controller.model.state.hanghoaduthaunhathau.map((row) => row.id).sort(),
    ["other", "replacement"],
  );
  assert.equal(confirmCalls, 0);
});


test("failed bidder-goods persistence restores the pre-import snapshot", async () => {
  const original = [
    { id: "old-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-1" },
  ];
  const controller = {
    _bidderGoodsImportPreview: {
      mode: "merge",
      rows: [
        { id: "new-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-2" },
      ],
    },
    model: {
      state: {
        hanghoaduthaunhathau: original.map((row) => ({ ...row })),
        thongtinmothau: [{ id: "opening-1", trangThaiTinhUuDai: "ready" }],
      },
      async persistData() {},
    },
    async autoSync() { return { ok: false }; },
    view: { customAlert: async () => {} },
    renderDetailedEvaluation() {},
  };

  assert.equal(await confirmBidderGoodsImport(controller), false);
  assert.deepEqual(controller.model.state.hanghoaduthaunhathau, original);
  assert.equal(controller.model.state.thongtinmothau[0].trangThaiTinhUuDai, "ready");
});

test("Excel exports neutralize formula injection", () => {
  assert.equal(escapeSpreadsheetFormula("=1+1"), "'=1+1");
  assert.equal(escapeSpreadsheetFormula("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(escapeSpreadsheetFormula("Hàng hóa"), "Hàng hóa");
});

test("Excel template pre-fills required goods and lot context", () => {
  const rows = buildBidderGoodsTemplateRows({
    phanLoList: [{ id: "lot-1", maPhanLo: "L01", tenPhanLo: "Phần 1" }],
  }, [{
    phanLoId: "lot-1",
    tenHangHoa: "Hóa chất A",
    donViTinh: "Hộp",
    soLuong: 2,
  }]);
  assert.deepEqual(rows, [{
    sttNguon: "1",
    maPhanLoNguon: "L01",
    tenPhanLoNguon: "Phần 1",
    danhMucHangHoa: "Hóa chất A",
    donViTinh: "Hộp",
    khoiLuong: 2,
  }]);
});

test("persistence waits for bidder-goods mutations to enter the outbox", async () => {
  let releaseDirty;
  const dirtyQueued = new Promise((resolve) => { releaseDirty = resolve; });
  const model = {
    db: {
      getTableData: async () => [{ id: "offered-1", isDraft: true }],
    },
    state: {
      hanghoaduthaunhathau: [{ id: "offered-1", isDraft: false }],
    },
    markRecordDirty: () => dirtyQueued,
    markDeleted: () => Promise.resolve(),
  };
  let completed = false;
  const pending = BiddingModel.prototype.trackDeletions
    .call(model, "hanghoaduthaunhathau")
    .then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  releaseDirty();
  await pending;
  assert.equal(completed, true);
});

test("15A parser recognizes aliases, dynamic headers, booleans and expected preference codes", () => {
  const sheets = [{ name: "Mẫu 15C. Chi phí trong nước", rows: [] }, {
    name: " Mẫu số 15A.  Bảng kê khai hàng hóa được hưởng ưu đãi ",
    rows: [
      ["Tiêu đề"],
      ["STT", "Tên hàng hóa", "Xuất xứ", "Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước dưới 50%", "Từ 50% trở lên", "Cơ sở có từ 50% lao động ưu tiên", "Sản phẩm đổi mới sáng tạo"],
      [1, "Hàng A", "Việt Nam", "Có", "Không", "Không", "Không"],
      [2, "Hàng B", "Nhập khẩu", 0, 0, 0, false],
      [3, "Hàng C", "Việt Nam", "X", "N", "N", "N"],
      [4, "Hàng D", "Việt Nam", true, false, false, false],
    ],
  }, {
    name: "Mẫu số 12.1B. Bảng giá dự thầu",
    rows: [["STT", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      [1, "Hàng A", "Cái", 1, 10, 10], [2, "Hàng B", "Cái", 1, 20, 20],
      [3, "Hàng C", "Cái", 1, 30, 30], [4, "Hàng D", "Cái", 1, 40, 40]],
  }];
  assert.match(findGoodsPreferenceSheet(sheets).name, /15A/);
  assert.equal(parseGoodsPreferenceBoolean("Có"), true);
  assert.equal(parseGoodsPreferenceBoolean("Khong"), false);
  assert.equal(parseGoodsPreferenceBoolean(""), null);
  const parsed = parseBidderGoodsWorkbookSheets(sheets, { pkg: { phanLo: "Không" } });
  assert.deepEqual(parsed.rows.map((row) => row.maUuDai), [1, 0, 1, 1]);
  const without15A = parseBidderGoodsWorkbookSheets(sheets.filter((sheet) => !sheet.name.includes("15A")), { pkg: { phanLo: "Không" } });
  assert.deepEqual(without15A.rows.map((row) => row.maUuDai), [0, 0, 0, 0]);
  assert.match(without15A.preferenceNotice, /Không có Mẫu số 15A/);
});

test("generated minimal XLSX fixture round-trips expected [1,0,1,1] codes", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["STT", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
    [1, "Hàng A", "Cái", 1, 10, 10],
    [2, "Hàng B", "Cái", 1, 20, 20],
    [3, "Hàng C", "Cái", 1, 30, 30],
    [4, "Hàng D", "Cái", 1, 40, 40],
  ]), "Mẫu số 12.1B. Bảng giá");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["STT", "Tên hàng hóa", "Xuất xứ", "Hàng hóa có xuất xứ Việt Nam, tỷ lệ chi phí sản xuất trong nước dưới 50%", "Từ 50% trở lên", "Cơ sở có từ 50% lao động ưu tiên", "Sản phẩm đổi mới sáng tạo"],
    [1, "Hàng A", "Việt Nam", "Có", "Không", "Không", "Không"],
    [2, "Hàng B", "Nhập khẩu", "Không", "Không", "Không", "Không"],
    [3, "Hàng C", "Việt Nam", "X", "0", "0", "0"],
    [4, "Hàng D", "Việt Nam", true, false, false, false],
  ]), "Mẫu số 15A. Bảng kê khai HH");
  const roundTrip = XLSX.read(XLSX.write(workbook, {
    type: "buffer",
    bookType: "xlsx",
  }), { type: "buffer" });
  const sheets = roundTrip.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(roundTrip.Sheets[name], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: true,
    }),
  }));
  const parsed = parseBidderGoodsWorkbookSheets(sheets, {
    pkg: { phanLo: "Không" },
  });
  assert.deepEqual(parsed.rows.map((row) => row.maUuDai), [1, 0, 1, 1]);
});

test("15A mapping does not auto-commit duplicate names across lots without lot scope", () => {
  const sheets = [{
    name: "Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi",
    rows: [
      ["Tên hàng hóa", "Dưới 50% xuất xứ Việt Nam"],
      ["Hàng trùng", "Có"],
      ["Hàng trùng", "Không"],
    ],
  }, {
    name: "Mẫu số 12.1B. Bảng giá dự thầu",
    rows: [
      ["STT", "Mã phần lô", "Tên phần lô", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      [1, "L1", "Lô 1", "Hàng trùng", "Cái", 1, 10, 10],
      [2, "L2", "Lô 2", "Hàng trùng", "Cái", 1, 20, 20],
    ],
  }];
  const parsed = parseBidderGoodsWorkbookSheets(sheets, {
    pkg: {
      phanLo: "Có",
      phanLoList: [
        { id: "lot-1", maPhanLo: "L1", tenPhanLo: "Lô 1" },
        { id: "lot-2", maPhanLo: "L2", tenPhanLo: "Lô 2" },
      ],
    },
  });
  assert.deepEqual(parsed.rows.map((row) => row.uuDaiMatchStatus), ["ambiguous", "ambiguous"]);
  assert.ok(parsed.rows.every((row) => row.preferenceWarnings[0].code === "PREFERENCE_MAPPING_AMBIGUOUS"));
});

test("15A parser resolves merged multi-row headers away from row 4", () => {
  const sheets = [{
    name: "Mẫu số 15A. Bảng kê khai hàng hóa được hưởng ưu đãi",
    merges: [{ s: { r: 0, c: 3 }, e: { r: 0, c: 4 } }],
    rows: [
      ["STT", "Tên hàng hóa", "Xuất xứ", "Hàng hóa có xuất xứ Việt Nam", "", "Cơ sở có từ 50% lao động ưu tiên", "Sản phẩm đổi mới sáng tạo"],
      ["", "", "", "Tỷ lệ trong nước dưới 50%", "Từ 50% trở lên", "", ""],
      [1, "Thiết bị A", "Việt Nam", "Có", "Không", "Không", "Không"],
    ],
  }, {
    name: "Mẫu số 12.1B. Bảng giá dự thầu",
    rows: [
      ["STT", "Danh mục hàng hóa", "Đơn vị tính", "Khối lượng", "Đơn giá dự thầu", "Thành tiền"],
      [1, "Thiết bị A", "Cái", 1, 10, 10],
    ],
  }];
  const parsed = parseBidderGoodsWorkbookSheets(sheets, { pkg: { phanLo: "Không" } });
  assert.equal(parsed.preferenceHeaderRow, 1);
  assert.equal(parsed.rows[0].maUuDai, 1);
});

test("preference calculator uses item prices, rate differences and HALF_UP", () => {
  const result = calculateBidderGoodsPreference([
    { id: "a", sortOrder: 0, khoiLuong: 1, thanhTienDuThau: "50", maUuDai: 0 },
    { id: "b", sortOrder: 1, khoiLuong: 1, thanhTienDuThau: "50", maUuDai: 5 },
  ], { scopeAfterDiscount: "99" });
  assert.equal(result.heSoUuDaiCaoNhatBp, 1500);
  assert.deepEqual(result.lines.map((row) => row.heSoCongUuDaiBp), [1500, 0]);
  assert.equal(result.lines.reduce((sum, row) => sum + BigInt(row.giaTriCoSoSauGiamGia), 0n), 100n);
  assert.equal(result.tongGiaTriCongUuDai, "8");
  const large = calculateBidderGoodsPreference([
    { id: "large", khoiLuong: 1, thanhTienDuThau: "9007199254740993000", maUuDai: 0 },
    { id: "preferred", khoiLuong: 1, thanhTienDuThau: "1", maUuDai: 1 },
  ]);
  assert.ok(BigInt(large.giaSoSanhSauUuDai) > 9007199254740993000n);
  const fractionalDiscount = calculateBidderGoodsPreference([
    { id: "fractional", khoiLuong: 1, thanhTienDuThau: "10000", maUuDai: 0 },
  ], { discountRatePercent: "7.1234" });
  assert.equal(fractionalDiscount.tongSauGiamGia, "9288");
});

test("frontend calculator matches every shared backend preference vector", () => {
  for (const vector of sharedPreferenceVectors) {
    const result = calculateBidderGoodsPreference(vector.codes.map((code, index) => ({
      id: `${vector.name}-${index}`,
      khoiLuong: 1,
      thanhTienDuThau: "100",
      maUuDai: code,
    })));
    assert.equal(result.heSoUuDaiCaoNhatBp, vector.maximumRateBp, vector.name);
    assert.deepEqual(
      result.lines.map((line) => line.heSoCongUuDaiBp),
      vector.surchargeRatesBp,
      vector.name,
    );
  }
});

test("goods detailed-evaluation groups are ordered and unlocked only by persisted pass/ready state", () => {
  const context = resolveDetailedEvaluationContext({ linhVuc: "Hàng hóa" }, "single");
  assert.deepEqual(context.configuredGroups, ["validity", "capacity", "technical", "bidder_goods", "financial"]);
  assert.deepEqual(resolveAccessibleDetailedEvaluationGroups({ configuredGroups: context.configuredGroups }), ["validity"]);
  const report = { extension: { completedGroups: ["validity", "capacity", "technical"], groupResults: { validity: "Đạt", capacity: "Đạt", technical: "Đạt" } } };
  assert.deepEqual(resolveAccessibleDetailedEvaluationGroups({ configuredGroups: context.configuredGroups, report, bidderGoodsReady: false }), ["validity", "capacity", "technical", "bidder_goods"]);
  assert.deepEqual(resolveAccessibleDetailedEvaluationGroups({ configuredGroups: context.configuredGroups, report, bidderGoodsReady: true }), context.configuredGroups);
  assert.deepEqual(resolveDetailedEvaluationContext({ linhVuc: "Hàng hóa" }, "financial").configuredGroups, ["bidder_goods", "financial"]);
  assert.deepEqual(resolveDetailedEvaluationContext({ linhVuc: "Hỗn hợp" }, "single").configuredGroups, ["validity", "capacity", "technical", "bidder_goods", "financial"]);
  assert.deepEqual(resolveDetailedEvaluationContext({ linhVuc: "Hỗn hợp" }, "financial").configuredGroups, ["bidder_goods", "financial"]);
  assert.equal(resolveDetailedEvaluationContext({ linhVuc: "Hỗn hợp" }, "technical").configuredGroups.includes("bidder_goods"), false);
});

test("goods rankings require ready preference data and use authoritative post-preference prices", () => {
  const pkg = { linhVuc: "Hàng hóa", phuongPhapDanhGia: "Giá thấp nhất", phanLo: "Không" };
  const qualified = { danhGiaKetLuan: "Đạt" };
  const bids = [
    { id: "a", ...qualified, giaDuThau: 90, giaSoSanhSauUuDai: 120, trangThaiTinhUuDai: "ready" },
    { id: "b", ...qualified, giaDuThau: 100, giaSoSanhSauUuDai: 110, trangThaiTinhUuDai: "ready" },
    { id: "draft", ...qualified, giaDuThau: 1, trangThaiTinhUuDai: "draft" },
  ];
  assert.deepEqual(calculateRankings(pkg, bids).rankings, { b: 1, a: 2 });
  assert.equal(
    goodsPreferenceRankingBlockReason(pkg, bids[2]),
    "Chưa đủ dữ liệu ưu đãi để xếp hạng",
  );
  assert.equal(goodsPreferenceRankingBlockReason(pkg, bids[0]), "");
  const mixed = { ...pkg, linhVuc: "Hỗn hợp" };
  assert.deepEqual(calculateRankings(mixed, bids).rankings, { b: 1, a: 2 });
  assert.equal(goodsPreferenceRankingBlockReason(mixed, bids[2]), "Chưa đủ dữ liệu ưu đãi để xếp hạng");
});
