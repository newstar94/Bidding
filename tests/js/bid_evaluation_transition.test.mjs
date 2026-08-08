import test from "node:test";
import assert from "node:assert/strict";

import {
  findInvalidRequiredTechnicalScore,
  saveDanhGiaHsdt,
} from "../../frontend/packages/bidEvaluationActions.js";

test("combined evaluation rejects missing or pass/fail technical text before saving", () => {
  const makeInput = (value) => ({
    value,
    disabled: false,
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    setCustomValidity() {},
  });
  const rowFor = (input) => ({
    querySelector: (selector) => selector === ".mt-dg-ky-thuat" ? input : null,
  });
  const pkg = { phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá" };
  assert.ok(findInvalidRequiredTechnicalScore({ pkg, rows: [rowFor(makeInput("Đạt"))] }));
  assert.ok(findInvalidRequiredTechnicalScore({ pkg, rows: [rowFor(makeInput(""))] }));
  assert.equal(findInvalidRequiredTechnicalScore({ pkg, rows: [rowFor(makeInput("85"))] }), null);
});

test("waits for the paginated package refresh before opening the result step", async () => {
  const packageRecord = {
    id: "pkg-1",
    tenGoiThau: "Gói kiểm thử",
    giaGoiThau: 900_000_000,
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
  };
  const bid = {
    id: "bid-1",
    goiThauId: packageRecord.id,
    tenNhaThau: "Nhà thầu kiểm thử",
    giaDuThau: 780_000_000,
  };
  const controls = new Map([
    ["danhgiahsdt-goithau-select", { value: packageRecord.id }],
    ["danhgiahsdt-so-baocao", { value: "01/BC-DG" }],
    ["danhgiahsdt-ngay-baocao", { value: "03/08/2026" }],
    ["danhgiahsdt-ngay-moi-doichieu", { value: "" }],
    ["danhgiahsdt-ngay-doichieu", { value: "" }],
  ]);
  const rowControls = new Map([
    [".mt-dg-hop-le", { value: "Đạt" }],
    [".mt-dg-nang-luc", { value: "Đạt" }],
    [".mt-dg-ky-thuat", { value: "Đạt" }],
    [".mt-ketluan-cell", { textContent: "Đạt" }],
    [".mt-gia-du-thau", { value: "800000000" }],
    [".mt-ty-le-giam-gia", { value: "5" }],
    [".mt-gia-sau-giam-gia", { value: "760000000" }],
    [".mt-gia-xep-hang", { value: "772200000" }],
    [".mt-gia-de-nghi-trung-thau", { value: "772200000" }],
  ]);
  const row = {
    getAttribute: (name) => name === "data-bid-id" ? bid.id : null,
    querySelector: (selector) => rowControls.get(selector) || null,
  };
  controls.set("danhgiahsdt-table-tbody", { querySelectorAll: () => [row] });

  let packageRefreshFinished = false;
  let detailOpened = false;
  const model = {
    useServerSidePagination: true,
    state: { goithau: [packageRecord], thongtinmothau: [bid] },
    convertDMYToYMD: (value) => value === "03/08/2026" ? "2026-08-03" : value,
    parseVND: (value) => Number(String(value).replace(/\D/g, "")),
    commitLocalMutation() {},
    async persistData() {},
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    currentDanhGiaTab: "technical",
    calculateRankings: () => ({ rankings: { [bid.id]: 1 } }),
    async autoSync() { return { ok: true }; },
    view: {
      _editingState: {},
      getActiveElement: (id) => controls.get(id) || null,
      isGoiThauDetailTabActive: () => true,
      focusInvalidControl() {},
      async renderGoiThauTable() {
        await new Promise((resolve) => setTimeout(resolve, 10));
        packageRefreshFinished = true;
      },
      async showPackageDetails() {
        assert.equal(packageRefreshFinished, true, "detail opened before package refresh completed");
        detailOpened = true;
      },
      async customAlert() {},
    },
  };

  await saveDanhGiaHsdt.call(controller);

  assert.equal(detailOpened, true);
  assert.equal(packageRecord.danhGiaHsdtMetadata.includes('"saved":true'), true);
  assert.equal(bid.giaDuThau, 800_000_000);
  assert.equal(bid.tyLeGiamGia, 5);
  assert.equal(bid.giaSauGiamGia, 760_000_000);
});

test("awarded packages reject evaluation saves before reading report controls", async () => {
  const pkg = {
    id: "pkg-awarded",
    trangThai: "Đã có kết quả",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  const alerts = [];
  let activeControlReads = 0;
  const controller = {
    model: {
      state: { goithau: [pkg], thongtinmothau: [] },
    },
    view: {
      getActiveElement(id) {
        activeControlReads += 1;
        return id === "danhgiahsdt-goithau-select" ? { value: pkg.id } : null;
      },
      isGoiThauDetailTabActive: () => true,
      focusInvalidControl() {},
      async customAlert(...args) { alerts.push(args); },
    },
  };

  await saveDanhGiaHsdt.call(controller);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0][0], "Báo cáo đánh giá đã được khóa");
  assert.equal(activeControlReads, 1, "locked save read editable report controls");
  assert.equal(pkg.danhGiaHsdtMetadata, undefined);
});
