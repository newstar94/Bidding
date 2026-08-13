import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hasWinningGoodsExportScope,
  selectWinningGoodsForExport,
  winningUnitPrice,
} from "../../frontend/packages/winningGoodsSelectors.js";
import {
  buildWinningGoodsWorkbook,
  downloadOfficialWinningGoodsWorkbook,
  WINNING_GOODS_HEADERS,
} from "../../frontend/packages/WinningGoodsExcel.js";

const require = createRequire(import.meta.url);
const sheetModule = { exports: {} };
Function("module", "exports", "require", fs.readFileSync(
  new URL("../../views/vendor/xlsx/xlsx.full.min.js", import.meta.url),
  "utf8",
))(sheetModule, sheetModule.exports, require);
const XLSX = Object.keys(sheetModule.exports).length ? sheetModule.exports : sheetModule.exports;

const packageBase = {
  id: "package-1",
  maGoiThau: "IB260001",
  tenGoiThau: "Gói thiết bị",
  linhVuc: "Hỗn hợp",
  phanLo: "Không",
  nhaThauTrungThauId: "contractor-a",
};

function opening(overrides = {}) {
  return {
    id: "opening-a",
    goiThauId: "package-1",
    nhaThauId: "contractor-a",
    tenNhaThau: "Nhà thầu A",
    maPhanLo: "",
    ...overrides,
  };
}

function goods(overrides = {}) {
  return {
    id: "goods-a",
    goiThauId: "package-1",
    thongTinMoThauId: "opening-a",
    phanLoId: null,
    isDraft: false,
    sortOrder: 0,
    sttNguon: "01",
    danhMucHangHoa: "Thiết bị A",
    kyMaHieu: "K01",
    nhanHieu: "Nhãn A",
    namSanXuat: "02026",
    xuatXu: "Việt Nam",
    hangSanXuat: "Hãng A",
    cauHinhTinhNangKyThuat: "Cấu hình A",
    donViTinh: "Cái",
    khoiLuong: "2",
    maHs: "0012.30",
    donGiaDuThau: "50",
    thanhTienDuThau: "100",
    ...overrides,
  };
}

const nameResolver = (_model, bid) => bid.tenNhaThau;

test("non-lot export selects only the official winner goods", () => {
  const model = selectWinningGoodsForExport({
    pkg: packageBase,
    openings: [opening(), opening({ id: "opening-loser", nhaThauId: "contractor-b", tenNhaThau: "Nhà thầu B" })],
    goods: [
      goods(),
      goods({ id: "loser", thongTinMoThauId: "opening-loser", danhMucHangHoa: "Không được xuất" }),
    ],
    nameResolver,
  });
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].contractorName, "Nhà thầu A");
  assert.deepEqual(model.groups[0].lots[0].rows.map((row) => row.id), ["goods-a"]);
});

test("joint-venture winner name comes from the standard bid-name resolver", () => {
  const model = selectWinningGoodsForExport({
    pkg: packageBase,
    openings: [opening({ loaiNhaThau: "Liên danh", tenNhaThau: "Liên danh A - C" })],
    goods: [goods()],
    model: { state: { nhathau: [] } },
  });
  assert.equal(model.groups[0].contractorName, "Liên danh A - C");
});

test("draft winner goods block export with actionable context", () => {
  assert.throws(() => selectWinningGoodsForExport({
    pkg: packageBase,
    openings: [opening()],
    goods: [goods({ isDraft: true })],
    nameResolver,
  }), /Nhà thầu A.*bản nháp.*lưu chính thức/i);
  assert.throws(() => selectWinningGoodsForExport({
    pkg: packageBase,
    openings: [opening()],
    goods: [],
    nameResolver,
  }), /Nhà thầu A.*không có hàng hóa dự thầu chính thức/i);
});

test("lot export uses exact winner opening, groups contractor first, and preserves lot order", () => {
  const pkg = {
    ...packageBase,
    phanLo: "Có",
    nhaThauTrungThauId: "",
    phanLoList: [
      { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1", nhaThauTrungThauId: "contractor-a" },
      { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2", nhaThauTrungThauId: "contractor-b" },
      { id: "lot-3", maPhanLo: "L03", tenPhanLo: "Lô 3", nhaThauTrungThauId: "contractor-a" },
    ],
  };
  const openings = [
    opening({ id: "a-1", maPhanLo: "L01" }),
    opening({ id: "b-1", nhaThauId: "contractor-b", tenNhaThau: "Nhà thầu B", maPhanLo: "L01" }),
    opening({ id: "b-2", nhaThauId: "contractor-b", tenNhaThau: "Nhà thầu B", maPhanLo: "L02" }),
    opening({ id: "a-3", maPhanLo: "L03" }),
  ];
  const rows = [
    goods({ id: "a1-2", thongTinMoThauId: "a-1", phanLoId: "lot-1", sortOrder: 2, sttNguon: "1.2" }),
    goods({ id: "a1-1", thongTinMoThauId: "a-1", phanLoId: "lot-1", sortOrder: 1, sttNguon: "1.1" }),
    goods({ id: "loser-l1", thongTinMoThauId: "b-1", phanLoId: "lot-1" }),
    goods({ id: "b2", thongTinMoThauId: "b-2", phanLoId: "lot-2" }),
    goods({ id: "a3", thongTinMoThauId: "a-3", phanLoId: "lot-3" }),
  ];
  const result = selectWinningGoodsForExport({ pkg, openings, goods: rows, nameResolver });
  assert.deepEqual(result.groups.map((group) => group.contractorName), ["Nhà thầu A", "Nhà thầu B"]);
  assert.deepEqual(result.groups[0].lots.map((lot) => lot.lotCode), ["L01", "L03"]);
  assert.deepEqual(result.groups[0].lots[0].rows.map((row) => row.id), ["a1-1", "a1-2"]);
  assert.deepEqual(result.groups[1].lots.map((lot) => lot.lotCode), ["L02"]);
});

test("opening ambiguity and package/lot winner conflicts are explicit", () => {
  const lot = { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1", nhaThauTrungThauId: "contractor-a" };
  const pkg = { ...packageBase, phanLo: "Có", nhaThauTrungThauId: "contractor-b", phanLoList: [lot] };
  assert.throws(() => selectWinningGoodsForExport({ pkg, openings: [], goods: [], nameResolver }), /mâu thuẫn/i);
  assert.throws(() => selectWinningGoodsForExport({
    pkg: { ...pkg, nhaThauTrungThauId: "contractor-a" },
    openings: [opening({ id: "one", maPhanLo: "L01" }), opening({ id: "two", maPhanLo: "L01" })],
    goods: [],
    nameResolver,
  }), /nhiều hồ sơ mở thầu không thể phân biệt/i);
});

test("winning unit price uses post-discount base before preference with exact large-number math", () => {
  assert.equal(winningUnitPrice(goods()), "50");
  assert.equal(winningUnitPrice(goods({ giaTriCoSoSauGiamGia: "99", khoiLuong: "2", donGiaDuThau: "50", giaDuThauSauUuDai: "999" })), "49.5");
  assert.equal(winningUnitPrice(goods({ giaTriCoSoSauGiamGia: "9007199254740993000", khoiLuong: "0.25" })), "36028797018963972000");
  assert.equal(winningUnitPrice(goods({ giaTriCoSoSauGiamGia: "10", khoiLuong: "3" })), "3.333333");
  assert.throws(() => winningUnitPrice(goods({ giaTriCoSoSauGiamGia: "", donGiaDuThau: "" })), /Thiếu/);
  assert.throws(() => winningUnitPrice(goods({ giaTriCoSoSauGiamGia: "10", khoiLuong: "0" })), /lớn hơn 0/);
});

test("export availability supports goods and mixed official winner scopes only", () => {
  assert.equal(hasWinningGoodsExportScope(packageBase), true);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, linhVuc: "Hàng hóa" }), true);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, linhVuc: "Xây lắp" }), false);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, nhaThauTrungThauId: "" }), false);
});

test("workbook has one sheet, exact 12 columns, merged headings, and safe text cells", () => {
  const exportModel = selectWinningGoodsForExport({
    pkg: packageBase,
    openings: [opening()],
    goods: [goods({ danhMucHangHoa: "=2+2" })],
    nameResolver,
  });
  const workbook = buildWinningGoodsWorkbook(XLSX, exportModel);
  assert.deepEqual(workbook.SheetNames, ["HangHoaTrungThau"]);
  const sheet = workbook.Sheets.HangHoaTrungThau;
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const headerIndex = values.findIndex((row) => row[0] === "STT");
  assert.deepEqual(values[headerIndex], [...WINNING_GOODS_HEADERS]);
  assert.equal(values[headerIndex].length, 12);
  assert.equal(values[headerIndex + 1][1], "'=2+2");
  assert.equal(values[headerIndex + 1][4], "02026");
  assert.equal(values[headerIndex + 1][10], "0012.30");
  assert.ok(sheet["!merges"].every((merge) => merge.s.c === 0 && merge.e.c === 11));
  assert.ok(sheet["!merges"].length >= 3);
});

test("multi-winner workbook keeps contractor then lot grouping in one sheet", () => {
  const exportModel = {
    packageCode: "IB260001",
    packageName: "Gói hỗn hợp",
    isLotted: true,
    groups: [
      {
        contractorId: "a",
        contractorName: "Nhà thầu A",
        lots: [
          { lotId: "1", lotCode: "L01", lotName: "Lô 1", rows: [goods()] },
          { lotId: "3", lotCode: "L03", lotName: "Lô 3", rows: [goods({ id: "g3" })] },
        ],
      },
      {
        contractorId: "b",
        contractorName: "Nhà thầu B",
        lots: [{ lotId: "2", lotCode: "L02", lotName: "Lô 2", rows: [goods({ id: "g2" })] }],
      },
    ],
  };
  const workbook = buildWinningGoodsWorkbook(XLSX, exportModel);
  assert.equal(workbook.SheetNames.length, 1);
  const sheet = workbook.Sheets.HangHoaTrungThau;
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const headings = values.map((row) => row[0]).filter((value) => /^(NHÀ THẦU|PHẦN \(LÔ\))/.test(value));
  assert.deepEqual(headings, [
    "NHÀ THẦU: Nhà thầu A",
    "PHẦN (LÔ): L01 - Lô 1",
    "PHẦN (LÔ): L03 - Lô 3",
    "NHÀ THẦU: Nhà thầu B",
    "PHẦN (LÔ): L02 - Lô 2",
  ]);
  assert.equal(headings.filter((value) => value === "NHÀ THẦU: Nhà thầu A").length, 1);
  assert.ok(sheet["!merges"].filter((merge) => merge.e.c === 11).length >= 7);
});

test("official winning-goods download sends only package identity and revision", async () => {
  const calls = [];
  await downloadOfficialWinningGoodsWorkbook({
    packageId: "pkg/01",
    packageCode: "IB-01",
    expectedRevision: 7,
    downloadImpl: async (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [[
    "/api/packages/pkg%2F01/winning-goods.xlsx?expectedRevision=7",
    "Danh_sach_hang_hoa_trung_thau_IB-01.xlsx",
  ]]);
  await assert.rejects(
    downloadOfficialWinningGoodsWorkbook({ packageId: "pkg", expectedRevision: 0 }),
    /phiên bản/i,
  );
});
