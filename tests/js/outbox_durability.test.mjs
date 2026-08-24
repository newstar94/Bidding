import test from "node:test";
import assert from "node:assert/strict";

import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { WorkspaceMutationOutboxStore } from "../../frontend/app/WorkspaceMutationOutboxStore.js";

function clone(value) {
  return structuredClone(value);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function pendingEnvelope(revision = 3) {
  return {
    version: 1,
    revision,
    savedAt: revision,
    queue: {
      baseSyncVersion: "2",
      clientMutationId: "pending-mutation",
      dirtyTables: {},
      upserts: {
        goithau: {
          "package-1": { id: "package-1", name: "LOCAL PENDING" },
        },
      },
      deletes: [],
      revision: 1,
    },
    localDeletions: [],
  };
}

function dualBackends({ localValue = null, databaseValue = null } = {}) {
  let localReadError = null;
  let databaseReadError = null;
  let localWriteError = null;
  let databaseWriteError = null;
  let local = clone(localValue);
  let indexed = clone(databaseValue);
  const reads = [];
  const writes = [];
  return {
    storage: {
      getItem() {
        return null;
      },
      readJson() {
        reads.push("local");
        if (localReadError) throw localReadError;
        return clone(local);
      },
      writeJson(key, value) {
        writes.push(["local", key]);
        if (localWriteError) throw localWriteError;
        if (key === "bf_mutation_queue") local = clone(value);
      },
    },
    database: {
      async get() {
        reads.push("indexeddb");
        if (databaseReadError) throw databaseReadError;
        return clone(indexed);
      },
      async set(_key, value) {
        writes.push(["indexeddb", "bf_mutation_queue"]);
        if (databaseWriteError) throw databaseWriteError;
        indexed = clone(value);
      },
    },
    reads,
    writes,
    get localValue() {
      return clone(local);
    },
    get databaseValue() {
      return clone(indexed);
    },
    setLocalReadError(error) {
      localReadError = error;
    },
    setDatabaseReadError(error) {
      databaseReadError = error;
    },
    setLocalWriteError(error) {
      localWriteError = error;
    },
    setDatabaseWriteError(error) {
      databaseWriteError = error;
    },
  };
}

function sharedAtomicBackends() {
  let indexed = null;
  let local = null;
  let transaction = Promise.resolve();
  const database = {
    async get() {
      await transaction;
      return clone(indexed);
    },
    update(_key, updater) {
      let result;
      transaction = transaction.then(() => {
        result = updater(clone(indexed));
        indexed = clone(result);
      });
      return transaction.then(() => clone(result));
    },
  };
  const storage = {
    getItem() { return null; },
    readJson(_key, fallback) { return clone(local ?? fallback); },
    writeJson(key, value) {
      if (key === "bf_mutation_queue") local = clone(value);
    },
  };
  return {
    database,
    storage,
    get envelope() { return clone(indexed); },
  };
}

function queueWithUpsert(id, name = id) {
  return {
    baseSyncVersion: "1",
    clientMutationId: `mutation-${id}`,
    dirtyTables: {},
    upserts: { goithau: { [id]: { id, name } } },
    deletes: [],
    revision: 1,
  };
}

function queueWithPatch(id, value = id) {
  return {
    baseSyncVersion: "1",
    clientMutationId: `patch-${id}`,
    dirtyTables: {},
    upserts: {},
    patches: { goithau: { [id]: { id, danhGiaHsdtMetadata: value } } },
    deletes: [],
    revision: 1,
  };
}

function outboxForStore(store) {
  return new WorkspaceMutationOutbox({
    store,
    getBaseSyncVersion: () => "2",
    createId: () => "upgraded-mutation",
    isSyncedType: () => true,
    normalizeRecord: (record) => clone(record),
    serializeRecord: (record) => clone(record),
  });
}

test("legacy_outbox_without_patches_hydrates_with_empty_patch_map", async () => {
  const store = new WorkspaceMutationOutboxStore(dualBackends({
    databaseValue: pendingEnvelope(),
  }));

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.deepEqual(hydrated.queue.patches, {});
});

test("legacy_outbox_without_patches_can_replace_table_after_upgrade", async () => {
  const store = new WorkspaceMutationOutboxStore(dualBackends({
    databaseValue: pendingEnvelope(),
  }));
  const outbox = outboxForStore(store);
  await outbox.hydrate();

  assert.equal(outbox.enqueue({
    kind: "replace-table",
    table: "goithau",
    records: [{ id: "package-2", name: "replacement" }],
  }), true);
  assert.deepEqual(outbox.snapshot().patches, {});
});

test("legacy_outbox_without_patches_can_enqueue_patch_after_upgrade", async () => {
  const store = new WorkspaceMutationOutboxStore(dualBackends({
    databaseValue: pendingEnvelope(),
  }));
  const outbox = outboxForStore(store);
  await outbox.hydrate();

  outbox.enqueue({
    kind: "patch",
    table: "goithau",
    records: [{ id: "package-2", name: "patched" }],
  });

  assert.equal(outbox.snapshot().patches.goithau["package-2"].name, "patched");
});

test("legacy_outbox_pending_upserts_survive_patch_schema_upgrade", async () => {
  const store = new WorkspaceMutationOutboxStore(dualBackends({
    databaseValue: pendingEnvelope(),
  }));

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.deepEqual(hydrated.queue.deletes, []);
  assert.equal(hydrated.queue.clientMutationId, "pending-mutation");
  assert.equal(hydrated.queue.revision, 1);
});

test("legacy_dual_backend_outbox_merge_preserves_existing_mutations_and_initializes_patches", async () => {
  const local = pendingEnvelope(2);
  const indexed = pendingEnvelope(3);
  indexed.queue.deletes = [{ table: "goithau", id: "package-deleted", expectedVersion: 4 }];
  const store = new WorkspaceMutationOutboxStore(dualBackends({
    localValue: local,
    databaseValue: indexed,
  }));

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.deepEqual(hydrated.queue.deletes, indexed.queue.deletes);
  assert.deepEqual(hydrated.queue.patches, {});
});

test("localStorage read failure still hydrates IndexedDB evidence but marks it untrusted", async () => {
  const backends = dualBackends({ databaseValue: pendingEnvelope() });
  backends.setLocalReadError(new Error("localStorage denied"));
  const store = new WorkspaceMutationOutboxStore(backends);

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.deepEqual(backends.reads, ["local", "indexeddb"]);
  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.trusted, false);
  assert.equal(hydrated.durability.backends.localStorage, "failed");
  assert.equal(hydrated.durability.backends.indexedDB, "ready");
});

test("IndexedDB read failure keeps localStorage evidence but marks it untrusted", async () => {
  const backends = dualBackends({ localValue: pendingEnvelope() });
  backends.setDatabaseReadError(new Error("IndexedDB unavailable"));
  const store = new WorkspaceMutationOutboxStore(backends);

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.backends.localStorage, "ready");
  assert.equal(hydrated.durability.backends.indexedDB, "failed");
});

test("both outbox read failures never claim an authoritative empty queue", async () => {
  const backends = dualBackends();
  backends.setLocalReadError(new Error("localStorage denied"));
  backends.setDatabaseReadError(new Error("IndexedDB unavailable"));
  const store = new WorkspaceMutationOutboxStore(backends);

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.trusted, false);
  assert.equal(hydrated.durability.code, "OUTBOX_DURABILITY_DEGRADED");
  assert.deepEqual(Object.keys(hydrated.queue.upserts), []);
});

test("corrupt local outbox cannot hide valid IndexedDB evidence", async () => {
  const backends = dualBackends({
    localValue: { version: 1, revision: 9, queue: "not-an-object" },
    databaseValue: pendingEnvelope(4),
  });
  const store = new WorkspaceMutationOutboxStore(backends);

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.backends.localStorage, "corrupt");
  assert.equal(hydrated.durability.backends.indexedDB, "ready");

  const recovered = await store.hydrate({
    createId: () => "new-id",
    repairCorrupt: true,
  });
  await store.flush();

  assert.equal(recovered.durability.state, "ready");
  assert.deepEqual(backends.localValue.queue, {
    ...pendingEnvelope(4).queue,
    patches: {},
    baseSnapshots: {},
  });
});

test("malformed localStorage JSON is explicit corruption rather than an empty queue", async () => {
  const databaseEnvelope = pendingEnvelope(6);
  const store = new WorkspaceMutationOutboxStore({
    storage: {
      getItem: () => "{malformed-json",
      readJson: () => {
        throw new Error("readJson fallback must not hide malformed JSON");
      },
      writeJson() {},
    },
    database: {
      async get() {
        return clone(databaseEnvelope);
      },
      async set() {},
    },
  });

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.backends.localStorage, "corrupt");
  assert.equal(hydrated.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
});

test("same-revision divergent replicas are a conflict, never an arbitrary winner", async () => {
  const local = pendingEnvelope(7);
  const indexed = pendingEnvelope(7);
  indexed.queue.upserts.goithau["package-1"].name = "DIFFERENT REPLICA";
  const backends = dualBackends({ localValue: local, databaseValue: indexed });
  const store = new WorkspaceMutationOutboxStore(backends);

  const hydrated = await store.hydrate({ createId: () => "new-id" });

  assert.equal(hydrated.durability.state, "degraded");
  assert.equal(hydrated.durability.trusted, false);
  assert.deepEqual(hydrated.durability.backends, {
    indexedDB: "conflict",
    localStorage: "conflict",
  });
  assert.deepEqual(backends.writes, []);
});

test("a later healthy hydrate reconciles both backends and clears degraded state", async () => {
  const envelope = pendingEnvelope(5);
  const backends = dualBackends({ databaseValue: envelope });
  backends.setLocalReadError(new Error("localStorage temporarily denied"));
  const store = new WorkspaceMutationOutboxStore(backends);
  await store.hydrate({ createId: () => "new-id" });
  backends.setLocalReadError(null);

  const recovered = await store.hydrate({ createId: () => "new-id" });
  await store.flush();

  assert.equal(recovered.durability.state, "ready");
  assert.equal(recovered.durability.trusted, true);
  const canonicalQueue = { ...envelope.queue, patches: {}, baseSnapshots: {} };
  assert.deepEqual(backends.localValue.queue, canonicalQueue);
  assert.deepEqual(backends.databaseValue.queue, canonicalQueue);
  assert.equal(store.getStatus().state, "ready");
});

test("localStorage write failure still attempts IndexedDB and flush rejects degraded durability", async () => {
  const backends = dualBackends();
  backends.setLocalWriteError(new Error("localStorage quota"));
  const store = new WorkspaceMutationOutboxStore(backends);

  store.persist(pendingEnvelope().queue, []);

  await assert.rejects(store.flush(), { code: "OUTBOX_DURABILITY_DEGRADED" });
  assert.equal(backends.writes.some(([backend]) => backend === "indexeddb"), true);
  assert.equal(backends.databaseValue.queue.upserts.goithau["package-1"].name, "LOCAL PENDING");
  assert.equal(store.getStatus().state, "degraded");
});

test("two stale tabs atomically merge disjoint mutations instead of last-writer-wins", async () => {
  const backends = sharedAtomicBackends();
  const tabA = new WorkspaceMutationOutboxStore(backends);
  const tabB = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([
    tabA.hydrate({ createId: () => "empty-a" }),
    tabB.hydrate({ createId: () => "empty-b" }),
  ]);

  tabA.persist(queueWithUpsert("package-a"), []);
  tabB.persist(queueWithUpsert("package-b"), []);
  await Promise.all([tabA.flush(), tabB.flush()]);

  assert.deepEqual(
    Object.keys(backends.envelope.queue.upserts.goithau).sort(),
    ["package-a", "package-b"],
  );
});

test("two stale tabs durably merge disjoint partial patches", async () => {
  const backends = sharedAtomicBackends();
  const tabA = new WorkspaceMutationOutboxStore(backends);
  const tabB = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);

  tabA.persist(queueWithPatch("package-a", "draft-a"), []);
  tabB.persist(queueWithPatch("package-b", "draft-b"), []);
  await Promise.all([tabA.flush(), tabB.flush()]);

  assert.deepEqual(
    Object.keys(backends.envelope.queue.patches.goithau).sort(),
    ["package-a", "package-b"],
  );
});

test("stale ACK removes only its receipt while a concurrent enqueue survives", async () => {
  const backends = sharedAtomicBackends();
  const seed = new WorkspaceMutationOutboxStore(backends);
  seed.persist(queueWithUpsert("package-a"), []);
  await seed.flush();
  const ackTab = new WorkspaceMutationOutboxStore(backends);
  const enqueueTab = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([
    ackTab.hydrate({ createId: () => "ack" }),
    enqueueTab.hydrate({ createId: () => "enqueue" }),
  ]);

  ackTab.persist(null, []);
  enqueueTab.persist({
    ...queueWithUpsert("package-a"),
    clientMutationId: "mutation-b",
    upserts: {
      goithau: {
        "package-a": { id: "package-a", name: "package-a" },
        "package-b": { id: "package-b" },
      },
    },
  }, []);
  await Promise.all([ackTab.flush(), enqueueTab.flush()]);

  assert.deepEqual(
    Object.keys(backends.envelope.queue.upserts.goithau),
    ["package-b"],
  );
});

test("delete and upsert race has deterministic transaction-order last-operation-wins", async () => {
  const backends = sharedAtomicBackends();
  const tabA = new WorkspaceMutationOutboxStore(backends);
  const tabB = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);

  tabA.persist({
    ...queueWithUpsert("package-a"),
    upserts: {},
    deletes: [{ table: "goithau", id: "package-a" }],
  }, [{ table: "goithau", id: "package-a" }]);
  tabB.persist(queueWithUpsert("package-a", "newer upsert"), []);
  await Promise.all([tabA.flush(), tabB.flush()]);

  assert.equal(backends.envelope.queue.deletes.length, 0);
  assert.equal(
    backends.envelope.queue.upserts.goithau["package-a"].name,
    "newer upsert",
  );
});

test("model exposes degraded outbox state, blocks synced edits, and recovers explicitly", async () => {
  const backends = dualBackends({ databaseValue: pendingEnvelope() });
  backends.setLocalReadError(new Error("localStorage temporarily denied"));
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  model.workspaceStorage = backends.storage;
  model.db = {
    ...backends.database,
    stores: ["goithau"],
  };

  await model.hydrateMutationOutbox();

  assert.equal(model.hasMutationOutboxDurabilityFailure(), true);
  assert.deepEqual(model.getStorageHydrationStatus("mutation_outbox"), {
    code: "OUTBOX_DURABILITY_DEGRADED",
    recoverable: true,
    state: "failed",
    table: "mutation_outbox",
  });
  assert.throws(
    () => model.markRecordDirty("goithau", [{ id: "new-edit" }]),
    { code: "OUTBOX_DURABILITY_DEGRADED" },
  );

  backends.setLocalReadError(null);
  await model.hydrateMutationOutbox();

  assert.equal(model.hasMutationOutboxDurabilityFailure(), false);
  assert.equal(model.getStorageHydrationStatus("mutation_outbox").state, "ready");
  assert.doesNotThrow(
    () => model.markRecordDirty("goithau", [{ id: "new-edit" }]),
  );
});

test("authoritative pull is blocked before network access while outbox durability is degraded", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 200 });
  };
  globalThis.document = { getElementById: () => null };
  const controller = {
    model: {
      getMutationOutboxStatus: () => ({
        code: "OUTBOX_DURABILITY_DEGRADED",
        state: "degraded",
        trusted: false,
      }),
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: () => true,
    },
    updateSyncState() {},
  };

  try {
    const result = await forceSyncData.call(controller, false, false, false);

    assert.equal(result.ok, false);
    assert.equal(result.storageDegraded, true);
    assert.equal(result.error.code, "OUTBOX_DURABILITY_DEGRADED");
    assert.equal(fetchCalls, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("authoritative pull waits for pending outbox durability before network access", async () => {
  const outboxWrite = deferred();
  const store = new WorkspaceMutationOutboxStore({
    storage: {
      readJson: (_key, fallback) => fallback,
      writeJson() {},
    },
    database: {
      async get() {
        return null;
      },
      async set() {
        await outboxWrite.promise;
      },
    },
  });
  await store.hydrate({ createId: () => "new-id" });
  store.persist(pendingEnvelope().queue, []);

  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response(JSON.stringify({
      goithau: [{ id: "package-1", name: "SERVER" }],
      syncVersion: 7,
      timestamp: "v7",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  globalThis.document = { getElementById: () => null };
  globalThis.window = { location: { pathname: "/goi-thau" } };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  const cursorValues = new Map();
  const cursorStorage = {
    getItem: (key) => cursorValues.get(key) ?? null,
    setItem: (key, value) => cursorValues.set(key, String(value)),
    removeItem: (key) => cursorValues.delete(key),
  };
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: cursorStorage,
    state: { goithau: [] },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: () => true,
    getMutationOutboxStatus: () => store.getStatus(),
    flushMutationOutbox: () => store.flush(),
    getMutationQueue: () => null,
    normalizeRecordKeys: (record) => clone(record),
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    db: { async applySyncChanges() {} },
  };
  const controller = {
    model,
    routeMap: {},
    updateSyncState() {},
    hasLocalWorkspaceData: () => true,
  };

  try {
    const pull = forceSyncData.call(controller, true, false, false);
    await Promise.resolve();
    assert.equal(fetchCalls, 0);

    outboxWrite.resolve();
    const result = await pull;

    assert.equal(result.ok, true);
    assert.equal(fetchCalls, 1);
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
