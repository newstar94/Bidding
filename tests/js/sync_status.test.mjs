import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";
import {
  getSyncActivitySnapshot,
  runManualSyncRetry,
  shouldShowLocalPending,
} from "../../frontend/app/SyncCoordinator.js";
import { applyFailedPush, autoSync } from "../../frontend/app/SyncPushService.js";
import { hashWorkspaceScope } from "../../frontend/shared/releaseDiagnostics.js";
import {
  CONFLICT_CENTER_CAPABILITY,
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";

afterEach(() => invalidateServerCapabilities());

function deferredResult() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function pushRaceModel({ tokenRef, flush = null, repair = null, build = () => null } = {}) {
  return {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: { setItem() {}, removeItem() {} },
    getWorkspaceToken: () => tokenRef.value,
    isWorkspaceCurrent: (candidate) => candidate === tokenRef.value,
    getMutationOutboxStatus: () => ({
      state: flush && !flush.settled ? "pending" : "ready",
      trusted: true,
    }),
    flushMutationOutbox: flush ? async () => {
      await flush.promise;
      flush.settled = true;
    } : undefined,
    repairPendingDuplicatePlanVersions: repair ? () => repair.promise : () => null,
    buildMutationSyncPayload: build,
  };
}

test("workspace_change_during_outbox_flush_cannot_start_auto_sync_for_new_workspace", async () => {
  const tokenRef = { value: "user:org-a@1" };
  const flush = deferredResult();
  const builds = [];
  const phases = [];
  const model = pushRaceModel({
    tokenRef,
    flush,
    build: () => { builds.push(tokenRef.value); return null; },
  });
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState: (patch) => phases.push(patch.phase),
  };

  const pending = autoSync.call(controller);
  await new Promise((resolve) => setImmediate(resolve));
  tokenRef.value = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  flush.resolve();

  assert.deepEqual(await pending, {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(builds, []);
  assert.deepEqual(phases, []);
});

test("workspace_change_during_outbox_flush_failure_cannot_set_storage_error_on_new_workspace", async () => {
  const tokenRef = { value: "user:org-a@1" };
  const flush = deferredResult();
  const phases = [];
  const model = pushRaceModel({ tokenRef, flush });
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState: (patch) => phases.push(patch.phase),
  };

  const pending = autoSync.call(controller);
  await new Promise((resolve) => setImmediate(resolve));
  tokenRef.value = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  flush.reject(new Error("org A outbox failed"));

  assert.deepEqual(await pending, {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(phases, []);
});

test("duplicate_plan_repair_from_workspace_a_cannot_resume_sync_in_workspace_b", async () => {
  const tokenRef = { value: "user:org-a@1" };
  const repair = deferredResult();
  let repairOffered = true;
  const builds = [];
  const model = pushRaceModel({
    tokenRef,
    build: () => { builds.push(tokenRef.value); return null; },
  });
  model.repairPendingDuplicatePlanVersions = () => {
    if (!repairOffered) return null;
    repairOffered = false;
    return repair.promise;
  };
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState() {},
  };

  const pending = autoSync.call(controller);
  await new Promise((resolve) => setImmediate(resolve));
  tokenRef.value = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  repair.resolve({ duplicatePlanIds: ["plan-a-duplicate"] });

  assert.deepEqual(await pending, {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(builds, []);
});

test("workspace_b_does_not_reuse_workspace_a_sync_repair_promise", async () => {
  const tokenRef = { value: "user:org-a@1" };
  const repairA = deferredResult();
  const repairB = deferredResult();
  const model = pushRaceModel({ tokenRef });
  model.repairPendingDuplicatePlanVersions = () => (
    tokenRef.value.endsWith("@1") ? repairA.promise : repairB.promise
  );
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState() {},
  };

  const pendingA = autoSync.call(controller);
  tokenRef.value = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  const pendingB = autoSync.call(controller);

  assert.notEqual(pendingB, pendingA);
  repairA.resolve({ duplicatePlanIds: ["a"] });
  repairB.resolve({ duplicatePlanIds: ["b"] });
  const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
  assert.equal(resultA.workspaceChanged, true);
  assert.equal(resultB.ok, true);
});

test("workspace_b_does_not_reuse_workspace_a_auto_sync_promise", async () => {
  const previousFetch = globalThis.fetch;
  const tokenRef = { value: "user:org-a@1" };
  const requests = [];
  globalThis.fetch = () => {
    const request = deferredResult();
    requests.push(request);
    return request.promise;
  };
  const model = pushRaceModel({
    tokenRef,
    build: () => ({
      payload: { goithau: [{ id: `package-${tokenRef.value}` }] },
      snapshot: { id: `receipt-${tokenRef.value}` },
    }),
  });
  model.clearCommittedMutationBatch = () => {};
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState() {},
  };

  try {
    const pendingA = autoSync.call(controller);
    await new Promise((resolve) => setImmediate(resolve));
    tokenRef.value = "user:org-a@2";
    model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
    const pendingB = autoSync.call(controller);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(requests.length, 2, "new workspace epoch waited for the old push promise");
    requests[0].resolve(new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    requests[1].resolve(new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
    assert.equal(resultA.stale, true);
    assert.equal(resultB.ok, true);
  } finally {
    requests.forEach((request) => request.resolve?.(new Response("{}", { status: 200 })));
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("permission matrix mutation waits for manager persona instead of being rejected", async () => {
  const previousFetch = globalThis.fetch;
  const phases = [];
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error("permission mutation must not leave the browser under super admin persona");
  };
  const model = {
    state: { activerole: "super_admin" },
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: { setItem() {}, removeItem() {} },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (candidate) => candidate === "user:org-a@1",
    getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
    repairPendingDuplicatePlanVersions: () => null,
    buildMutationSyncPayload: () => ({
      payload: {
        permissionmatrix: [{
          id: "perm-pending",
          empId: "employee-1",
          kehoach: "view",
        }],
        clientMutationId: "mutation-permission",
        baseSyncVersion: "1",
        deletions: [],
      },
      snapshot: { id: "receipt-permission" },
    }),
  };
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState: (patch) => phases.push(patch),
  };

  try {
    assert.deepEqual(await autoSync.call(controller), {
      ok: true,
      skipped: true,
      localMutationsPending: true,
      requiredActiveRole: "manager",
    });
    assert.equal(fetchCount, 0);
    assert.equal(phases.at(-1)?.phase, "localPending");
    assert.match(phases.at(-1)?.message || "", /Quản lý/u);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});


test("sync status distinguishes durable, pending, validation, transport, and offline states", () => {
  assert.equal(deriveSyncStatus({ phase: "serverSaved", lastSyncedAt: 1 }).state, "server-saved");
  assert.deepEqual(deriveSyncStatus({ phase: "localPending" }), {
    state: "local-pending",
    label: "Đã lưu cục bộ · Chờ đồng bộ",
    assertive: false,
  });
  assert.equal(deriveSyncStatus({ phase: "validationRejected" }).state, "validation-rejected");
  assert.equal(deriveSyncStatus({ phase: "transportError" }).state, "transport-error");
  assert.equal(deriveSyncStatus({ phase: "serverSaved", online: false }).state, "offline");
  assert.deepEqual(deriveSyncStatus({ phase: "serverSaved", recoveryCount: 2 }), {
    state: "recovery-pending",
    label: "2 bản nháp cần phục hồi",
    assertive: false,
  });
});


test("pending-count notifications do not erase actionable sync failures", () => {
  for (const phase of [
    "transportError",
    "conflict",
    "validationRejected",
    "storageError",
    "error",
  ]) {
    assert.equal(shouldShowLocalPending(phase), false, phase);
  }
  assert.equal(shouldShowLocalPending("idle"), true);
  assert.equal(shouldShowLocalPending("serverSaved"), true);
});


test("sync activity is settled only after queued work and outbox durability finish", () => {
  const controller = {
    _autoSyncPromise: null,
    _syncImmediateTimer: null,
    _autoSyncQueued: false,
    _deferImmediateSync: false,
    _pendingMutationCount: 1,
    _syncUxState: { phase: "transportError" },
    model: {
      buildMutationSyncPayload: () => ({ payload: { upserts: [{}] } }),
      getMutationOutboxStatus: () => ({ state: "ready" }),
    },
  };

  assert.deepEqual(getSyncActivitySnapshot(controller), {
    settled: true,
    phase: "transportError",
    hasPendingMutations: true,
  });

  for (const activeState of [
    { _autoSyncPromise: Promise.resolve() },
    { _manualSyncPromise: Promise.resolve() },
    { _startupReconciliationPromise: Promise.resolve() },
    { _syncImmediateTimer: 1 },
    { _autoSyncQueued: true },
    { _deferImmediateSync: true },
    { _backgroundSyncRunning: true },
  ]) {
    assert.equal(
      getSyncActivitySnapshot({ ...controller, ...activeState }).settled,
      false,
    );
  }

  assert.equal(getSyncActivitySnapshot({
    ...controller,
    model: {
      ...controller.model,
      getMutationOutboxStatus: () => ({ state: "pending" }),
    },
  }).settled, false);

  assert.equal(getSyncActivitySnapshot({
    ...controller,
    model: {
      ...controller.model,
      _workspaceMutations: new Set([{}]),
    },
  }).settled, false);
});

function modelWithColdCachePatch() {
  const model = new BiddingModel();
  model.state.thongtinmothau = [];
  model._getMutationOutbox().restore({
    queue: {
      baseSyncVersion: "8",
      clientMutationId: "cold-cache-patch",
      dirtyTables: {},
      upserts: {},
      patches: {
        thongtinmothau: {
          "bid-1": {
            id: "bid-1",
            rowVersion: 4,
            danhGiaHopLe: "Đạt",
          },
        },
      },
      deletes: [],
      revision: 3,
    },
    localDeletions: [],
  });
  return model;
}

function activityModel(model) {
  return {
    buildMutationSyncPayload: () => model.buildMutationSyncPayload(),
    getMutationOutboxStatus: () => ({ state: "ready" }),
    hasPendingMutationOutboxChanges: () => model.hasPendingMutationOutboxChanges(),
  };
}

test("successful push row versions update canonical state, durable store, and newer outbox work", async () => {
  const writes = [];
  const queued = [];
  const model = new BiddingModel();
  model.state.goithau = [{ id: "package-1", rowVersion: 4, tenGoiThau: "Local" }];
  model.db = {
    stores: ["goithau"],
    async putRecord(table, record) { writes.push([table, structuredClone(record)]); },
  };
  model._getMutationOutbox = () => ({
    enqueue(operation) { queued.push(structuredClone(operation)); },
  });

  await model.applyCommittedRowVersions([
    { table: "goithau", id: "package-1", rowVersion: 5 },
  ]);

  assert.equal(model.state.goithau[0].rowVersion, 5);
  assert.deepEqual(writes, [["goithau", {
    id: "package-1", rowVersion: 5, tenGoiThau: "Local",
  }]]);
  assert.deepEqual(queued, [{
    kind: "server-row-version",
    entries: [{ table: "goithau", id: "package-1", rowVersion: 5 }],
  }]);
});

test("model persists server recovery before clearing and flushing the active outbox", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-1",
      baseSyncVersion: "11",
      dirtyTables: {},
      upserts: { assignments: { "assignment-1": { id: "assignment-1" } } },
      patches: {},
      deletes: [],
      revision: 1,
    },
    localDeletions: [],
  };
  const calls = [];
  let savedCheckpoint = null;
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => structuredClone(checkpoint),
    discard() { calls.push("discard"); return true; },
    async flush() { calls.push("flush"); },
  });
  model._captureServerConflictDrafts = async (value) => {
    savedCheckpoint = structuredClone(value);
    return [{ id: "recovery-1" }];
  };

  const draft = await model.quarantineMutationBatch({ data: {}, snapshot: { id: "receipt-1" } });

  assert.equal(draft.id, "recovery-1");
  assert.deepEqual(calls, ["discard", "flush"]);
  assert.deepEqual(savedCheckpoint, checkpoint);
});

test("row conflict quarantine keeps unrelated records from the same receipt active", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const sentCheckpoint = {
    queue: {
      clientMutationId: "mutation-xy", baseSyncVersion: "11", revision: 2,
      dirtyTables: {},
      upserts: {
        goithau: {
          "package-x": { id: "package-x", rowVersion: 1, tenGoiThau: "X" },
          "package-y": { id: "package-y", rowVersion: 2, tenGoiThau: "Y" },
          "package-z": { id: "package-z", rowVersion: 3, tenGoiThau: "Z" },
        },
      },
      patches: {}, deletes: [],
    },
    localDeletions: [],
  };
  const calls = [];
  let quarantined = null;
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => structuredClone(sentCheckpoint),
    checkpointForReceipt: () => structuredClone(sentCheckpoint),
    ack() { calls.push("ack"); return true; },
    enqueue(command) { calls.push(["enqueue", structuredClone(command)]); return true; },
    async flush() { calls.push("flush"); },
  });
  model._captureServerConflictDrafts = async (checkpoint) => {
    quarantined = structuredClone(checkpoint);
    return [{ id: "conflict-x" }];
  };

  const result = await model.quarantineMutationBatch({
    data: {
      errors: [
        { table: "goithau", id: "package-x", code: "ROW_VERSION_CONFLICT" },
        { table: "goithau", id: "package-y", code: "HISTORICAL_RECORD_IMMUTABLE" },
      ],
    },
    snapshot: { id: "receipt-xy" },
  });

  assert.equal(result.id, "conflict-x");
  assert.deepEqual(Object.keys(quarantined.queue.upserts.goithau), ["package-x", "package-y"]);
  assert.deepEqual(calls, [
    "ack",
    ["enqueue", {
      kind: "upsert",
      table: "goithau",
      records: [{ id: "package-z", rowVersion: 3, tenGoiThau: "Z" }],
      baseRecords: [],
    }],
    "flush",
  ]);
});

test("model never clears the active outbox when recovery persistence fails", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const calls = [];
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => ({
      queue: {
        clientMutationId: "mutation-1",
        dirtyTables: {},
        upserts: { goithau: { "package-1": { id: "package-1" } } },
        patches: {},
        deletes: [],
      },
      localDeletions: [],
    }),
    discard() { calls.push("discard"); },
    async flush() { calls.push("flush"); },
  });
  model._captureServerConflictDrafts = async () => [];

  assert.equal(await model.quarantineMutationBatch({ data: {} }), null);
  assert.deepEqual(calls, []);
});

test("model quarantines a row conflict for the session when conflict center is unavailable", async () => {
  const sentCheckpoint = {
    queue: {
      clientMutationId: "mutation-session",
      baseSyncVersion: "12",
      revision: 3,
      dirtyTables: {},
      upserts: {
        goithau: {
          "package-conflict": { id: "package-conflict", rowVersion: 2 },
          "package-unrelated": { id: "package-unrelated", rowVersion: 4 },
        },
      },
      patches: {},
      deletes: [],
    },
    localDeletions: [],
  };
  const calls = [];
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => structuredClone(sentCheckpoint),
    checkpointForReceipt: () => structuredClone(sentCheckpoint),
    ack(receipt) { calls.push(["ack", receipt.id]); return true; },
    enqueue(command) { calls.push(["enqueue", structuredClone(command)]); return true; },
    async flush() { calls.push(["flush"]); },
  });
  model._captureServerConflictDrafts = async () => {
    assert.fail("an unsupported session must not call conflict-center capture");
  };

  const result = await model.quarantineMutationBatch({
    data: {
      errors: [{
        table: "goi_thau",
        id: "package-conflict",
        code: "ROW_VERSION_CONFLICT",
      }],
    },
    snapshot: { id: "receipt-session" },
  });

  assert.deepEqual(result, { sessionOnly: true });
  assert.deepEqual(calls, [
    ["ack", "receipt-session"],
    ["enqueue", {
      kind: "upsert",
      table: "goithau",
      records: [{ id: "package-unrelated", rowVersion: 4 }],
      baseRecords: [],
    }],
    ["flush"],
  ]);
});

test("model restores the active outbox when quarantine flushing fails", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-rollback",
      dirtyTables: {},
      upserts: { goithau: { "package-1": { id: "package-1" } } },
      patches: {},
      deletes: [],
    },
    localDeletions: [],
  };
  const calls = [];
  let flushCount = 0;
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => structuredClone(checkpoint),
    discard() { calls.push("discard"); },
    restore(value) { calls.push(["restore", value]); return true; },
    async flush() {
      flushCount += 1;
      calls.push(`flush-${flushCount}`);
      if (flushCount === 1) throw new Error("disk unavailable");
    },
  });
  const removed = [];
  model._captureServerConflictDrafts = async () => [{ id: "recovery-rollback" }];
  model._getConflictRecoveryStore = () => ({
    remove(id) { removed.push(id); return true; },
  });

  assert.equal(await model.quarantineMutationBatch({ data: {} }), null);
  assert.deepEqual(calls, ["discard", "flush-1", ["restore", checkpoint], "flush-2"]);
  assert.deepEqual(removed, ["recovery-rollback"]);
});

test("hydrated_patch_without_loaded_canonical_record_is_still_reported_pending", () => {
  const model = modelWithColdCachePatch();

  assert.equal(model.buildMutationSyncPayload(), null);
  assert.equal(model.hasPendingMutationOutboxChanges(), true);
});

test("unsendable_patch_does_not_make_sync_activity_settled", async () => {
  const model = modelWithColdCachePatch();

  assert.deepEqual(getSyncActivitySnapshot({ model: activityModel(model) }), {
    settled: false,
    phase: "idle",
    hasPendingMutations: true,
  });
});

test("after_canonical_hydration_patch_becomes_sendable_without_duplicate_queue_entry", () => {
  const model = modelWithColdCachePatch();
  model.state.thongtinmothau = [{ id: "bid-1", rowVersion: 4, tenNhaThau: "preserved" }];

  const sent = model.buildMutationSyncPayload();

  assert.deepEqual(sent.payload.thongtinmothau, [{
    id: "bid-1",
    expectedVersion: 4,
    tenNhaThau: "preserved",
    danhGiaHopLe: "Đạt",
  }]);
  assert.deepEqual(Object.keys(model.getMutationQueue().patches.thongtinmothau), ["bid-1"]);
});

test("after_patch_ack_sync_activity_can_become_settled", async () => {
  const model = modelWithColdCachePatch();
  model.state.thongtinmothau = [{ id: "bid-1", rowVersion: 4 }];
  const sent = model.buildMutationSyncPayload();
  model.clearCommittedMutationBatch(sent.snapshot);

  assert.deepEqual(getSyncActivitySnapshot({ model: activityModel(model) }), {
    settled: true,
    phase: "idle",
    hasPendingMutations: false,
  });
});

test("auto_sync_keeps_local_pending_phase_when_raw_outbox_is_temporarily_unsendable", async () => {
  const phases = [];
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      isWorkspaceCurrent: () => true,
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      hasPendingMutationOutboxChanges: () => true,
      buildMutationSyncPayload: () => null,
    },
    updateSyncState(patch) { phases.push(patch); },
  };

  const result = await autoSync.call(controller);

  assert.equal(result.skipped, true);
  assert.equal(result.localMutationsPending, true);
  assert.equal(phases.at(-1).phase, "localPending");
  assert.equal(phases.some((patch) => patch.phase === "idle"), false);
});

test("auto sync repairs a duplicate pending plan before building its payload", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => {
        calls.push("repair");
        return Promise.resolve({ duplicatePlanIds: ["plan-duplicate"] });
      },
      buildMutationSyncPayload: () => {
        calls.push("build");
        return null;
      },
    },
    autoSync,
    updateSyncState(state) {
      calls.push(state.phase);
    },
  };

  const result = await autoSync.call(controller);

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(calls, ["repair", "build", "idle"]);
});

test("automatic push waits behind startup authoritative reconciliation", async () => {
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  let phase = "RECONCILING";
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => null,
      buildMutationSyncPayload: () => {
        calls.push("build");
        return null;
      },
    },
    autoSync,
    getStartupReconciliationState: () => ({ phase, promise: barrier }),
    updateSyncState(state) { calls.push(state.phase); },
  };

  const pending = autoSync.call(controller);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  phase = "RECONCILED";
  releaseBarrier(true);

  assert.deepEqual(await pending, { ok: true, skipped: true });
  assert.deepEqual(calls, ["build", "idle"]);
});

test("startup replay preserves its reconciliation authority after pending outbox flush", async () => {
  let durabilityState = "pending";
  let barrierAwaited = false;
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      isWorkspaceCurrent: () => true,
      getMutationOutboxStatus: () => ({
        state: durabilityState,
        trusted: durabilityState === "ready",
      }),
      async flushMutationOutbox() { durabilityState = "ready"; },
      repairPendingDuplicatePlanVersions: () => null,
      buildMutationSyncPayload: () => null,
      hasPendingMutationOutboxChanges: () => false,
    },
    autoSync,
    getStartupReconciliationState: () => ({
      phase: "RECONCILING",
      promise: {
        then() { barrierAwaited = true; },
      },
    }),
    updateSyncState() {},
  };

  const result = await Promise.race([
    autoSync.call(controller, { startupReconciliation: true }),
    new Promise((resolve) => setImmediate(() => resolve({ timedOut: true }))),
  ]);

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(barrierAwaited, false);
});

test("startup replay preserves its reconciliation authority after outbox repair", async () => {
  let repairRequired = true;
  let barrierAwaited = false;
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-1" },
      getWorkspaceToken: () => "workspace-1",
      isWorkspaceCurrent: () => true,
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => {
        if (!repairRequired) return null;
        repairRequired = false;
        return Promise.resolve({ duplicatePlanIds: ["plan-duplicate"] });
      },
      buildMutationSyncPayload: () => null,
      hasPendingMutationOutboxChanges: () => false,
    },
    autoSync,
    getStartupReconciliationState: () => ({
      phase: "RECONCILING",
      promise: {
        then() { barrierAwaited = true; },
      },
    }),
    updateSyncState() {},
  };

  const result = await Promise.race([
    autoSync.call(controller, { startupReconciliation: true }),
    new Promise((resolve) => setImmediate(() => resolve({ timedOut: true }))),
  ]);

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.equal(barrierAwaited, false);
});

test("automatic push cannot replay a mutation after startup reconciliation conflicts", async () => {
  const previousFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ status: "success" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => null,
      buildMutationSyncPayload: () => ({
        payload: { chuyengia: [{ id: "expert-1" }] },
        snapshot: { id: "receipt-1" },
      }),
    },
    autoSync,
    getStartupReconciliationState: () => ({ phase: "CONFLICT" }),
    updateSyncState() {},
  };

  try {
    const result = await autoSync.call(controller);

    assert.deepEqual(result, {
      ok: false,
      conflict: true,
      reconciliationRequired: true,
    });
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("queued automatic sync does not retry an actionable transport failure", async () => {
  const previousFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  let fetchCalls = 0;
  console.error = () => {};
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new TypeError("simulated transport failure");
  };
  const phases = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
      repairPendingDuplicatePlanVersions: () => null,
      buildMutationSyncPayload: () => ({
        payload: { chuyengia: [{ id: "expert-1" }] },
        snapshot: { id: "receipt-1" },
      }),
    },
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState(patch) { phases.push(patch.phase); },
  };

  try {
    const first = autoSync.call(controller);
    const queued = autoSync.call(controller);
    const [firstResult, queuedResult] = await Promise.all([first, queued]);

    assert.equal(firstResult.ok, false);
    assert.equal(queuedResult.ok, false);
    assert.equal(fetchCalls, 1);
    assert.equal(controller._autoSyncQueued, false);
    assert.equal(phases.at(-1), "transportError");
  } finally {
    console.error = originalConsoleError;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("late_transport_failure_from_workspace_a_cannot_update_workspace_b", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const originalConsoleError = console.error;
  let rejectSync;
  const syncRequest = new Promise((_resolve, reject) => {
    rejectSync = reject;
  });
  let resolveDiagnostic;
  const diagnosticPosted = new Promise((resolve) => {
    resolveDiagnostic = resolve;
  });
  const diagnostics = [];
  globalThis.document = { cookie: "csrf_token=test" };
  console.error = () => {};
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/api/client-errors")) {
      diagnostics.push(JSON.parse(options.body));
      resolveDiagnostic();
      return new Response(null, { status: 204 });
    }
    return syncRequest;
  };

  let token = "user:org-a@1";
  const patches = [];
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
    repairPendingDuplicatePlanVersions: () => null,
    buildMutationSyncPayload: () => ({
      payload: { goithau: [{ id: "package-1", rowVersion: 4 }] },
      snapshot: { id: "receipt-org-a" },
    }),
  };
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState(patch) { patches.push(patch); },
  };

  try {
    const push = autoSync.call(controller);
    await new Promise((resolve) => setImmediate(resolve));
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    patches.length = 0;
    const error = Object.assign(new TypeError("org A transport failed"), {
      requestId: "request-org-a",
    });
    rejectSync(error);

    const result = await push;
    await diagnosticPosted;
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(patches, []);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].workspaceHash, await hashWorkspaceScope("user:org-a"));
    assert.notEqual(diagnostics[0].workspaceHash, await hashWorkspaceScope("user:org-b"));
  } finally {
    rejectSync?.(new Error("cleanup"));
    console.error = originalConsoleError;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("terminal validation flushes the rejected batch and keeps an actionable validation state", async () => {
  const calls = [];
  const originalConsoleError = console.error;
  console.error = () => {};
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: { setItem() {}, removeItem() {} },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      state: { goithau: [] },
      discardRejectedMutations(errors, snapshot, options) {
        calls.push(["discard", errors, snapshot, options]);
        return [{ type: "goithau", id: "package-1", operation: "upsert", conflictingId: "" }];
      },
      async flushMutationOutbox() { calls.push(["flush"]); },
      buildMutationSyncPayload: () => null,
      db: { async deleteRecord() {} },
    },
    async fetchRecordByLookup() { return null; },
    updateSyncState(state) { calls.push(["state", state.phase]); },
  };

  try {
    const result = await applyFailedPush(controller, {
      status: 400,
      data: {
        status: "error",
        errors: [{ field: "$record", code: "HISTORICAL_PARENT_IMMUTABLE", message: "Rejected" }],
      },
      snapshot: { id: "receipt-1" },
    });

    assert.equal(result.validation, true);
    assert.equal(calls.some(([kind]) => kind === "flush"), true);
    assert.deepEqual(calls.at(-1), ["state", "validationRejected"]);
    assert.deepEqual(calls[0][3], { fallbackToBatch: true });
  } finally {
    console.error = originalConsoleError;
  }
});

test("row-version rejection remains conflict and does not acknowledge the local outbox", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: { setItem() {} },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      discardRejectedMutations() {
        calls.push("discard");
        return [];
      },
    },
    updateSyncState(state) { calls.push(["state", state.phase]); },
    view: {
      showToast(_title, _message, kind) { calls.push(["toast", kind]); },
    },
  };

  const result = await applyFailedPush(controller, {
    status: 409,
    data: {
      status: "conflict",
      currentSyncVersion: 12,
      errors: [{
        table: "goithau",
        id: "package-1",
        code: "ROW_VERSION_CONFLICT",
        serverRecord: { id: "package-1", maGoiThau: "PKG-1" },
      }],
    },
    snapshot: { id: "receipt-1" },
  });

  assert.equal(result.conflict, true);
  assert.equal(calls.includes("discard"), false);
  assert.equal(calls.some((call) => call[0] === "state" && call[1] === "conflict"), true);
});

test("row-version rejection is quarantined without blocking later syncs", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: { setItem() {} },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      async quarantineMutationBatch(details) {
        calls.push(["quarantine", details]);
        return { id: "recovery-1" };
      },
    },
    updateSyncState(state) { calls.push(["state", state.phase]); },
    view: {
      showToast(title, _message, kind) { calls.push(["toast", title, kind]); },
    },
  };
  const data = {
    status: "conflict",
    currentSyncVersion: 12,
    errors: [{
      table: "assignments",
      id: "assignment-1",
      code: "ROW_VERSION_CONFLICT",
      serverRecord: { id: "assignment-1" },
    }],
  };
  const snapshot = { id: "receipt-1" };

  const result = await applyFailedPush(controller, { status: 409, data, snapshot });

  assert.equal(result.conflictQuarantined, true);
  assert.equal(result.conflict, undefined);
  assert.equal(result.recoveryDraftId, "recovery-1");
  assert.deepEqual(calls[0], ["quarantine", { data, snapshot }]);
  assert.equal(calls.some((call) => call[0] === "state" && call[1] === "conflict"), true);
  assert.equal(calls.some((call) => call[0] === "state" && call[1] === "recoveryPending"), false);
});

test("session-only row conflict requires reload without entering generic conflict resolution", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: {
        setItem(key, value) { calls.push(["storage", key, value]); },
      },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      async quarantineMutationBatch(details) {
        calls.push(["quarantine", details]);
        return { sessionOnly: true };
      },
    },
    updateSyncState(state) { calls.push(["state", state]); },
    view: {
      showToast(title, message, kind) { calls.push(["toast", title, message, kind]); },
    },
  };
  const data = {
    status: "conflict",
    currentSyncVersion: 14,
    errors: [{
      table: "goi_thau",
      id: "package-1",
      code: "ROW_VERSION_CONFLICT",
    }],
  };
  const snapshot = { id: "receipt-session" };

  const result = await applyFailedPush(controller, { status: 409, data, snapshot });

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    data,
    conflictQuarantined: true,
    reloadRequired: true,
    sessionOnlyConflict: true,
  });
  assert.deepEqual(controller._syncConflict, {
    serverSyncVersion: 14,
    message: "Server data changed before local sync.",
    reloadRequired: true,
  });
  assert.equal(calls.some((call) => (
    call[0] === "storage"
    && call[1] === "bf_conflict_server_sync_version"
    && call[2] === "14"
  )), true);
  assert.equal(calls.some((call) => (
    call[0] === "toast"
    && call[1] === "Dữ liệu đã thay đổi trên máy chủ"
    && call[2].includes("Nhấn F5")
    && call[3] === "warning"
  )), true);
  assert.equal(calls.some((call) => call[0] === "state" && call[1].phase === "conflict"), true);
});

test("background auto sync keeps the visible state until F5 after quarantining a conflict", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const calls = [];
  globalThis.document = { cookie: "csrf_token=test" };
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: "conflict",
    currentSyncVersion: 12,
    errors: [{ table: "assignments", id: "assignment-1", code: "ROW_VERSION_CONFLICT" }],
  }), { status: 409, headers: { "content-type": "application/json" } });
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: { setItem() {} },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
    repairPendingDuplicatePlanVersions: () => null,
    buildMutationSyncPayload: () => ({
      payload: { assignments: [{ id: "assignment-1", expectedVersion: 3 }] },
      snapshot: { id: "receipt-1" },
    }),
    async quarantineMutationBatch() { return { id: "recovery-1" }; },
  };
  const controller = {
    model,
    autoSync,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    updateSyncState() {},
    async forceSyncData(_background, forceFull) {
      calls.push(["pull", forceFull]);
      return { ok: true, localMutationsPending: false };
    },
  };

  try {
    const result = await autoSync.call(controller);
    assert.equal(result.conflictQuarantined, true);
    assert.equal(result.authoritativeRefresh, undefined);
    assert.deepEqual(calls, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("idempotency key reuse renews the outbox identity without becoming a row conflict", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: { setItem() {} },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      renewMutationBatchIdentity() {
        calls.push("renew");
        return true;
      },
      async flushMutationOutbox() { calls.push("flush"); },
    },
    updateSyncState(state) { calls.push(["state", state.phase]); },
    view: {
      showToast(_title, _message, kind) { calls.push(["toast", kind]); },
    },
  };

  const result = await applyFailedPush(controller, {
    status: 409,
    data: {
      code: "IDEMPOTENCY_KEY_REUSED",
      message: "Mutation key was already used for different content.",
    },
    snapshot: { id: "receipt-reused" },
  });

  assert.equal(result.idempotencyKeyReused, true);
  assert.equal(result.conflict, undefined);
  assert.deepEqual(calls.slice(0, 2), ["renew", "flush"]);
  assert.equal(calls.some((call) => call[0] === "state" && call[1] === "conflict"), false);
});

test("double-click retry shares one push and one authoritative verification pull", async () => {
  let releasePush;
  const push = new Promise((resolve) => {
    releasePush = resolve;
  });
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    async autoSync() {
      calls.push("push");
      return push;
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  const first = runManualSyncRetry(controller);
  const second = runManualSyncRetry(controller);
  assert.equal(first, second);
  assert.deepEqual(calls, ["push"]);
  releasePush({ ok: true });
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(calls, ["push", "pull"]);
});

test("manual sync does not apply a quarantined row-conflict draft", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      hasMutationOutboxDurabilityFailure: () => false,
      hasStorageReadFailures: () => false,
      hasPendingMutationOutboxChanges: () => false,
      getConflictRecoveryCount: () => 1,
      getConflictRecoveryDrafts: () => [{ id: "recovery-1" }],
      async restoreConflictRecoveryDraft(id) {
        calls.push(["restore", id]);
        return { ok: true };
      },
    },
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    view: {
      async customRecoveryDialog() {
        calls.push("dialog");
        return "apply";
      },
      showToast(title, _message, kind) { calls.push(["toast", title, kind]); },
    },
    async forceSyncData(_background, forceFull) {
      calls.push(["pull", forceFull]);
      return { ok: true, localMutationsPending: forceFull };
    },
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
    updateSyncState(state) { calls.push(["state", state.phase]); },
  };

  const result = await runManualSyncRetry(controller);

  assert.equal(result.ok, false);
  assert.equal(result.reloadRequired, true);
  assert.equal(calls.includes("dialog"), false);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "restore"), false);
  assert.equal(calls.includes("push"), false);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "pull"), false);
  assert.equal(calls.at(-1)[0], "toast");
});

test("startup error retry reuses reconciliation verification without a duplicate pull", async () => {
  const calls = [];
  let phase = "SYNC_ERROR";
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
    getStartupReconciliationState: () => ({ phase }),
    async reconcileInitialRouteData() {
      calls.push("reconcile");
      phase = "RECONCILED";
      return true;
    },
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  assert.deepEqual(await runManualSyncRetry(controller), { ok: true, reconciled: true });
  assert.deepEqual(calls, ["reconcile"]);
});

test("retry completion from workspace A cannot verify or clear state in workspace B", async () => {
  let releasePush;
  const push = new Promise((resolve) => {
    releasePush = resolve;
  });
  let token = "user:org-a@1";
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
    },
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    async autoSync() { return push; },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  const retry = runManualSyncRetry(controller);
  token = "user:org-b@2";
  controller.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  releasePush({ ok: true });

  assert.deepEqual(await retry, {
    ok: false,
    stale: true,
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(calls, []);
});

test("workspace_b_does_not_reuse_workspace_a_manual_retry_promise", async () => {
  const pushA = deferredResult();
  let token = "user:org-a@1";
  const autoCalls = [];
  const pullCalls = [];
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: { setItem() {}, removeItem() {} },
    syncErrors: [],
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    hasMutationOutboxDurabilityFailure: () => false,
    hasStorageReadFailures: () => false,
  };
  const controller = {
    model,
    getStartupReconciliationState: () => ({ phase: "RECONCILED" }),
    autoSync() {
      autoCalls.push(token);
      return token === "user:org-a@1" ? pushA.promise : Promise.resolve({ ok: true });
    },
    forceSyncData() {
      pullCalls.push(token);
      return Promise.resolve({ ok: true });
    },
  };

  const retryA = runManualSyncRetry(controller);
  await new Promise((resolve) => setImmediate(resolve));
  token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model.workspaceStorage = { setItem() {}, removeItem() {} };
  const retryB = runManualSyncRetry(controller);
  await new Promise((resolve) => setImmediate(resolve));

  assert.notEqual(retryB, retryA);
  assert.deepEqual(autoCalls, ["user:org-a@1", "user:org-b@2"]);
  assert.equal((await retryB).ok, true);
  assert.deepEqual(pullCalls, ["user:org-b@2"]);

  pushA.resolve({ ok: true });
  const resultA = await retryA;
  assert.equal(resultA.workspaceChanged, true);
});
