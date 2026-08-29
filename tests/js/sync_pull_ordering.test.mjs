import test from "node:test";
import assert from "node:assert/strict";

import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { autoSync } from "../../frontend/app/SyncPushService.js";
import { loadPaginatedRecords } from "../../frontend/shared/tableDataUtils.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function installPullGlobals(fetchImpl, pathname = "/goi-thau") {
  const previous = {
    fetch: globalThis.fetch,
    document: globalThis.document,
    window: globalThis.window,
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  globalThis.fetch = fetchImpl;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  return () => {
    if (previous.fetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previous.fetch;
    if (previous.document === undefined) delete globalThis.document;
    else globalThis.document = previous.document;
    if (previous.window === undefined) delete globalThis.window;
    else globalThis.window = previous.window;
    if (previous.navigator) {
      Object.defineProperty(globalThis, "navigator", previous.navigator);
    } else {
      delete globalThis.navigator;
    }
  };
}

function outboxSettleWorkspaceRaceController({ storageA, storageB, flush }) {
  let token = "user:org-a@1";
  let outboxPending = true;
  const patches = [];
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storageA,
    state: { goithau: [] },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    getMutationOutboxStatus: () => outboxPending
      ? { state: "pending", trusted: true }
      : { state: "ready", trusted: true },
    async flushMutationOutbox() {
      await flush.promise;
      outboxPending = false;
    },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    rebaseMutationBatch() {},
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState(patch) { patches.push(patch); },
    hasLocalWorkspaceData: () => true,
  };
  return {
    controller,
    patches,
    switchToB() {
      token = "user:org-b@2";
      model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
      model.workspaceStorage = storageB;
    },
    switchToSameOrgNewEpoch() {
      token = "user:org-a@2";
      model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
      model.workspaceStorage = storageB;
    },
  };
}

test("background pull never owns remaining IndexedDB hydration", async () => {
  const restore = installPullGlobals(async () => new Response(JSON.stringify({
    goithau: [{ id: "package-1", rowVersion: 2 }],
    syncVersion: 2,
    timestamp: "v2",
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const storage = memoryStorage();
  let hydrationCalls = 0;
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: { goithau: [] },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    rebaseMutationBatch() {},
    hydrateRemainingStorageKeysIdle() { hydrationCalls += 1; },
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };

  try {
    const result = await forceSyncData.call(controller, true, false, false);

    assert.equal(result.ok, true);
    assert.equal(
      hydrationCalls,
      0,
      "startup/workspace orchestration must release hydration after reconciliation and mutation replay",
    );
  } finally {
    restore();
  }
});

test("workspace_change_during_outbox_settle_cannot_touch_new_workspace_cursor", async () => {
  const flush = deferred();
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  storageB.setItem("bf_last_sync_version", "91");
  storageB.setItem("bf_last_sync_timestamp", "org-b-time");
  storageB.setItem("bf_visibility_token", "org-b-visibility");
  let fetchCalls = 0;
  const restore = installPullGlobals(async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ syncVersion: 1, timestamp: "org-a" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const race = outboxSettleWorkspaceRaceController({ storageA, storageB, flush });

  try {
    const pull = forceSyncData.call(race.controller, true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    race.switchToB();
    flush.resolve();
    const result = await pull;

    assert.equal(fetchCalls, 0);
    assert.equal(storageB.getItem("bf_last_sync_version"), "91");
    assert.equal(storageB.getItem("bf_last_sync_timestamp"), "org-b-time");
    assert.equal(storageB.getItem("bf_visibility_token"), "org-b-visibility");
    assert.deepEqual(race.patches, []);
    assert.equal(result.workspaceChanged, true);
    assert.equal(result.stale, true);
  } finally {
    flush.resolve();
    restore();
  }
});

test("same_org_new_epoch_rejects_late_pull_completion", async () => {
  const flush = deferred();
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  storageB.setItem("bf_last_sync_version", "101");
  let fetchCalls = 0;
  const restore = installPullGlobals(async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({ syncVersion: 1, timestamp: "old-epoch" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const race = outboxSettleWorkspaceRaceController({ storageA, storageB, flush });

  try {
    const pull = forceSyncData.call(race.controller, true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    race.switchToSameOrgNewEpoch();
    flush.resolve();

    const result = await pull;
    assert.equal(result.workspaceChanged, true);
    assert.equal(result.code, "WORKSPACE_CHANGED");
    assert.equal(fetchCalls, 0);
    assert.equal(storageB.getItem("bf_last_sync_version"), "101");
  } finally {
    flush.resolve();
    restore();
  }
});

test("workspace_change_before_full_sync_reset_cannot_clear_new_workspace_cursor", async () => {
  const resetPayload = deferred();
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  storageB.setItem("bf_last_sync_version", "92");
  storageB.setItem("bf_last_sync_timestamp", "org-b-time");
  storageB.setItem("bf_visibility_token", "org-b-visibility");
  let fetchCalls = 0;
  const restore = installPullGlobals(async () => {
    fetchCalls += 1;
    return {
      ok: false,
      status: 409,
      headers: new Headers({ "content-type": "application/json" }),
      clone: () => ({ json: () => resetPayload.promise }),
    };
  });
  const race = outboxSettleWorkspaceRaceController({
    storageA,
    storageB,
    flush: deferred(),
  });
  race.controller.model.getMutationOutboxStatus = () => ({ state: "ready", trusted: true });
  race.controller.forceSyncData = () => ({
    ok: false,
    stale: true,
    superseded: true,
    workspaceChanged: true,
  });

  try {
    const pull = forceSyncData.call(race.controller, true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(fetchCalls, 1);
    const patchesBeforeSwitch = structuredClone(race.patches);
    race.switchToB();
    resetPayload.resolve({
      code: "FULL_SYNC_REQUIRED",
      requiresFullSync: true,
    });
    const result = await pull;

    assert.equal(fetchCalls, 1);
    assert.equal(storageB.getItem("bf_last_sync_version"), "92");
    assert.equal(storageB.getItem("bf_last_sync_timestamp"), "org-b-time");
    assert.equal(storageB.getItem("bf_visibility_token"), "org-b-visibility");
    assert.deepEqual(race.patches, patchesBeforeSwitch);
    assert.equal(result.workspaceChanged, true);
  } finally {
    resetPayload.resolve({});
    restore();
  }
});

test("workspace_change_during_snapshot_persistence_cannot_mark_new_workspace_recovered", async () => {
  const persistence = deferred();
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  let token = "user:org-a@1";
  const recovered = [];
  const patches = [];
  const restore = installPullGlobals(async () => new Response(JSON.stringify({
    goithau: [{ id: "package-a", name: "Workspace A" }],
    syncVersion: 4,
    timestamp: "org-a-time",
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storageA,
    state: { goithau: [] },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    markStorageTablesRecovered(keys) { recovered.push([...keys]); },
    db: { async applySyncChanges() { await persistence.promise; } },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState(patch) { patches.push(patch); },
    hasLocalWorkspaceData: () => true,
  };

  try {
    const pull = forceSyncData.call(controller, true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    model.workspaceStorage = storageB;
    model.state = { goithau: [] };
    persistence.resolve();

    const result = await pull;
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(recovered, []);
    assert.deepEqual(patches, [{ phase: "syncing" }]);
    assert.equal(storageB.getItem("bf_last_sync_version"), null);
  } finally {
    persistence.resolve();
    restore();
  }
});

for (const workspaceRace of [
  { name: "workspace_change_during_pull_persistence_cannot_reapply_new_workspace_plan_drafts", token: "user:org-b@2", organizationId: "org-b" },
  { name: "same_org_new_epoch_pull_cannot_reapply_old_epoch_plan_drafts", token: "user:org-a@2", organizationId: "org-a" },
]) {
  test(workspaceRace.name, async () => {
    const persistence = deferred();
    const storageA = memoryStorage();
    const storageB = memoryStorage();
    let token = "user:org-a@1";
    const restore = installPullGlobals(async () => new Response(JSON.stringify({
      kehoach: [],
      syncVersion: 7,
      timestamp: "org-a-time",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const model = {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      workspaceStorage: storageA,
      state: { kehoach: [] },
      planVersionDraftSessions: [],
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
      normalizeRecordKeys: (record) => structuredClone(record),
      getMutationQueue: () => null,
      suspendMutationTracking: (callback) => callback(),
      buildMutationSyncPayload: () => null,
      db: { async applySyncChanges() { await persistence.promise; } },
    };
    const controller = {
      model,
      view: null,
      routeMap: {},
      updateSyncState() {},
      hasLocalWorkspaceData: () => true,
    };

    try {
      const pull = forceSyncData.call(controller, true, false, false);
      await new Promise((resolve) => setImmediate(resolve));
      token = workspaceRace.token;
      model.workspaceScope = {
        key: workspaceRace.token.split("@")[0],
        organizationId: workspaceRace.organizationId,
      };
      model.workspaceStorage = storageB;
      model.db = { async applySyncChanges() {} };
      model.state = { kehoach: [] };
      model.planVersionDraftSessions = [{
        draftId: "draft-new-workspace",
        rootId: "plan-new-workspace",
        aggregate: {
          kehoach: [{
            id: "plan-new-workspace",
            rootId: "plan-new-workspace",
            phienBan: "00",
          }],
        },
      }];
      persistence.resolve();

      const result = await pull;
      assert.equal(result.workspaceChanged, true);
      assert.deepEqual(model.state.kehoach, []);
      assert.equal(storageB.getItem("bf_last_sync_version"), null);
    } finally {
      persistence.resolve();
      restore();
    }
  });
}

test("workspace_change_before_plan_draft_cleanup_cannot_remove_new_workspace_session", async () => {
  const cleanupStarted = deferred();
  const releaseCleanup = deferred();
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  let token = "user:org-a@1";
  let envelope = {
    version: 2,
    sessions: [{
      draftId: "draft-a",
      rootId: "plan-a",
      revision: 1,
      aggregate: { kehoach: [{ id: "plan-a", rootId: "plan-a", phienBan: "00" }] },
    }],
    tombstones: {},
  };
  const dbA = {
    async applySyncChanges() {},
    async update(_key, updater) {
      cleanupStarted.resolve();
      await releaseCleanup.promise;
      envelope = updater(structuredClone(envelope));
      return structuredClone(envelope);
    },
  };
  const restore = installPullGlobals(async () => new Response(JSON.stringify({
    kehoach: [{ id: "plan-a", rootId: "plan-a", phienBan: "00", rowVersion: 4 }],
    syncVersion: 8,
    timestamp: "org-a-time",
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storageA,
    state: { kehoach: [] },
    planVersionDraftSessions: structuredClone(envelope.sessions),
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    db: dbA,
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };

  try {
    const pull = forceSyncData.call(controller, true, false, false);
    await cleanupStarted.promise;
    const draftB = { draftId: "draft-b", rootId: "plan-b", aggregate: { kehoach: [] } };
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    model.workspaceStorage = storageB;
    model.state = { kehoach: [{ id: "plan-b" }] };
    model.db = { async applySyncChanges() {} };
    model.planVersionDraftSessions = [draftB];
    releaseCleanup.resolve();

    const result = await pull;
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(model.planVersionDraftSessions, [draftB]);
    assert.equal(storageB.getItem("bf_last_sync_version"), null);
  } finally {
    releaseCleanup.resolve();
    restore();
  }
});

function coordinatedController() {
  const storage = memoryStorage();
  let pending = true;
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: { goithau: [{ id: "package-1", rowVersion: 1 }] },
    syncErrors: [],
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    getMutationOutboxStatus: () => ({ state: "ready", trusted: true }),
    buildMutationSyncPayload: () => pending ? {
      payload: { goithau: [{ id: "package-1", rowVersion: 1 }] },
      snapshot: { id: "mutation-1" },
    } : null,
    clearCommittedMutationBatch: () => { pending = false; },
    async applyCommittedRowVersions() {},
    rebaseMutationBatch() {},
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };
  controller.autoSync = (...args) => autoSync.call(controller, ...args);
  controller.forceSyncData = (...args) => forceSyncData.call(controller, ...args);
  return controller;
}

test("automatic push waits for an active authoritative pull in the same workspace", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pullResponse = deferred();
  const requests = [];
  globalThis.fetch = (url, options = {}) => {
    const method = options.method || "GET";
    requests.push(method);
    if (method === "GET") return pullResponse.promise;
    return Promise.resolve(new Response(JSON.stringify({
      status: "success",
      syncVersion: 2,
      rowVersions: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
  };
  globalThis.document = { cookie: "csrf_token=test", getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  const controller = coordinatedController();
  let pull;
  let push;

  try {
    pull = controller.forceSyncData(true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    push = controller.autoSync();
    await Promise.resolve();
    assert.deepEqual(requests, ["GET"]);

    pullResponse.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", rowVersion: 1 }],
      syncVersion: 1,
      timestamp: "v1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await Promise.allSettled([pull, push].filter(Boolean));
    assert.equal((await pull).ok, true);
    assert.equal((await push).ok, true);
    assert.deepEqual(requests, ["GET", "POST"]);
  } finally {
    pullResponse.resolve(new Response(JSON.stringify({
      syncVersion: 1,
      timestamp: "cleanup",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("authoritative pull waits for an active push in the same workspace", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pushResponse = deferred();
  const requests = [];
  globalThis.fetch = (_url, options = {}) => {
    const method = options.method || "GET";
    requests.push(method);
    if (method === "POST") return pushResponse.promise;
    return Promise.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", rowVersion: 2 }],
      syncVersion: 2,
      timestamp: "v2",
    }), { status: 200, headers: { "content-type": "application/json" } }));
  };
  globalThis.document = { cookie: "csrf_token=test", getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  const controller = coordinatedController();
  let push;
  let pull;

  try {
    push = controller.autoSync();
    await new Promise((resolve) => setImmediate(resolve));
    pull = controller.forceSyncData(true, false, false);
    await Promise.resolve();
    assert.deepEqual(requests, ["POST"]);

    pushResponse.resolve(new Response(JSON.stringify({
      status: "success",
      syncVersion: 2,
      rowVersions: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await Promise.allSettled([push, pull].filter(Boolean));
    assert.equal((await push).ok, true);
    assert.equal((await pull).ok, true);
    assert.deepEqual(requests, ["POST", "GET"]);
  } finally {
    pushResponse.resolve(new Response(JSON.stringify({
      status: "success",
      syncVersion: 2,
      rowVersions: [],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});

test("background pull preserves an actionable conflict while local mutations remain pending", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.fetch = async () => new Response(JSON.stringify({
    syncVersion: 9,
    timestamp: "v9",
  }), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/chuyen-gia/tao-moi" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  const storage = memoryStorage();
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: {},
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => ({ payload: { chuyengia: [{ id: "expert-1" }] } }),
    rebaseMutationBatch() {},
    db: { async applySyncChanges() {} },
  };
  const phases = [];
  const controller = {
    _syncUxState: { phase: "conflict" },
    model,
    view: null,
    routeMap: {},
    updateSyncState(patch) {
      phases.push(patch.phase);
      this._syncUxState = { ...this._syncUxState, ...patch };
    },
    hasLocalWorkspaceData: () => true,
  };

  try {
    const result = await forceSyncData.call(controller, true, false, false);

    assert.equal(result.ok, true);
    assert.equal(result.localMutationsPending, true);
    assert.equal(controller._syncUxState.phase, "conflict");
    assert.deepEqual(phases, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("full_sync_retry_preserves_actionable_phase_with_pending_outbox", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const responses = [
    new Response(JSON.stringify({
      code: "FULL_SYNC_REQUIRED",
      requiresFullSync: true,
    }), { status: 409, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({
      syncVersion: 10,
      timestamp: "v10",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  globalThis.fetch = async () => responses.shift();
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/chuyen-gia/tao-moi" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  const storage = memoryStorage();
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: {},
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => ({ payload: { chuyengia: [{ id: "expert-1" }] } }),
    rebaseMutationBatch() {},
    db: { async applySyncChanges() {} },
  };
  const phases = [];
  const controller = {
    _syncUxState: { phase: "transportError" },
    model,
    view: null,
    routeMap: {},
    updateSyncState(patch) {
      phases.push(patch.phase);
      this._syncUxState = { ...this._syncUxState, ...patch };
    },
    hasLocalWorkspaceData: () => true,
  };
  controller.forceSyncData = (...args) => forceSyncData.call(controller, ...args);

  try {
    const result = await controller.forceSyncData(true, false, false);

    assert.equal(result.ok, true);
    assert.equal(result.localMutationsPending, true);
    assert.equal(controller._syncUxState.phase, "transportError");
    assert.deepEqual(phases, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("route pull supersedes older background completion without regressing cursor", async () => {
  const requestV1 = deferred();
  const requestV2 = deferred();
  const requests = [requestV1, requestV2];
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.fetch = () => requests.shift().promise;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  const storage = memoryStorage();
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: { goithau: [] },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };

  try {
    const pullV1 = forceSyncData.call(controller, true, false, false);
    const pullV2 = forceSyncData.call(controller, false, false, true);
    requestV2.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", name: "VERSION 2" }],
      syncVersion: 2,
      timestamp: "v2",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.equal((await pullV2).ok, true);
    requestV1.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", name: "VERSION 1" }],
      syncVersion: 1,
      timestamp: "v1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const staleResult = await pullV1;

    assert.deepEqual(staleResult, { ok: false, stale: true, superseded: true });
    assert.deepEqual(model.state.goithau, [{ id: "package-1", name: "VERSION 2" }]);
    assert.equal(storage.getItem("bf_last_sync_version"), "2");
    assert.equal(storage.getItem("bf_last_sync_timestamp"), "v2");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("manual pull supersedes an earlier websocket-triggered pull", async () => {
  const websocketRequest = deferred();
  const manualRequest = deferred();
  const requests = [websocketRequest, manualRequest];
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.fetch = () => requests.shift().promise;
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });

  const storage = memoryStorage();
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: { goithau: [] },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };
  const pullFromWebSocket = () => forceSyncData.call(controller, true, false, false);
  const pullManually = () => forceSyncData.call(controller, false, false, false);

  try {
    const websocketPull = pullFromWebSocket();
    const manualPull = pullManually();
    manualRequest.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", name: "MANUAL VERSION 8" }],
      syncVersion: 8,
      timestamp: "v8",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    assert.equal((await manualPull).ok, true);
    websocketRequest.resolve(new Response(JSON.stringify({
      goithau: [{ id: "package-1", name: "WEBSOCKET VERSION 7" }],
      syncVersion: 7,
      timestamp: "v7",
    }), { status: 200, headers: { "content-type": "application/json" } }));

    assert.deepEqual(
      await websocketPull,
      { ok: false, stale: true, superseded: true },
    );
    assert.deepEqual(model.state.goithau, [{ id: "package-1", name: "MANUAL VERSION 8" }]);
    assert.equal(storage.getItem("bf_last_sync_version"), "8");
    assert.equal(storage.getItem("bf_last_sync_timestamp"), "v8");
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

for (const resetCode of ["FULL_SYNC_REQUIRED", "SYNC_VISIBILITY_RESET_REQUIRED"]) {
test(`409 ${resetCode} recursion owns the latest pull generation`, async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const responses = [
    new Response(JSON.stringify({
      code: resetCode,
      requiresFullSync: true,
    }), { status: 409, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({
      goithau: [{ id: "package-5", name: "FULL VERSION 5" }],
      syncVersion: 5,
      timestamp: "v5",
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return responses.shift();
  };
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  const storage = memoryStorage();
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: { goithau: [] },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
    getSyncTableKeysForPath: () => ["goithau"],
  };
  controller.forceSyncData = (...args) => forceSyncData.call(controller, ...args);

  try {
    const result = await controller.forceSyncData(false, false, true);

    assert.equal(result.ok, true);
    assert.deepEqual(model.state.goithau, [{ id: "package-5", name: "FULL VERSION 5" }]);
    assert.equal(storage.getItem("bf_last_sync_version"), "5");
    assert.equal(storage.getItem("bf_last_sync_timestamp"), "v5");
    assert.match(requestedUrls[0], /[?&]tables=goithau(?:&|$)/u);
    if (resetCode === "SYNC_VISIBILITY_RESET_REQUIRED") {
      assert.doesNotMatch(requestedUrls[1], /[?&]tables=/u);
    } else {
      assert.match(requestedUrls[1], /[?&]tables=goithau(?:&|$)/u);
    }
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousNavigator) {
      Object.defineProperty(globalThis, "navigator", previousNavigator);
    } else {
      delete globalThis.navigator;
}
}
});
}

test("a route-only visibility change escalates before stale pagination or non-route rows survive", async () => {
  const paginationRequest = deferred();
  let paginationAborted = false;
  const syncUrls = [];
  const persistenceCalls = [];
  let syncRequestCount = 0;
  const storage = memoryStorage();
  storage.setItem("bf_visibility_token", "wide");
  const restoreGlobals = installPullGlobals((url, options = {}) => {
    if (String(url).startsWith("/api/paginate?")) {
      options.signal?.addEventListener?.("abort", () => {
        paginationAborted = true;
        paginationRequest.resolve(new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }, { once: true });
      return paginationRequest.promise;
    }
    syncUrls.push(String(url));
    syncRequestCount += 1;
    const payload = syncRequestCount === 1
      ? {
          goithau: [{ id: "partial-route-row" }],
          visibilityToken: "narrow",
          partial: true,
        }
      : {
          goithau: [],
          nhathau: [],
          kehoach: [],
          recordManifest: { goithau: [], nhathau: [], kehoach: [] },
          syncVersion: 2,
          timestamp: "narrow-snapshot",
          visibilityToken: "narrow",
          partial: false,
        };
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  });
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storage,
    state: {
      activeuser: { id: "user" },
      activerole: "manager",
      kehoach: [],
      goithau: [],
      nhathau: [{ id: "revoked-non-route-row" }],
    },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    entityIndexes: { invalidate() {} },
    db: {
      async applySyncChanges(changes) { persistenceCalls.push(changes); },
    },
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
    getSyncTableKeysForPath: () => ["goithau"],
  };
  controller.forceSyncData = (...args) => forceSyncData.call(controller, ...args);

  try {
    const paginatedOutcome = loadPaginatedRecords(model, "kehoach", { page: 1 }).then(
      (value) => ({ status: "fulfilled", value }),
      (reason) => ({ status: "rejected", reason }),
    );
    await new Promise((resolve) => setImmediate(resolve));

    const syncResult = await controller.forceSyncData(true, false, true);
    const stalePagination = await paginatedOutcome;

    assert.equal(syncResult.ok, true);
    assert.equal(paginationAborted, true);
    assert.equal(stalePagination.status, "rejected");
    assert.equal(stalePagination.reason?.name, "AbortError");
    assert.equal(storage.getItem("bf_visibility_token"), "narrow");
    assert.equal(model.visibilityRevision, 1);
    assert.deepEqual(model.state.kehoach, []);
    assert.deepEqual(model.state.goithau, []);
    assert.deepEqual(model.state.nhathau, []);
    assert.equal(model._paginationRequests.size, 0);
    assert.equal(model._paginatedQueryCache.size, 0);
    assert.equal(syncUrls.length, 2);
    assert.match(syncUrls[0], /[?&]tables=goithau(?:&|$)/u);
    assert.doesNotMatch(syncUrls[1], /[?&]tables=/u);
    assert.equal(persistenceCalls.length, 1, "the partial predecessor must not be persisted");
    assert.deepEqual(persistenceCalls[0].replacements.nhathau, []);
  } finally {
    paginationRequest.resolve(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    restoreGlobals();
  }
});

test("workspace_change_during_pull_outbox_flush_with_new_workspace_storage_failure_does_not_update_new_workspace", async () => {
  const flush = deferred();
  const fetchCalls = [];
  const restoreGlobals = installPullGlobals((...args) => {
    fetchCalls.push(args);
    throw new Error("pull must not start after the workspace changes");
  });
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  let token = "user:org-a@1";
  let outboxStatus = { state: "pending", trusted: true };
  const updates = [];
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storageA,
    state: {},
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    getMutationOutboxStatus: () => outboxStatus,
    flushMutationOutbox: () => flush.promise,
  };
  const controller = {
    model,
    view: null,
    routeMap: {},
    updateSyncState: (patch) => updates.push(patch),
    hasLocalWorkspaceData: () => true,
  };

  try {
    const pending = forceSyncData.call(controller, true, false, false);
    await new Promise((resolve) => setImmediate(resolve));
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    model.workspaceStorage = storageB;
    outboxStatus = { state: "ready", trusted: false, code: "B_STORAGE_FAILED" };
    flush.resolve();

    const result = await pending;
    assert.equal(result.workspaceChanged, true);
    assert.equal(result.stale, true);
    assert.deepEqual(updates, []);
    assert.deepEqual(fetchCalls, []);
  } finally {
    flush.resolve();
    restoreGlobals();
  }
});
