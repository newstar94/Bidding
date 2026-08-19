import test from "node:test";
import assert from "node:assert/strict";

import { DraftRecoveryStore } from "../../frontend/shared/DraftRecoveryStore.js";
import {
  bindBidEvaluationDraftTracking,
  generalBidEvaluationRecoveryFor,
} from "../../frontend/packages/BidEvaluationDraftRecovery.js";

function memoryStorage(initial = new Map()) {
  return {
    values: initial,
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, value); },
  };
}

test("workspace-scoped recovery survives reload and tracks pending server sync", () => {
  const storage = memoryStorage();
  const first = new DraftRecoveryStore(storage, {
    storageKey: "bf_general_evaluation_drafts_v1",
    payloadField: "draft",
    now: () => 42,
  });
  const key = "user-a|org-a|pkg-1|technical|lot-1|general";
  first.save(key, { report: { soBaoCao: "D-01" }, bidders: {} });

  const reloaded = new DraftRecoveryStore(storage, {
    storageKey: "bf_general_evaluation_drafts_v1",
    payloadField: "draft",
  });
  assert.deepEqual(reloaded.restore(key), {
    draft: { report: { soBaoCao: "D-01" }, bidders: {} },
    savedAt: 42,
    pendingServerSync: true,
  });
  assert.equal(reloaded.restore("user-a|org-b|pkg-1|technical|lot-1|general"), null);
});

test("server failure preserves recovery while success can clear it", () => {
  const storage = memoryStorage();
  const store = new DraftRecoveryStore(storage, {
    storageKey: "drafts",
    payloadField: "draft",
  });
  store.save("scope", { value: 1 });
  store.acknowledge("scope", { ok: false });
  assert.equal(store.restore("scope").pendingServerSync, true);
  store.acknowledge("scope", { ok: true });
  assert.equal(store.restore("scope"), null);
});

test("corrupt recovery is reported explicitly instead of being silently trusted", () => {
  const storage = memoryStorage(new Map([["drafts", "{broken"]]));
  const errors = [];
  const store = new DraftRecoveryStore(storage, {
    storageKey: "drafts",
    onError: (error) => errors.push(error),
  });

  assert.deepEqual(store.readAll(), {});
  assert.equal(store.durability, "corrupt");
  assert.equal(errors.length, 1);
  assert.equal(store.save("new", { value: 1 }), false);
  assert.equal(storage.values.get("drafts"), "{broken");
});

function trackedRow(bidId, validityControl) {
  const listeners = new Map();
  return {
    getAttribute: (name) => name === "data-bid-id" ? bidId : null,
    querySelector: (selector) => selector === ".mt-dg-hop-le" ? validityControl : null,
    querySelectorAll: (selector) => selector === ".mt-dg-hop-le" ? [validityControl] : [],
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    emit(target, name = "change") {
      (listeners.get(name) || []).forEach((callback) => callback({ target }));
    },
  };
}

test("general evaluation local recovery reapplies a pending dirty field after reload", () => {
  const storage = memoryStorage();
  const pkg = { id: "pkg-1" };
  const bids = [{ id: "bid-1", danhGiaHopLe: "" }];
  const firstControl = {
    value: "Đạt",
    disabled: false,
    matches: (selector) => selector === ".mt-dg-hop-le",
  };
  const firstRow = trackedRow("bid-1", firstControl);
  const tableBody = { __bfBidEvaluationRowRenderRevision: 1 };
  const first = {
    model: {
      workspaceScope: { userId: "u", organizationId: "o" },
      workspaceStorage: storage,
      parseVND: Number,
    },
    view: { getActiveElement: (id) => id === "danhgiahsdt-table-tbody" ? tableBody : null },
  };
  const scheduled = [];
  const store = generalBidEvaluationRecoveryFor(first);
  store.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  store.cancelTimer = () => {};
  bindBidEvaluationDraftTracking({
    controller: first,
    pkg,
    rows: [firstRow],
    bids,
    round: "single",
  });
  firstRow.emit(firstControl);
  scheduled[0]();

  const restoredControl = {
    value: "",
    disabled: false,
    matches: (selector) => selector === ".mt-dg-hop-le",
  };
  const restoredRow = trackedRow("bid-1", restoredControl);
  const reloaded = {
    model: first.model,
    view: { getActiveElement: (id) => id === "danhgiahsdt-table-tbody" ? tableBody : null },
  };
  const binding = bindBidEvaluationDraftTracking({
    controller: reloaded,
    pkg,
    rows: [restoredRow],
    bids,
    round: "single",
  });

  assert.equal(binding.restored, true);
  assert.equal(restoredControl.value, "Đạt");
  assert.equal(binding.dirtyState.fieldsForBid("bid-1").has("danhGiaHopLe"), true);
});

test("draft_recovery_timer_from_workspace_a_cannot_write_workspace_b_storage", () => {
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  const pkg = { id: "pkg-1" };
  const bids = [{ id: "bid-1", danhGiaHopLe: "" }];
  const validity = {
    value: "Đạt",
    disabled: false,
    matches: (selector) => selector === ".mt-dg-hop-le",
  };
  const row = trackedRow("bid-1", validity);
  const controller = {
    model: {
      workspaceScope: { userId: "user-a", organizationId: "org-a" },
      workspaceStorage: storageA,
      parseVND: Number,
    },
    view: { getActiveElement: () => null },
  };
  const scheduled = [];
  const recoveryA = generalBidEvaluationRecoveryFor(controller);
  recoveryA.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recoveryA.cancelTimer = () => {};
  bindBidEvaluationDraftTracking({
    controller,
    pkg,
    rows: [row],
    bids,
    round: "single",
  });
  row.emit(validity);

  controller.model.workspaceScope = { userId: "user-a", organizationId: "org-b" };
  controller.model.workspaceStorage = storageB;
  scheduled[0]();

  assert.equal(storageB.values.size, 0);
  assert.equal(storageA.values.has("bf_general_evaluation_drafts_v1"), true);
});
