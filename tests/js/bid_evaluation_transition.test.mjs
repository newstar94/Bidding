import test from "node:test";
import assert from "node:assert/strict";

import {
  findInvalidRequiredTechnicalScore,
  saveDanhGiaHsdt,
} from "../../frontend/packages/bidEvaluationActions.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function completionScenario() {
  const pkg = {
    id: "pkg-authority",
    rowVersion: 3,
    tenGoiThau: "Gói authority",
    giaGoiThau: 900_000_000,
    linhVuc: "Hàng hóa",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    danhGiaHsdtMetadata: "",
  };
  const bid = {
    id: "bid-authority",
    rowVersion: 4,
    goiThauId: pkg.id,
    tenNhaThau: "Nhà thầu authority",
    giaDuThau: 780_000_000,
  };
  const control = (value = "") => ({
    value,
    disabled: false,
    classList: { add() {}, remove() {} },
    setAttribute() {},
    removeAttribute() {},
    setCustomValidity() {},
  });
  const rowControls = new Map([
    [".mt-dg-hop-le", control("Đạt")],
    [".mt-dg-nang-luc", control("Đạt")],
    [".mt-dg-ky-thuat", control("Đạt")],
    [".mt-ketluan-cell", { textContent: "Đạt" }],
    [".mt-gia-du-thau", control("800000000")],
    [".mt-ty-le-giam-gia", control("5")],
    [".mt-gia-sau-giam-gia", control("760000000")],
    [".mt-gia-xep-hang", control("772200000")],
    [".mt-gia-de-nghi-trung-thau", control("772200000")],
  ]);
  const row = {
    getAttribute: (name) => name === "data-bid-id" ? bid.id : null,
    querySelector: (selector) => rowControls.get(selector) || null,
  };
  const controls = new Map([
    ["danhgiahsdt-goithau-select", control(pkg.id)],
    ["danhgiahsdt-so-baocao", control("01/BC-DG")],
    ["danhgiahsdt-ngay-baocao", control("03/08/2026")],
    ["danhgiahsdt-ngay-moi-doichieu", control("")],
    ["danhgiahsdt-ngay-doichieu", control("")],
    ["danhgiahsdt-table-tbody", { querySelectorAll: () => [row] }],
  ]);
  const authority = deferred();
  const staged = [];
  const persisted = [];
  const syncCalls = [];
  let workspaceToken = "user:org@1";
  const model = {
    state: { goithau: [pkg], thongtinmothau: [bid] },
    getWorkspaceToken: () => workspaceToken,
    isWorkspaceCurrent: (token) => token === workspaceToken,
    convertDMYToYMD: (value) => value === "03/08/2026" ? "2026-08-03" : value,
    parseVND: (value) => Number(String(value).replace(/\D/g, "")),
    commitLocalMutation(table, { records }) {
      staged.push({ table, records: structuredClone(Array.isArray(records) ? records : [records]) });
    },
    async persistChanges(table, changes) {
      persisted.push({ table, changes: structuredClone(changes) });
    },
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    currentDanhGiaTab: "technical",
    awaitAuthoritativeMutationBoundary: () => authority.promise,
    calculateRankings: (_pkg, bids) => ({
      rankings: Object.fromEntries(bids.map((item, index) => [item.id, index + 1])),
    }),
    async autoSync() {
      syncCalls.push("sync");
      return { ok: true };
    },
    view: {
      _editingState: {},
      getActiveElement: (id) => controls.get(id) || null,
      isGoiThauDetailTabActive: () => false,
      focusInvalidControl() {},
      async renderGoiThauTable() {},
      async customAlert() {},
    },
  };
  return {
    authority,
    bid,
    controller,
    model,
    persisted,
    pkg,
    staged,
    syncCalls,
    switchWorkspace() {
      workspaceToken = "user:org@2";
      model.state = { goithau: [], thongtinmothau: [] };
    },
  };
}

test("complete_evaluation_waits_for_authority_before_mutation", async () => {
  const scenario = completionScenario();
  const initialPackage = structuredClone(scenario.pkg);
  const initialBid = structuredClone(scenario.bid);
  const saving = saveDanhGiaHsdt.call(scenario.controller, { mode: "complete" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(scenario.pkg, initialPackage);
  assert.deepEqual(scenario.bid, initialBid);
  assert.deepEqual(scenario.staged, []);
  assert.deepEqual(scenario.persisted, []);
  assert.deepEqual(scenario.syncCalls, []);

  scenario.authority.resolve({ authoritative: true, offline: false });
  await saving;
});

test("complete_evaluation_uses_refreshed_bid_row_versions", async () => {
  const scenario = completionScenario();
  const refreshedPackage = { ...scenario.pkg, rowVersion: 10 };
  const refreshedBid = { ...scenario.bid, rowVersion: 14, serverOnly: "preserved" };
  const saving = saveDanhGiaHsdt.call(scenario.controller, { mode: "complete" });
  await new Promise((resolve) => setImmediate(resolve));
  scenario.model.state.goithau = [refreshedPackage];
  scenario.model.state.thongtinmothau = [refreshedBid];
  scenario.authority.resolve({ authoritative: true, offline: false });
  await saving;

  assert.equal(
    scenario.staged.find((entry) => entry.table === "thongtinmothau").records[0].rowVersion,
    14,
  );
  assert.equal(refreshedBid.serverOnly, "preserved");
});

test("complete_evaluation_does_not_resurrect_removed_bid", async () => {
  const scenario = completionScenario();
  const saving = saveDanhGiaHsdt.call(scenario.controller, { mode: "complete" });
  await new Promise((resolve) => setImmediate(resolve));
  scenario.model.state.thongtinmothau = [];
  scenario.authority.resolve({ authoritative: true, offline: false });
  await saving;

  assert.deepEqual(scenario.model.state.thongtinmothau, []);
  assert.equal(scenario.staged.some((entry) => entry.table === "thongtinmothau"), false);
  assert.equal(scenario.persisted.some((entry) => entry.table === "thongtinmothau"), false);
});

test("complete_evaluation_aborts_on_workspace_change_before_commit", async () => {
  const scenario = completionScenario();
  const saving = saveDanhGiaHsdt.call(scenario.controller, { mode: "complete" });
  await new Promise((resolve) => setImmediate(resolve));
  scenario.switchWorkspace();
  scenario.authority.resolve({ authoritative: true, offline: false });
  await saving;

  assert.deepEqual(scenario.model.state, { goithau: [], thongtinmothau: [] });
  assert.deepEqual(scenario.staged, []);
  assert.deepEqual(scenario.persisted, []);
  assert.deepEqual(scenario.syncCalls, []);
});

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
  let detailNavigation = null;
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
      async showPackageDetails(...args) {
        assert.equal(packageRefreshFinished, true, "detail opened before package refresh completed");
        detailNavigation = args;
        detailOpened = true;
      },
      async customAlert() {},
    },
  };

  await saveDanhGiaHsdt.call(controller);

  assert.equal(detailOpened, true);
  assert.deepEqual(detailNavigation, [packageRecord.id, false, "result"]);
  assert.equal(packageRecord.danhGiaHsdtMetadata.includes('"saved":true'), true);
  const completedMetadata = JSON.parse(packageRecord.danhGiaHsdtMetadata);
  assert.equal(completedMetadata.trangThai, "completed");
  assert.match(completedMetadata.hoanThanhLuc, /^\d{4}-\d{2}-\d{2}T/u);
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
