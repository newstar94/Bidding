import assert from "node:assert/strict";
import test from "node:test";

import {
  listPendingSyncItems,
  pendingSyncItemDisplay
} from "../../frontend/app/PendingSyncDialog.js";
import {
  autoSync,
  continuePendingSync,
  removePendingSyncItem
} from "../../frontend/app/BiddingControllerSync.js";

test("pending sync list includes upserts, deletions and per-record conflicts", () => {
  const items = listPendingSyncItems({
    upserts: {
      goithau: {
        "gt-1": { id: "gt-1", maGoiThau: "ib-01", tenGoiThau: "Mua sắm" }
      }
    },
    deletes: [{ table: "nhathau", id: "nt-1" }]
  }, {
    errors: [{ table: "goithau", id: "gt-1" }]
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.operation).sort(), ["delete", "upsert"]);
  assert.equal(items.find(item => item.id === "gt-1").conflict, true);
  assert.equal(items.find(item => item.id === "nt-1").conflict, false);
  assert.deepEqual(pendingSyncItemDisplay(items[0]), {
    table: "Gói thầu",
    title: "ib-01",
    description: "Mua sắm",
    operation: "Thêm/Cập nhật"
  });
});

test("continue pending sync retries valid data through the normal sync flow", async () => {
  let autoSyncCalls = 0;
  const controller = {
    model: { getPendingMutationSummary: () => ({ pendingCount: 2 }) },
    autoSync: async () => {
      autoSyncCalls += 1;
      return { ok: true };
    }
  };

  assert.deepEqual(await continuePendingSync.call(controller), { ok: true });
  assert.equal(autoSyncCalls, 1);
});

test("removing a pending item refreshes authoritative data and preserves siblings", async () => {
  const removedCalls = [];
  const deletedLocalRecords = [];
  let forceSyncCalls = 0;
  const controller = {
    model: {
      state: { goithau: [{ id: "gt-remove" }, { id: "gt-keep" }] },
      db: {
        deleteRecord: async (type, id) => deletedLocalRecords.push({ type, id })
      },
      removePendingMutation(type, id, operation) {
        removedCalls.push({ type, id, operation });
        return { type, id, operation };
      },
      getPendingMutationSummary: () => ({ pendingCount: 1 })
    },
    _syncConflict: {
      data: {
        errors: [
          { table: "goithau", id: "gt-remove" },
          { table: "goithau", id: "gt-keep" }
        ]
      }
    },
    forceSyncData: async () => {
      forceSyncCalls += 1;
      return { ok: true };
    }
  };

  const result = await removePendingSyncItem.call(controller, {
    type: "goithau",
    id: "gt-remove",
    operation: "upsert"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(removedCalls, [{ type: "goithau", id: "gt-remove", operation: "upsert" }]);
  assert.deepEqual(controller._syncConflict.data.errors, [{ table: "goithau", id: "gt-keep" }]);
  assert.deepEqual(controller.model.state.goithau, [{ id: "gt-keep" }]);
  assert.deepEqual(deletedLocalRecords, [{ type: "goithau", id: "gt-remove" }]);
  assert.equal(forceSyncCalls, 1);
});

test("server rule violations are discarded while valid siblings retry immediately", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let pendingCount = 2;
  const syncPayloads = [
    { goithau: [{ id: "gt-invalid" }, { id: "gt-valid" }], deletions: [] },
    { goithau: [{ id: "gt-valid" }], deletions: [] }
  ];
  const storage = new Map();
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-a" },
      state: { goithau: [{ id: "gt-invalid" }, { id: "gt-valid" }] },
      db: { deleteRecord: async () => {} },
      dashboardSummary: null,
      getWorkspaceToken: () => "user-a:org-a@1",
      isWorkspaceCurrent: token => token === "user-a:org-a@1",
      workspaceStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
      },
      buildMutationSyncPayload() {
        const payload = syncPayloads.shift();
        return payload ? { payload, snapshot: { revision: fetchCalls + 1 } } : null;
      },
      discardRejectedMutations() {
        pendingCount = 1;
        return [{ type: "goithau", id: "gt-invalid", operation: "upsert", conflictingId: "" }];
      },
      getPendingMutationSummary: () => ({ pendingCount }),
      clearSyncedMutationQueue() { pendingCount = 0; },
      syncErrors: []
    },
    view: null,
    updateSyncState() {},
    fetchRecordByLookup: async () => null
  };
  controller.autoSync = () => autoSync.call(controller);
  globalThis.fetch = async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) {
      return new Response(JSON.stringify({
        status: "error",
        errors: [{ table: "goithau", id: "gt-invalid", message: "Mã gói thầu không đúng định dạng" }]
      }), { status: 422, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ status: "success", syncVersion: 9 }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const result = await controller.autoSync();
    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 2);
    assert.equal(pendingCount, 0);
    assert.deepEqual(controller.model.state.goithau, [{ id: "gt-valid" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network failures keep valid mutations in the retry queue", async () => {
  const originalFetch = globalThis.fetch;
  let pendingCount = 1;
  const controller = {
    model: {
      workspaceScope: { organizationId: "org-a" },
      getWorkspaceToken: () => "user-a:org-a@1",
      isWorkspaceCurrent: token => token === "user-a:org-a@1",
      workspaceStorage: { getItem: () => null },
      buildMutationSyncPayload: () => ({
        payload: { chuyengia: [{ id: "cg-offline" }], deletions: [] },
        snapshot: { revision: 1 }
      }),
      getPendingMutationSummary: () => ({ pendingCount })
    },
    updateSyncState() {}
  };
  globalThis.fetch = async () => { throw new TypeError("offline"); };

  try {
    const result = await autoSync.call(controller);
    assert.equal(result.ok, false);
    assert.equal(pendingCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("offline mutations survive disconnect and flush after connectivity returns", async () => {
  const originalNavigator = globalThis.navigator;
  let online = false;
  let pendingCount = 1;
  let autoSyncCalls = 0;
  const syncStates = [];
  const controller = {
    model: {
      getPendingMutationSummary: () => ({ pendingCount })
    },
    updateSyncState(state) {
      syncStates.push(state);
    },
    view: { showToast() {} },
    async autoSync() {
      autoSyncCalls += 1;
      pendingCount = 0;
      return { ok: true, flushed: true };
    }
  };

  try {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { get onLine() { return online; } }
    });

    const disconnected = await continuePendingSync.call(controller);
    assert.deepEqual(disconnected, { ok: false, offline: true });
    assert.equal(pendingCount, 1);
    assert.equal(autoSyncCalls, 0);
    assert.deepEqual(syncStates.at(-1), {
      phase: "offline",
      online: false,
      pendingCount: 1
    });

    online = true;
    const reconnected = await continuePendingSync.call(controller);
    assert.deepEqual(reconnected, { ok: true, flushed: true });
    assert.equal(autoSyncCalls, 1);
    assert.equal(pendingCount, 0);
  } finally {
    if (originalNavigator === undefined) delete globalThis.navigator;
    else Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator
    });
  }
});
