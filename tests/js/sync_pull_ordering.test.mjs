import test from "node:test";
import assert from "node:assert/strict";

import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { autoSync } from "../../frontend/app/SyncPushService.js";

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
  globalThis.fetch = async () => responses.shift();
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
  controller.forceSyncData = (...args) => forceSyncData.call(controller, ...args);

  try {
    const result = await controller.forceSyncData(false, false, false);

    assert.equal(result.ok, true);
    assert.deepEqual(model.state.goithau, [{ id: "package-5", name: "FULL VERSION 5" }]);
    assert.equal(storage.getItem("bf_last_sync_version"), "5");
    assert.equal(storage.getItem("bf_last_sync_timestamp"), "v5");
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
