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
    rootId: "pkg-family-1",
    phienBan: "01",
    isLatest: 1,
    rowVersion: 3,
    tenGoiThau: "Gói thử",
    phanLo: "Không",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    danhGiaHsdtMetadata: "",
  };
  const bids = [
    { id: "bid-1", rowVersion: 5, goiThauId: pkg.id, nhaThauId: "contractor-1", danhGiaHopLe: "", danhGiaNangLuc: "Giữ nguyên" },
    { id: "bid-2", rowVersion: 2, goiThauId: pkg.id, nhaThauId: "contractor-2", danhGiaHopLe: "Đạt" },
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

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller).restore(scopedRecoveryKey)?.pendingServerSync,
    true,
  );
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

test("draft_save_re_resolves_latest_package_after_authoritative_refresh", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const historical = { ...fixture.pkg, isLatest: 0 };
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    isLatest: 1,
    rowVersion: 11,
    danhGiaHsdtMetadata: "",
  };
  const latestBid = {
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 15,
  };
  fixture.controller.model.state.goithau = [historical, latest];
  fixture.controller.model.state.thongtinmothau = [latestBid];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(historical.danhGiaHsdtMetadata, "");
  assert.equal(parseEvaluationMetadataStrict(latest.danhGiaHsdtMetadata).trangThai, "draft");
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].id,
    latest.id,
  );
});

test("draft_save_never_mutates_historical_package_when_new_latest_version_exists", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const historical = { ...fixture.pkg, isLatest: 0 };
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    isLatest: 1,
    rowVersion: 21,
    danhGiaHsdtMetadata: "",
  };
  fixture.controller.model.state.goithau = [historical, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 25,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(historical.danhGiaHsdtMetadata, "");
  assert.equal(
    fixture.staged.some((entry) => (
      entry.table === "goithau"
      && entry.records.some((record) => record.id === historical.id)
    )),
    false,
  );
});

test("draft_save_retargets_valid_dirty_intent_to_new_latest_version", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 31,
  };
  const latestBid = {
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 35,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [latestBid];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(latestBid.danhGiaHopLe, "Đạt");
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].id,
    latest.id,
  );
  assert.deepEqual(
    fixture.staged.find((entry) => entry.table === "thongtinmothau").records,
    [{ id: "bid-1", rowVersion: 35, danhGiaHopLe: "Đạt" }],
  );
});

test("draft_save_aborts_and_preserves_recovery_when_latest_version_changes_scope", async () => {
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
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 41,
    phanLoList: JSON.stringify([
      { id: "lot-2", maPhanLo: "L02", tenPhanLo: "Lô 2" },
    ]),
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller).restore(scopedRecoveryKey)?.pendingServerSync,
    true,
  );
});

test("draft_save_uses_latest_package_row_version_and_latest_bid_set", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 51,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 55,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].rowVersion,
    51,
  );
  assert.equal(
    fixture.staged.find((entry) => entry.table === "thongtinmothau").records[0].rowVersion,
    55,
  );
});

test("failed_retargeted_draft_preserves_dirty_state_and_recovery_under_latest_package_key", async () => {
  const authority = deferred();
  const fixture = createController({ authority, syncOk: false });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 61,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 65,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  const latestRecoveryKey = buildBidEvaluationRecoveryKey({
    controller: fixture.controller,
    pkg: latest,
    round: "single",
  });
  assert.equal(
    bidEvaluationDirtyStateFor(fixture.controller, latestRecoveryKey).hasChanges(),
    true,
  );
  const latestRecovery = generalBidEvaluationRecoveryFor(fixture.controller)
    .restore(latestRecoveryKey);
  assert.equal(latestRecovery?.pendingServerSync, true);
  assert.equal(latestRecovery?.draft?.packageId, latest.id);
  assert.deepEqual(latestRecovery?.draft?.bidderPatches, [{
    id: "bid-1",
    rowVersion: 65,
    danhGiaHopLe: "Đạt",
  }]);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller)
      .restore(fixture.recoveryKey)?.draft?.packageId,
    fixture.pkg.id,
  );
});

test("draft_save_aborts_and_preserves_recovery_when_latest_version_replaces_dirty_bid_set", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 71,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    id: "bid-2",
    goiThauId: latest.id,
    nhaThauId: "contractor-replacement",
    rowVersion: 75,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.deepEqual(fixture.syncCalls, []);
  const recovered = generalBidEvaluationRecoveryFor(fixture.controller)
    .restore(fixture.recoveryKey);
  assert.equal(recovered?.pendingServerSync, true);
  assert.deepEqual(recovered?.draft?.bidderPatches, [{
    id: "bid-1",
    rowVersion: 5,
    danhGiaHopLe: "Đạt",
  }]);
});

test("draft_save_aborts_and_preserves_recovery_when_latest_version_changes_evaluation_shape", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 81,
    phuongThucLuaChon: "Một giai đoạn hai túi hồ sơ",
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 85,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  const latestRecoveryKey = buildBidEvaluationRecoveryKey({
    controller: fixture.controller,
    pkg: latest,
    round: "single",
  });
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller)
      .restore(latestRecoveryKey)?.pendingServerSync,
    true,
  );
});

test("draft_save_treats_missing_and_explicit_default_evaluation_process_as_same_shape", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  delete fixture.pkg.quyTrinhDanhGia;
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 86,
    quyTrinhDanhGia: "quytrinh1",
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    rowVersion: 87,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].id,
    latest.id,
  );
});

test("draft_save_retargets_valid_dirty_bid_intent_when_latest_version_clones_bid_ids", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 91,
  };
  const clonedBid = {
    ...fixture.bids[0],
    id: "bid-1-v02",
    goiThauId: latest.id,
    rowVersion: 95,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [clonedBid];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(clonedBid.danhGiaHopLe, "Đạt");
  assert.deepEqual(
    fixture.staged.find((entry) => entry.table === "thongtinmothau").records,
    [{ id: "bid-1-v02", rowVersion: 95, danhGiaHopLe: "Đạt" }],
  );
});

test("draft_save_aborts_when_cloned_bid_identity_is_ambiguous", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 96,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = ["a", "b"].map((suffix, index) => ({
    ...fixture.bids[0],
    id: `bid-1-v02-${suffix}`,
    goiThauId: latest.id,
    rowVersion: 97 + index,
  }));
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller)
      .restore(fixture.recoveryKey)?.pendingServerSync,
    true,
  );
});

test("draft_save_aborts_when_authority_reuses_bid_id_for_a_different_contractor", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  const latest = {
    ...fixture.pkg,
    id: "pkg-2",
    phienBan: "02",
    rowVersion: 99,
  };
  fixture.controller.model.state.goithau = [{ ...fixture.pkg, isLatest: 0 }, latest];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latest.id,
    nhaThauId: "contractor-replacement",
    rowVersion: 100,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller)
      .restore(fixture.recoveryKey)?.pendingServerSync,
    true,
  );
});

test("draft_save_targets_package_in_latest_plan_snapshot_before_package_version_number", async () => {
  const authority = deferred();
  const fixture = createController({ authority });
  fixture.pkg.keHoachId = "plan-v01";
  const saving = saveDanhGiaHsdt.call(fixture.controller, { mode: "draft" });
  await new Promise((resolve) => setImmediate(resolve));
  fixture.controller.model.state.kehoach = [
    { id: "plan-v01", rootId: "plan-family", phienBan: "01", isLatest: 0 },
    { id: "plan-v02", rootId: "plan-family", phienBan: "02", isLatest: 1 },
  ];
  const historicalPlanPackage = {
    ...fixture.pkg,
    id: "pkg-plan-v01-p03",
    keHoachId: "plan-v01",
    phienBan: "03",
    rowVersion: 101,
    isLatest: 0,
  };
  const latestPlanPackage = {
    ...fixture.pkg,
    id: "pkg-plan-v02-p01",
    keHoachId: "plan-v02",
    phienBan: "01",
    rowVersion: 102,
    isLatest: 1,
  };
  fixture.controller.model.state.goithau = [historicalPlanPackage, latestPlanPackage];
  fixture.controller.model.state.thongtinmothau = [{
    ...fixture.bids[0],
    goiThauId: latestPlanPackage.id,
    rowVersion: 105,
  }];
  authority.resolve({ authoritative: true, offline: false });

  assert.equal(await saving, true);
  assert.equal(historicalPlanPackage.danhGiaHsdtMetadata, "");
  assert.equal(
    fixture.staged.find((entry) => entry.table === "goithau").records[0].id,
    latestPlanPackage.id,
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

  assert.equal(await saving, false);
  assert.deepEqual(fixture.staged, []);
  assert.deepEqual(fixture.persisted, []);
  assert.equal(
    generalBidEvaluationRecoveryFor(fixture.controller).restore(fixture.recoveryKey)?.pendingServerSync,
    true,
  );
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
