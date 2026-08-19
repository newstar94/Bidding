import test from "node:test";
import assert from "node:assert/strict";

import { saveDanhGiaHsdt } from "../../frontend/packages/bidEvaluationActions.js";
import {
  bidEvaluationDirtyStateFor,
  buildBidEvaluationRecoveryKey,
  generalBidEvaluationRecoveryFor,
} from "../../frontend/packages/BidEvaluationDraftRecovery.js";
import { parseEvaluationMetadataStrict } from "../../frontend/packages/evaluationMetadata.js";

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

function createController({ syncOk = true } = {}) {
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
  const storageValues = new Map();
  const model = {
    workspaceScope: { userId: "user-1", organizationId: "org-1" },
    workspaceStorage: {
      getItem: (key) => storageValues.get(key) || null,
      setItem: (key, value) => storageValues.set(key, value),
    },
    state: { goithau: [pkg], thongtinmothau: bids },
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
    currentDanhGiaTab: "unified",
    calculateRankings() { throw new Error("draft calculated official rankings"); },
    async autoSync() { return { ok: syncOk }; },
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
  return { controller, pkg, bids, staged, persisted, alerts, recoveryKey };
}

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
