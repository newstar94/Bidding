import assert from "node:assert/strict";
import test from "node:test";

import {
  hasWinningGoodsExportScope,
} from "../../frontend/packages/winningGoodsSelectors.js";
import {
  downloadOfficialWinningGoodsWorkbook,
} from "../../frontend/packages/WinningGoodsExcel.js";

const packageBase = {
  id: "package-1",
  maGoiThau: "IB260001",
  tenGoiThau: "Gói thiết bị",
  linhVuc: "Hỗn hợp",
  phanLo: "Không",
  nhaThauTrungThauId: "contractor-a",
};

test("official export availability follows committed winner scope", () => {
  assert.equal(hasWinningGoodsExportScope(packageBase), true);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, linhVuc: "Hàng hóa" }), true);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, linhVuc: "Xây lắp" }), false);
  assert.equal(hasWinningGoodsExportScope({ ...packageBase, nhaThauTrungThauId: "" }), false);
  assert.equal(hasWinningGoodsExportScope({
    ...packageBase,
    phanLo: "Có",
    nhaThauTrungThauId: "",
    phanLoList: [{ id: "lot-1", nhaThauTrungThauId: "contractor-a" }],
  }), true);
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
