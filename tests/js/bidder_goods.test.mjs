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
  confirmBidderGoodsImport,
  renderBidderGoodsPanelMarkup,
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
  assert.ok(validateBidderGoodsRow({ ...valid, donGiaDuThau: -1 }).length > 0);
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

test("goods tab is limited to goods packages and financial contexts", () => {
  const goods = { linhVuc: "Hàng hóa" };
  assert.equal(shouldShowBidderGoodsTab(goods, "single"), true);
  assert.equal(shouldShowBidderGoodsTab(goods, "financial", { id: "bid-1" }), true);
  assert.equal(shouldShowBidderGoodsTab(goods, "technical", { id: "bid-1" }), false);
  assert.equal(shouldShowBidderGoodsTab({ linhVuc: "Xây lắp" }, "single"), false);
});

test("bidder goods gate applies to 1G1T and 1G2T financial completion only", () => {
  const goods = { pkg: { linhVuc: "Hàng hóa" } };
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "single" }, true), true);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "financial" }, true), true);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "technical" }, true), false);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ ...goods, roundType: "financial" }, false), false);
  assert.equal(shouldValidateBidderGoodsOnCompletion({ pkg: { linhVuc: "Xây lắp" }, roundType: "single" }, true), false);
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
  assert.match(readOnlyMarkup, /data-bidder-goods-mapping disabled/);

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
});

test("merge and replace imports preserve IDs and only replace incoming bid scopes", async () => {
  const existing = [
    { id: "old-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-1", sttNguon: "1" },
    { id: "old-b", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-2", sttNguon: "2" },
    { id: "other", thongTinMoThauId: "opening-2", goiThauHangHoaId: "required-3", sttNguon: "1" },
  ];
  const controller = {
    _bidderGoodsImportPreview: {
      mode: "merge",
      rows: [
        { id: "new-a", thongTinMoThauId: "opening-1", goiThauHangHoaId: "required-1", sttNguon: "1", rowVersion: 99 },
      ],
    },
    model: { state: { hanghoaduthaunhathau: existing.map((row) => ({ ...row })) } },
    view: {
      customAlert: async () => {},
      customConfirm: async () => true,
    },
    renderDetailedEvaluation() {},
  };
  assert.equal(await confirmBidderGoodsImport(controller), true);
  assert.deepEqual(
    controller.model.state.hanghoaduthaunhathau.map((row) => row.id).sort(),
    ["old-a", "old-b", "other"],
  );

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

test("preference calculator uses rate differences, HALF_UP and stable remainder allocation", () => {
  const result = calculateBidderGoodsPreference([
    { id: "a", sortOrder: 0, khoiLuong: 1, thanhTienDuThau: "50", maUuDai: 0 },
    { id: "b", sortOrder: 1, khoiLuong: 1, thanhTienDuThau: "50", maUuDai: 5 },
  ], { scopeAfterDiscount: "99" });
  assert.equal(result.heSoUuDaiCaoNhatBp, 1500);
  assert.deepEqual(result.lines.map((row) => row.heSoCongUuDaiBp), [1500, 0]);
  assert.equal(result.lines.reduce((sum, row) => sum + BigInt(row.giaTriCoSoSauGiamGia), 0n), 99n);
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
});
