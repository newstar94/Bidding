import test from "node:test";
import assert from "node:assert/strict";

import { saveDanhGiaHsdt } from "../../frontend/packages/bidEvaluationActions.js";
import {
  bidEvaluationDirtyStateFor,
  buildBidEvaluationRecoveryKey,
  generalBidEvaluationRecoveryFor,
} from "../../frontend/packages/BidEvaluationDraftRecovery.js";
import { parseEvaluationMetadataStrict } from "../../frontend/packages/evaluationMetadata.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function control(value = "") {
  return {
    value,
    disabled: false,
    ownerDocument: { querySelectorAll: () => [] },
    classList: { add() {}, remove() {} },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    setCustomValidity() {},
  };
}

function evaluationRow(bidId, values) {
  const controls = new Map(Object.entries(values).map(([selector, value]) => [selector, control(value)]));
  return {
    getAttribute: (name) => name === "data-bid-id" ? bidId : null,
    querySelector: (selector) => controls.get(selector) || null,
  };
}

function createController({ syncOk = true, authority = null } = {}) {
  const pkg = {
    id: "pkg-1",
    rowVersion: 3,
    tenGoiThau: "Gói thử",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: "",
  };
  const bids = [
    { id: "bid-1", rowVersion: 5, goiThauId: pkg.id, danhGiaHopLe: "", danhGiaNangLuc: "Giữ nguyên" },
    { id: "bid-2", rowVersion: 2, goiThauId: pkg.id, danhGiaHopLe: "Đạt" },
  ];
  const row = evaluationRow("bid-1", { ".mt-dg-hop-le": "Đạt" });
  const controls = new Map([
    ["danhgiahsdt-goithau-select", control(pkg.id)],
    ["danhgiahsdt-so-baocao", control("")],
    ["danhgiahsdt-ngay-baocao", control("")],
    ["danhgiahsdt-ngay-moi-doichieu", control("")],
    ["danhgiahsdt-ngay-doichieu", control("")],
    ["danhgiahsdt-table-tbody", { querySelectorAll: () => [row] }],
  ]);
  const staged = [];
  const persisted = [];
  const alerts = [];
  const syncCalls = [];
  const storageValues = new Map();
  let workspaceToken = "user-1:org-1@1";
  const model = {
    workspaceScope: { userId: "user-1", organizationId: "org-1" },
    workspaceStorage: {
      getItem: (key) => storageValues.get(key) || null,
      setItem: (key, value) => storageValues.set(key, value),
    },
    state: { goithau: [pkg], thongtinmothau: bids },
    getWorkspaceToken: () => workspaceToken,
    isWorkspaceCurrent: (token) => token === workspaceToken,
    convertDMYToYMD: (value) => value,
    parseVND: Number,
    commitLocalMutation(table, { records }) {
      staged.push({ table, records: structuredClone(records) });
    },
    async persistChanges(table, changes) {
      persisted.push({ table, changes: structuredClone(changes) });
    },
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    ...(authority ? { awaitAuthoritativeMutationBoundary: () => authority.promise } : {}),
    currentDanhGiaTab: "unified",
    calculateRankings() { throw new Error("draft calculated official rankings"); },
    async autoSync() {
      syncCalls.push("sync");
      return { ok: syncOk };
    },
    view: {
      getActiveElement: (id) => controls.get(id) || null,
      isGoiThauDetailTabActive: () => true,
      focusInvalidControl() {},
      async customAlert(...args) { alerts.push(args); },
      async showPackageDetails() { throw new Error("draft navigated"); },
    },
  };
  const recoveryKey = buildBidEvaluationRecoveryKey({ controller, pkg, round: "single" });
  bidEvaluationDirtyStateFor(controller, recoveryKey).markBidField("bid-1", "danhGiaHopLe");
  return {
    controller,
    pkg,
    bids,
    staged,
    persisted,
    alerts,
    recoveryKey,
    syncCalls,
    switchWorkspace() {
      workspaceToken = "user-1:org-1@2";
      model.workspaceScope = { userId: "user-1", organizationId: "org-1" };
      model.state = { goithau: [], thongtinmothau: [] };
    },
  };
}

test("draft_save_waits_for_authority_before_mutating_state_or_outbox", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const initialPackage = structuredClone(fixture.pkg);
  const initialBids = structuredClone(fixture.bids);

  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.pkg, initialPackage);
  assert.deepEqual(fixture.bids, initialBids);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);

  authority.resolve({ authoritative: true, offline: false });
  assert.equal(await saving, true);
});

test("draft_save_rebuilds_patch_after_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const refreshedPackage = {
    ...fixture.pkg,
    rowVersion: 9,
    tenGoiThau: "Tên mới từ máy chủ",
    danhGiaHsdtMetadata: JSON.stringify({ serverOnly: "preserved" }),
  };
  const refreshedBid = {
    ...fixture.bids[0],
    rowVersion: 12,
    danhGiaNangLuc: "Máy chủ vừa cập nhật",
  };
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.goithau = [refreshedPackage];
  fixture.controller.model.state.thongtinmothau = [refreshedBid, fixture.bids[1]];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(refreshedPackage.tenGoiThau, "Tên mới từ máy chủ");
  assert.equal(refreshedBid.danhGiaNangLuc, "Máy chủ vừa cập nhật");
  assert.equal(refreshedBid.danhGiaHopLe, "Đạt");
  assert.equal(fixture.pkg.danhGiaHsdtMetadata, "");
});

test("draft_save_does_not_stage_lot_scope_removed_by_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  fixture.pkg.phanLo = "Có";
  fixture.pkg.phanLoList = JSON.stringify([
    { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1" },
    { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
  ]);
  fixture.bids[0].lotId = "lot-1";
  fixture.controller._explicitEvaluationLotScopes = {
    "pkg-1:unified": {
      mode: "selected",
      selectedLotIds: ["lot-1"],
      availableLotIds: ["lot-1", "lot-2"],
      batchId: null,
    },
  };
  const scopedRecoveryKey = buildBidEvaluationRecoveryKey({
    controller: fixture.controller,
    pkg: fixture.pkg,
    round: "single",
    lotIds: ["lot-1"],
  });
  bidEvaluationDirtyStateFor(fixture.controller, scopedRecoveryKey)
    .markBidField("bid-1", "danhGiaHopLe");

  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);

  const refreshedPackage = {
    ...fixture.pkg,
    rowVersion: 14,
    phanLoList: JSON.stringify([
      { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
    ]),
  };
  fixture.controller.model.state.goithau = [refreshedPackage];
  fixture.controller.model.state.thongtinmothau = [];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.equal(refreshedPackage.danhGiaHsdtMetadata, "");
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller).restore(scopedRecoveryKey)?.pendingServerSync,
    true,
  );
});

test("draft_save_does_not_stage_bid_moved_out_of_lot_scope_by_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  fixture.pkg.phanLo = "Có";
  fixture.pkg.phanLoList = JSON.stringify([
    { id: "lot-1", maPhanLo: "L01", tenPhanLo: "Lô 1" },
    { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
  ]);
  fixture.bids[0].lotId = "lot-1";
  fixture.controller._explicitEvaluationLotScopes = {
    "pkg-1:unified": {
      mode: "selected",
      selectedLotIds: ["lot-1"],
      availableLotIds: ["lot-1", "lot-2"],
      batchId: null,
    },
  };
  const scopedRecoveryKey = buildBidEvaluationRecoveryKey({
    controller: fixture.controller,
    pkg: fixture.pkg,
    round: "single",
    lotIds: ["lot-1"],
  });
  bidEvaluationDirtyStateFor(fixture.controller, scopedRecoveryKey)
    .markBidField("bid-1", "danhGiaHopLe");

  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.thongtinmothau = [
    { ...fixture.bids[0], rowVersion: 18, lotId: "lot-2" },
    fixture.bids[1],
  ];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(fixture.staged.some((entry) => entry.table === "thongtinmothau"), false);
  assert.equal(fixture.persisted.some((entry) => entry.table === "thongtinmothau"), false);
});

test("draft_save_uses_refreshed_row_version", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const refreshedPackage = { ...fixture.pkg, rowVersion: 13 };
  const refreshedBid = { ...fixture.bids[0], rowVersion: 17 };
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.goithau = [refreshedPackage];
  fixture.controller.model.state.thongtinmothau = [refreshedBid, fixture.bids[1]];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].rowVersion,
    13,
  );
  assert.equal(
    fixture.staged.find((entry) => entry.table === "thongtinmothau").records[0].rowVersion,
    17,
  );
});

test("draft_save_does_not_resurrect_package_removed_by_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.goithau = [];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.controller.model.state.goithau, []);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);
});

test("draft_save_does_not_stage_bid_removed_by_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.thongtinmothau = [fixture.bids[1]];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(fixture.staged.some((entry) => entry.table === "thongtinmothau"), false);
  assert.equal(fixture.persisted.some((entry) => entry.table === "thongtinmothau"), false);
});

test("workspace_change_while_draft_waits_for_authority_aborts_without_mutation", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.switchWorkspace();
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.controller.model.state, { goithau: [], thongtinmothau: [] });
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);
});

test("general draft persists non-official metadata and only the dirty bidder patch", async () => {
  const fixture = createController();
  const result = await saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });

  assert.equal(result, true);
  const metadata = parseEvaluationMetadataStrict(fixture.pkg.danhGiaHsdtMetadata);
  assert.equal(metadata.saved, false);
  assert.equal(metadata.trangThai, "draft");
  assert.equal(fixture.bids[0].danhGiaHopLe, "Đạt");
  assert.equal(fixture.bids[0].danhGiaNangLuc, "Giữ nguyên");
  assert.equal(fixture.bids[1].danhGiaHopLe, "Đạt");
  const stagedBid = fixture.staged.find((entry) => entry.table === "thongtinmothau");
  assert.deepEqual(stagedBid.records, [{ id: "bid-1", rowVersion: 5, danhGiaHopLe: "Đạt" }]);
  assert.equal(fixture.alerts.at(-1)[0], "Đã lưu nháp");
  assert.equal(bidEvaluationDirtyStateFor(fixture.controller, fixture.recoveryKey).hasChanges(), false);
  assert.equal(generalBidEvaluationRecoveryFor(fixture.controller).restore(fixture.recoveryKey), null);
});

test("failed server draft keeps dirty state and local recovery without claiming success", async () => {
  const fixture = createController({ syncOk: false });
  const result = await saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });

  assert.equal(result, false);
  assert.equal(bidEvaluationDirtyStateFor(fixture.controller, fixture.recoveryKey).hasChanges(), true);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller).restore(fixture.recoveryKey).pendingServerSync,
    true,
  );
  assert.equal(fixture.alerts.some(([title]) => title === "Đã lưu nháp"), false);
});
