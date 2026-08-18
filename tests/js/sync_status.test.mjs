import assert from "node:assert/strict";
import test from "node:test";

import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";
import {
  getSyncActivitySnapshot,
  runManualSyncRetry,
  shouldShowLocalPending,
} from "../../frontend/app/SyncCoordinator.js";
import { applyFailedPush, autoSync } from "../../frontend/app/SyncPushService.js";
import { hashWorkspaceScope } from "../../frontend/shared/releaseDiagnostics.js";


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
      workspaceScope: { key: "user:org-a" },
      workspaceStorage: { setItem() {} },
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
    workspaceChanged: true,
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(calls, []);
});
