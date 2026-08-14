import test from "node:test";
import assert from "node:assert/strict";

import { forceSyncData } from "../../frontend/app/SyncPullService.js";

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
