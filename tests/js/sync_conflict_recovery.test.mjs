import assert from "node:assert/strict";
import test from "node:test";

import {
  awaitAuthoritativeMutationBoundary,
  getStartupReconciliationState,
  initializeStartupReconciliation,
  reconcileRouteDataAtStartup,
  scheduleInitialRouteReconciliation,
  STARTUP_RECONCILIATION_PHASE,
  transitionStartupReconciliation,
} from "../../frontend/app/startupReconciliation.js";
import {
  finalizePulledSyncState,
  resolvePendingSyncConflict,
  resolveRowVersionConflicts,
} from "../../frontend/app/BiddingControllerSync.js";
import { runManualSyncRetry } from "../../frontend/app/SyncCoordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function withNavigatorOnline(value, callback) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: value },
  });
  return Promise.resolve(callback()).finally(() => {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
    else delete globalThis.navigator;
  });
}


test("startup does not submit the same mutation again after a conflict", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, conflict: true, status: 409 };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  const result = await reconcileRouteDataAtStartup(controller);

  assert.equal(result, false);
  assert.deepEqual(calls, ["push", "pull"]);
});

test("manual retry cannot resubmit a batch after startup entered conflict", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      hasPendingMutationOutboxChanges: () => true,
      buildMutationSyncPayload: () => ({ payload: {}, snapshot: { id: "receipt-1" } }),
    },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, conflict: true, status: 409 };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
    view: { showToast() { calls.push("toast"); } },
  };
  controller.getStartupReconciliationState = () => getStartupReconciliationState(controller);
  controller.reconcileInitialRouteData = () => reconcileRouteDataAtStartup(controller);

  assert.equal(await reconcileRouteDataAtStartup(controller), false);
  assert.equal(getStartupReconciliationState(controller).phase, "CONFLICT");
  const retry = await runManualSyncRetry(controller);

  assert.equal(retry.reloadRequired, true);
  assert.deepEqual(
    calls.filter((entry) => entry === "push"),
    ["push"],
    "the rejected receipt must not be submitted again before F5",
  );
});

test("startup rebases and replays a preserved outbox after idempotency key reuse", async () => {
  const calls = [];
  let pushCount = 0;
  const controller = {
    model: { workspaceScope: { key: "user:org-a" } },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      pushCount += 1;
      return pushCount === 1
        ? { ok: false, status: 409, idempotencyKeyReused: true }
        : { ok: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: true };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), true);
  assert.deepEqual(calls, ["push", "pull", "push"]);
});

test("startup pulls authoritative state and completes after quarantining a row conflict", async () => {
  const calls = [];
  const controller = {
    model: { workspaceScope: { key: "user:org-a" } },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, status: 409, conflictQuarantined: true, recoveryDraftId: "recovery-1" };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), true);
  assert.deepEqual(calls, ["push", "pull"]);
  assert.equal(getStartupReconciliationState(controller).phase, "RECONCILED");
});

test("F5 retains conflict references without replay and preserves unrelated outbox work", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getConflictRecoveryCount: () => 1,
    },
    markStartup() {},
    async forceSyncData(_background, forceFull) {
      calls.push(["pull", forceFull]);
      return { ok: true, localMutationsPending: true };
    },
    async autoSync() {
      calls.push("push-unrelated");
      return { ok: true };
    },
    view: {
      customRecoveryDialog() { assert.fail("reload must not ask to restore a conflict draft"); },
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), true);
  assert.deepEqual(calls, [["pull", true], "push-unrelated"]);
});


test("startup flushes once, pulls once, and skips an empty replay", async () => {
  const calls = [];
  const telemetry = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true, skipped: calls.length === 1 };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller, {
    reportRetry: (details) => telemetry.push(["retry", details]),
  }), true);
  assert.deepEqual(calls, ["push", "pull"]);
  assert.deepEqual(telemetry, []);
});


test("startup replays only mutations produced while reconciling the pull", async () => {
  const calls = [];
  const telemetry = [];
  const controller = {
    model: { workspaceScope: { key: "user:org-a" } },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: true };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller, {
    reportRetry: (details) => telemetry.push(["retry", details]),
  }), true);
  assert.deepEqual(calls, ["push", "pull", "push"]);
  assert.deepEqual(telemetry, [["retry", { workspaceKey: "user:org-a" }]]);
});

test("stale-window mutation is pulled before its first push", async () => {
  const calls = [];
  let generation = 0;
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      getMutationOutboxGeneration: () => generation,
    },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: true };
    },
  };

  await withNavigatorOnline(true, async () => {
    initializeStartupReconciliation(controller);
    generation = 1;
    assert.equal(await reconcileRouteDataAtStartup(controller), true);
    assert.deepEqual(calls, ["pull", "push"]);
  });
});

test("startup reconciliation exposes an operation-backed state contract", async () => {
  const pull = deferred();
  const model = {
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
  };
  const controller = {
    model,
    markStartup() {},
    async autoSync() { return { ok: true, skipped: true }; },
    async forceSyncData() { return pull.promise; },
  };

  await withNavigatorOnline(true, async () => {
    initializeStartupReconciliation(controller);
    assert.equal(
      getStartupReconciliationState(controller).phase,
      STARTUP_RECONCILIATION_PHASE.LOCAL_READY,
    );

    const reconciliation = reconcileRouteDataAtStartup(controller);
    assert.equal(
      getStartupReconciliationState(controller).phase,
      STARTUP_RECONCILIATION_PHASE.RECONCILING,
    );
    pull.resolve({ ok: true, localMutationsPending: false });
    assert.equal(await reconciliation, true);
    assert.equal(
      getStartupReconciliationState(controller).phase,
      STARTUP_RECONCILIATION_PHASE.RECONCILED,
    );
  });
});

test("offline startup allows only the explicit durable-local mutation boundary", async () => {
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
    async reconcileInitialRouteData() { calls.push("reconcile"); },
  };

  await withNavigatorOnline(false, async () => {
    initializeStartupReconciliation(controller);
    assert.deepEqual(await awaitAuthoritativeMutationBoundary(controller), {
      authoritative: false,
      offline: true,
    });
    assert.equal(
      getStartupReconciliationState(controller).phase,
      STARTUP_RECONCILIATION_PHASE.OFFLINE_LOCAL,
    );
    assert.deepEqual(calls, []);
  });
});

test("an unresolved startup conflict blocks authoritative mutation commit", async () => {
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
  };
  transitionStartupReconciliation(
    controller,
    STARTUP_RECONCILIATION_PHASE.RECONCILING,
    { workspaceToken: "user:org-a@1" },
  );
  transitionStartupReconciliation(
    controller,
    STARTUP_RECONCILIATION_PHASE.CONFLICT,
    { workspaceToken: "user:org-a@1" },
  );

  await assert.rejects(
    awaitAuthoritativeMutationBoundary(controller),
    (error) => error?.code === "STARTUP_RECONCILIATION_CONFLICT",
  );
});

test("startup state machine rejects impossible success without reconciliation", () => {
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
  };
  initializeStartupReconciliation(controller);

  assert.throws(
    () => transitionStartupReconciliation(
      controller,
      STARTUP_RECONCILIATION_PHASE.RECONCILED,
      { workspaceToken: "user:org-a@1" },
    ),
    (error) => error?.code === "INVALID_STARTUP_RECONCILIATION_TRANSITION",
  );
});

test("workspace_a_reconciliation_cannot_mutate_workspace_b_startup_state", async () => {
  const push = deferred();
  let token = "user:org-a@1";
  const model = {
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
  };
  const controller = {
    model,
    markStartup() {},
    async autoSync() { return push.promise; },
    async forceSyncData() {
      throw new Error("workspace A must stop before pulling into workspace B");
    },
  };

  await withNavigatorOnline(true, async () => {
    initializeStartupReconciliation(controller);
    const reconciliationA = reconcileRouteDataAtStartup(controller);
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    initializeStartupReconciliation(controller);
    push.resolve({ ok: true, skipped: true });

    assert.equal(await reconciliationA, false);
    const stateB = getStartupReconciliationState(controller);
    assert.equal(stateB.workspaceToken, "user:org-b@2");
    assert.equal(stateB.phase, STARTUP_RECONCILIATION_PHASE.LOCAL_READY);
  });
});

test("concurrent startup reconciliation requests share one push-pull pipeline", async () => {
  const push = deferred();
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return push.promise;
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  await withNavigatorOnline(true, async () => {
    initializeStartupReconciliation(controller);
    const first = reconcileRouteDataAtStartup(controller);
    const second = reconcileRouteDataAtStartup(controller);
    push.resolve({ ok: true, skipped: true });
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.deepEqual(calls, ["push", "pull"]);
  });
});


test("initial route reconciliation is deferred until the shell can become interactive", async () => {
  const calls = [];
  let scheduledTask = null;
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true, skipped: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  scheduleInitialRouteReconciliation(controller, (task, options) => {
    scheduledTask = task;
    calls.push(["scheduled", options]);
  });

  assert.deepEqual(calls, [["scheduled", {
    timeout: 2200,
    delay: 0,
    priority: "reconcile",
  }]]);
  assert.equal(typeof scheduledTask, "function");
  await scheduledTask();
  assert.deepEqual(calls.slice(1), ["push", "pull"]);
});

test("scheduled_reconciliation_from_workspace_a_does_not_start_after_switch_to_workspace_b", async () => {
  const calls = [];
  let scheduledA = null;
  let token = "user:org-a@1";
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
  };
  const controller = {
    model,
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true, skipped: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  initializeStartupReconciliation(controller);
  scheduleInitialRouteReconciliation(controller, (task) => {
    scheduledA = task;
  });
  assert.equal(typeof scheduledA, "function");

  token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  const stateB = initializeStartupReconciliation(controller);
  const promiseB = Promise.resolve("workspace-b-reconciliation");
  controller._startupReconciliationPromise = promiseB;

  assert.equal(await scheduledA(), false);
  assert.deepEqual(calls, []);
  assert.equal(getStartupReconciliationState(controller).phase, stateB.phase);
  assert.equal(getStartupReconciliationState(controller).workspaceToken, "user:org-b@2");
  assert.equal(controller._startupReconciliationPromise, promiseB);
});


test("caught startup reconciliation failure emits redacted structured context", async () => {
  const telemetry = [];
  const controller = {
    model: { workspaceScope: { key: "user:org-a" } },
    markStartup() {},
    async autoSync() {
      throw Object.assign(new Error("private row payload"), { requestId: "request-123" });
    },
  };

  const result = await reconcileRouteDataAtStartup(controller, {
    reportFailure: (details) => telemetry.push(details),
  });

  assert.equal(result, false);
  assert.deepEqual(telemetry, [{
    workspaceKey: "user:org-a",
    correlationId: "request-123",
  }]);
});


test("startup keeps the local snapshot without retrying after an offline initial push", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, error: new Error("offline") };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: false, error: new Error("offline") };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), false);
  assert.deepEqual(calls, ["push"]);
});

test("startup transport failure stays actionable and is not replayed automatically", async () => {
  const calls = [];
  const controller = {
    _syncUxState: { phase: "transportError", online: true },
    model: {
      workspaceScope: { key: "user:org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      getMutationOutboxGeneration: () => 1,
    },
    markStartup() {},
    updateSyncState(patch) {
      this._syncUxState = { ...this._syncUxState, ...patch };
    },
    async autoSync() {
      calls.push("push");
      return { ok: false, error: new TypeError("network unavailable") };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: true };
    },
  };

  await withNavigatorOnline(true, async () => {
    initializeStartupReconciliation(controller);
    assert.equal(await reconcileRouteDataAtStartup(controller), false);
    assert.equal(
      getStartupReconciliationState(controller).phase,
      STARTUP_RECONCILIATION_PHASE.SYNC_ERROR,
    );
  });

  assert.deepEqual(calls, ["push"]);
  assert.equal(controller._syncUxState.phase, "transportError");
  assert.equal(controller._syncUxState.online, true);
});


test("a successful pull cannot report synced while the outbox is pending", () => {
  const patches = [];
  const controller = {
    model: { buildMutationSyncPayload: () => ({ clientMutationId: "pending-1" }) },
    updateSyncState(patch) { patches.push(patch); },
  };

  assert.equal(finalizePulledSyncState(controller, 123), true);
  assert.deepEqual(patches, [{
    phase: "localPending",
    online: true,
    message: "Đã lưu cục bộ · Chờ đồng bộ",
  }]);
});


test("a background pull preserves an actionable interrupted-sync state while the outbox remains pending", () => {
  const patches = [];
  const controller = {
    _syncUxState: { phase: "transportError" },
    model: { buildMutationSyncPayload: () => ({ clientMutationId: "pending-1" }) },
    updateSyncState(patch) { patches.push(patch); },
  };

  assert.equal(finalizePulledSyncState(controller, 123), true);
  assert.deepEqual(patches, []);
});


test("a successful pull reports synced after the outbox is empty", () => {
  const patches = [];
  const controller = {
    model: { buildMutationSyncPayload: () => null },
    updateSyncState(patch) { patches.push(patch); },
  };

  assert.equal(finalizePulledSyncState(controller, 123), false);
  assert.deepEqual(patches, [{ phase: "serverSaved", online: true, lastSyncedAt: 123 }]);
});


test("row version conflicts preserve the local outbox until explicit resolution", async () => {
  const calls = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  const error = {
    table: "ke_hoach_lcnt",
    id: "plan-1",
    code: "ROW_VERSION_CONFLICT",
    serverRecord: { id: "plan-1", maKeHoach: "PL01", tenKeHoach: "Kế hoạch server" },
  };
  const controller = {
    model: {
      state: { kehoach: [] },
      discardRejectedMutations(errors, snapshot) {
        calls.push(["discard", errors, snapshot]);
        return [{ type: "kehoach", id: "plan-1", conflictingId: "" }];
      },
      db: { async deleteRecord() {} },
    },
    view: {
      showToast(title, message) { calls.push(["toast", title, message]); },
      customConflictDialog() { throw new Error("Conflict dialog must not open"); },
    },
    async fetchRecordByLookup(type, id) {
      calls.push(["fetch", type, id]);
      return error.serverRecord;
    },
  };

  try {
    const result = await resolveRowVersionConflicts(controller, {
      data: { errors: [error] },
      snapshot: { id: "receipt-1" },
    });

    assert.deepEqual(result, {
      resolved: false,
      choice: null,
      automatic: false,
      conflicts: 1,
      snapshot: { id: "receipt-1" },
    });
    assert.equal(calls.some(([kind]) => kind === "discard"), false);
    assert.equal(calls.some(([kind]) => kind === "fetch"), false);
    assert.equal(calls.some(([kind]) => kind === "toast"), true);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});


test("an unresolved sync conflict asks for F5 without retrying, discarding, or opening a dialog", async () => {
  const calls = [];
  const controller = {
    model: {
      buildMutationSyncPayload: () => ({ clientMutationId: "pending-1" }),
      discardMutationBatch() { calls.push("discard"); },
      async flushMutationOutbox() { calls.push("flush"); },
    },
    view: {
      async customConfirm(_title, _message, _icon, options) {
        calls.push(["confirm", options]);
        return true;
      },
      showToast(title, message) { calls.push(["toast", title, message]); },
    },
    async forceSyncData(_background, forceFull) {
      calls.push(["pull", forceFull]);
      return { ok: true };
    },
    async autoSync() {
      calls.push("retry");
      return { ok: false, conflict: true, status: 409 };
    },
  };

  const result = await resolvePendingSyncConflict(controller, {
    ok: false, conflict: true, status: 409,
  });

  assert.equal(result.conflictCleared, false);
  assert.equal(result.reloadRequired, true);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "confirm"), false);
  assert.equal(calls.includes("discard"), false);
  assert.equal(calls.includes("retry"), false);
  assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "pull"), false);
  assert.equal(calls.at(-1)[0], "toast");
});
