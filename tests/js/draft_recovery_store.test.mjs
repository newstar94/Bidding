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

function trackedControl(value = "") {
  const listeners = new Map();
  return {
    value,
    disabled: false,
    matches: () => false,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    emit(name = "input") {
      (listeners.get(name) || []).forEach((callback) => callback({ target: this }));
    },
  };
}

function recoveryController({ storage, reportNumber, organizationId = "org-a", epoch = 1 }) {
  const reportControl = trackedControl(reportNumber);
  const controls = new Map([["danhgiahsdt-so-baocao", reportControl]]);
  let workspaceToken = `user-a:${organizationId}@${epoch}`;
  const controller = {
    model: {
      workspaceScope: { userId: "user-a", organizationId },
      workspaceStorage: storage,
      getWorkspaceToken: () => workspaceToken,
      isWorkspaceCurrent: (token) => token === workspaceToken,
      parseVND: Number,
    },
    view: { getActiveElement: (id) => controls.get(id) || null },
  };
  return {
    controller,
    controls,
    reportControl,
    switchEpoch(nextEpoch) { workspaceToken = `user-a:${organizationId}@${nextEpoch}`; },
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

test("draft_recovery_timer_from_a_cannot_capture_report_fields_from_b", () => {
  const storageA = memoryStorage();
  const fixture = recoveryController({ storage: storageA, reportNumber: "A-01" });
  const scheduled = [];
  const recoveryA = generalBidEvaluationRecoveryFor(fixture.controller);
  recoveryA.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recoveryA.cancelTimer = () => {};
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [],
    bids: [],
  });
  fixture.reportControl.emit();
  fixture.controls.set("danhgiahsdt-so-baocao", trackedControl("B-99"));

  scheduled[0]();

  assert.equal(
    recoveryA.restore(binding.recoveryKey).draft.report.soBaoCao,
    "A-01",
  );
});

test("pending_report_snapshot_survives_a_rerender_before_debounced_storage_flush", () => {
  const storage = memoryStorage();
  const fixture = recoveryController({ storage, reportNumber: "BC-01" });
  const scheduled = [];
  const recovery = generalBidEvaluationRecoveryFor(fixture.controller);
  recovery.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recovery.cancelTimer = () => {};
  fixture.controls.set("danhgiahsdt-table-tbody", { __bfBidEvaluationRowRenderRevision: 1 });
  bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [],
    bids: [],
  });
  fixture.reportControl.emit();

  const replacement = trackedControl("");
  fixture.controls.set("danhgiahsdt-so-baocao", replacement);
  fixture.controls.set("danhgiahsdt-table-tbody", { __bfBidEvaluationRowRenderRevision: 2 });
  const rebound = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [],
    bids: [],
  });

  assert.equal(rebound.restored, true);
  assert.equal(replacement.value, "BC-01");
  assert.equal(storage.values.size, 0, "rerender recovery must not force synchronous storage I/O");
  assert.equal(scheduled.length, 1);
});

test("pending_report_snapshot_survives_controls_replaced_inside_same_table_body", () => {
  const storage = memoryStorage();
  const fixture = recoveryController({ storage, reportNumber: "BC-02" });
  const scheduled = [];
  const recovery = generalBidEvaluationRecoveryFor(fixture.controller);
  recovery.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recovery.cancelTimer = () => {};
  const tableBody = { __bfBidEvaluationRowRenderRevision: 1 };
  fixture.controls.set("danhgiahsdt-table-tbody", tableBody);
  bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [],
    bids: [],
  });
  fixture.reportControl.emit();

  const replacement = trackedControl("");
  fixture.controls.set("danhgiahsdt-so-baocao", replacement);
  tableBody.__bfBidEvaluationRowRenderRevision = 2;
  const rebound = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [],
    bids: [],
  });

  assert.equal(rebound.restored, true);
  assert.equal(replacement.value, "BC-02");
  assert.equal(storage.values.size, 0);
});

test("persisted_report_snapshot_survives_a_later_same_body_rerender", () => {
  const storage = memoryStorage();
  const fixture = recoveryController({ storage, reportNumber: "BC-03" });
  const scheduled = [];
  const recovery = generalBidEvaluationRecoveryFor(fixture.controller);
  recovery.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recovery.cancelTimer = () => {};
  const tableBody = { __bfBidEvaluationRowRenderRevision: 1 };
  fixture.controls.set("danhgiahsdt-table-tbody", tableBody);
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
  });
  fixture.reportControl.emit();
  scheduled[0]();

  const replacement = trackedControl("");
  fixture.controls.set("danhgiahsdt-so-baocao", replacement);
  tableBody.__bfBidEvaluationRowRenderRevision = 2;
  const rebound = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
  });

  assert.equal(rebound.restored, true);
  assert.equal(replacement.value, "BC-03");
  assert.ok(binding.dirtyState.hasChanges());
});

test("draft_recovery_timer_from_a_cannot_capture_bid_fields_from_b", () => {
  const storageA = memoryStorage();
  const fixture = recoveryController({ storage: storageA, reportNumber: "A-01" });
  const validity = {
    value: "Đạt",
    disabled: false,
    matches: (selector) => selector === ".mt-dg-hop-le",
  };
  const row = trackedRow("bid-1", validity);
  const scheduled = [];
  const recoveryA = generalBidEvaluationRecoveryFor(fixture.controller);
  recoveryA.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recoveryA.cancelTimer = () => {};
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
    rows: [row],
    bids: [{ id: "bid-1", rowVersion: 4, danhGiaHopLe: "" }],
  });
  row.emit(validity);
  validity.value = "Không đạt";

  scheduled[0]();

  assert.equal(
    recoveryA.restore(binding.recoveryKey).draft.bidderPatches[0].danhGiaHopLe,
    "Đạt",
  );
});

test("draft_recovery_scheduled_in_a_still_saves_a_snapshot_after_switch_to_b", () => {
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  const fixture = recoveryController({ storage: storageA, reportNumber: "A-01" });
  const scheduled = [];
  const recoveryA = generalBidEvaluationRecoveryFor(fixture.controller);
  recoveryA.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recoveryA.cancelTimer = () => {};
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
  });
  fixture.reportControl.emit();
  fixture.controller.model.workspaceScope = { userId: "user-a", organizationId: "org-b" };
  fixture.controller.model.workspaceStorage = storageB;
  fixture.controls.set("danhgiahsdt-so-baocao", trackedControl("B-99"));

  scheduled[0]();

  assert.equal(recoveryA.restore(binding.recoveryKey).draft.report.soBaoCao, "A-01");
  assert.equal(storageA.values.has("bf_general_evaluation_drafts_v1"), true);
  assert.equal(storageB.values.size, 0);
});

test("same_org_new_epoch_recovery_timer_does_not_use_new_epoch_view", () => {
  const storage = memoryStorage();
  const fixture = recoveryController({ storage, reportNumber: "epoch-1", epoch: 1 });
  const scheduled = [];
  const recovery = generalBidEvaluationRecoveryFor(fixture.controller);
  recovery.scheduleTimer = (callback) => { scheduled.push(callback); return scheduled.length; };
  recovery.cancelTimer = () => {};
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
  });
  fixture.reportControl.emit();
  fixture.switchEpoch(2);
  fixture.controls.set("danhgiahsdt-so-baocao", trackedControl("epoch-2"));

  scheduled[0]();

  assert.equal(recovery.restore(binding.recoveryKey).draft.report.soBaoCao, "epoch-1");
});

test("recovery_debounce_keeps_latest_snapshot_within_same_workspace", () => {
  const storage = memoryStorage();
  const fixture = recoveryController({ storage, reportNumber: "first" });
  const pending = new Map();
  let timerId = 0;
  const recovery = generalBidEvaluationRecoveryFor(fixture.controller);
  recovery.scheduleTimer = (callback) => {
    timerId += 1;
    pending.set(timerId, callback);
    return timerId;
  };
  recovery.cancelTimer = (id) => pending.delete(id);
  const binding = bindBidEvaluationDraftTracking({
    controller: fixture.controller,
    pkg: { id: "pkg-1" },
  });
  fixture.reportControl.emit();
  fixture.reportControl.value = "second";
  fixture.reportControl.emit();

  [...pending.values()].forEach((callback) => callback());

  assert.equal(recovery.restore(binding.recoveryKey).draft.report.soBaoCao, "second");
  assert.equal(pending.size, 1);
});
