import test from "node:test";
import assert from "node:assert/strict";

import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { WorkspaceMutationOutboxStore } from "../../frontend/app/WorkspaceMutationOutboxStore.js";
import { serializeOutboundRecord } from "../../frontend/app/outboundSerializer.js";

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

test("a second save from a stale tab retains sibling work it has never hydrated", async () => {
  const backends = sharedAtomicBackends();
  const tabA = new WorkspaceMutationOutboxStore(backends);
  const tabB = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);
  tabA.persist(queueWithUpsert("package-a"), []);
  await tabA.flush();
  tabB.persist(queueWithUpsert("package-b"), []);
  await tabB.flush();
  tabB.persist({
    ...queueWithUpsert("package-b"),
    upserts: { goithau: {
      "package-b": { id: "package-b", name: "package-b" },
      "package-c": { id: "package-c", name: "package-c" },
    } },
  }, []);
  await tabB.flush();

  assert.deepEqual(Object.keys(backends.envelope.queue.upserts.goithau).sort(), [
    "package-a", "package-b", "package-c",
  ]);
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

test("atomic outbox persistence retains the canonical base through reload and acknowledgement", async () => {
  const backends = sharedAtomicBackends();
  const store = new WorkspaceMutationOutboxStore(backends);
  const outbox = outboxForStore(store);
  await outbox.hydrate();
  const base = { id: "package-a", name: "server", rowVersion: 3 };
  outbox.enqueue({
    kind: "upsert",
    table: "goithau",
    records: [{ ...base, name: "local" }],
    baseRecords: [base],
  });
  await outbox.flush();
  const reloaded = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await reloaded.hydrate();

  assert.deepEqual(reloaded.snapshot().baseSnapshots.goithau?.[base.id], base);
  assert.deepEqual(reloaded.snapshotForSync({ goithau: [] }).snapshot.baseSnapshots.goithau[base.id], base);
  reloaded.discard();
  await reloaded.flush();
  assert.deepEqual(backends.envelope.queue.baseSnapshots, {});
});

for (const kind of ["upsert", "patch"]) {
  test(`repeating an identical ${kind} durably captures a newly available canonical base`, async () => {
    const backends = sharedAtomicBackends();
    const outbox = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await outbox.hydrate();
    const base = { id: "package-a", name: "server", rowVersion: 3 };
    const record = { id: base.id, name: "local", rowVersion: 3 };
    outbox.enqueue({ kind, table: "goithau", records: [record] });
    await outbox.flush();
    outbox.enqueue({ kind, table: "goithau", records: [record], baseRecords: [base] });
    await outbox.flush();
    const reloaded = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await reloaded.hydrate();

    assert.deepEqual(outbox.snapshot().baseSnapshots.goithau[base.id], base);
    assert.deepEqual(backends.envelope.queue.baseSnapshots.goithau?.[base.id], base);
    assert.deepEqual(reloaded.snapshotForSync({ goithau: [base] }).snapshot.baseSnapshots.goithau?.[base.id], base);
  });

  test(`a stale base-only ${kind} save preserves a newer sibling operation and base`, async () => {
    const backends = sharedAtomicBackends();
    const stale = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await stale.hydrate();
    const record = { id: "package-a", name: "local", rowVersion: 3 };
    stale.enqueue({ kind, table: "goithau", records: [record] });
    await stale.flush();
    const sibling = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await sibling.hydrate();
    const siblingBase = { id: record.id, name: "new server", rowVersion: 4 };
    sibling.enqueue({
      kind, table: "goithau",
      records: [{ ...record, name: "new local", rowVersion: 4 }],
      baseRecords: [siblingBase],
    });
    await sibling.flush();
    stale.enqueue({
      kind, table: "goithau", records: [record],
      baseRecords: [{ id: record.id, name: "old server", rowVersion: 3 }],
    });
    await stale.flush();

    assert.equal(backends.envelope.queue[kind === "upsert" ? "upserts" : "patches"].goithau[record.id].name, "new local");
    assert.deepEqual(backends.envelope.queue.baseSnapshots.goithau[record.id], siblingBase);
  });

  test(`a stale base-only ${kind} save cannot attach a base to a sibling deletion`, async () => {
    const backends = sharedAtomicBackends();
    const stale = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await stale.hydrate();
    const record = { id: "package-a", name: "local", rowVersion: 3 };
    stale.enqueue({ kind, table: "goithau", records: [record] });
    await stale.flush();
    const sibling = outboxForStore(new WorkspaceMutationOutboxStore(backends));
    await sibling.hydrate();
    sibling.enqueue({ kind: "delete", table: "goithau", records: [record] });
    await sibling.flush();
    stale.enqueue({
      kind, table: "goithau", records: [record],
      baseRecords: [{ ...record, name: "server" }],
    });
    await stale.flush();

    assert.deepEqual(backends.envelope.queue.baseSnapshots, {});
    assert.deepEqual(backends.envelope.queue.upserts, {});
    assert.deepEqual(backends.envelope.queue.patches, {});
    assert.deepEqual(backends.envelope.queue.deletes, [{ table: "goithau", id: record.id, expectedVersion: 3 }]);
  });
}

test("stale tabs preserve separate edited fields of the same partial-patch record through reload", async () => {
  const backends = sharedAtomicBackends();
  const tabA = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  const tabB = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);
  const base = { id: "package-a", fieldA: "server-a", fieldB: "server-b", rowVersion: 3 };
  tabA.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "entered-a" }], baseRecords: [base] });
  await tabA.flush();
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldB: "entered-b" }] });
  await tabB.flush();
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldC: "entered-c" }] });
  await tabB.flush();
  const reloaded = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await reloaded.hydrate();

  assert.deepEqual(reloaded.snapshot().patches.goithau[base.id], {
    id: base.id, fieldA: "entered-a", fieldB: "entered-b", fieldC: "entered-c",
  });
  assert.deepEqual(reloaded.snapshot().baseSnapshots.goithau[base.id], base);
});

test("a base-only patch save cannot replace an unseen sibling base for the identical operation", async () => {
  const backends = sharedAtomicBackends();
  const stale = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await stale.hydrate();
  const record = { id: "package-a", fieldA: "entered-a" };
  stale.enqueue({ kind: "patch", table: "goithau", records: [record] });
  await stale.flush();
  const sibling = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await sibling.hydrate();
  const siblingBase = { id: record.id, fieldA: "new server", rowVersion: 4 };
  sibling.enqueue({ kind: "patch", table: "goithau", records: [record], baseRecords: [siblingBase] });
  await sibling.flush();
  stale.enqueue({
    kind: "patch", table: "goithau", records: [record],
    baseRecords: [{ id: record.id, fieldA: "old server", rowVersion: 3 }],
  });
  await stale.flush();

  assert.deepEqual(backends.envelope.queue.patches.goithau[record.id], record);
  assert.deepEqual(backends.envelope.queue.baseSnapshots.goithau[record.id], siblingBase);
});

test("a stale patch save preserves a sibling's newer value of an unchanged field", async () => {
  const backends = sharedAtomicBackends();
  const seed = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await seed.hydrate();
  seed.enqueue({ kind: "patch", table: "goithau", records: [{ id: "package-a", fieldA: "old-a" }] });
  await seed.flush();
  const tabA = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  const tabB = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);
  tabA.enqueue({ kind: "patch", table: "goithau", records: [{ id: "package-a", fieldA: "new-a" }] });
  await tabA.flush();
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: "package-a", fieldB: "new-b" }] });
  await tabB.flush();

  assert.deepEqual(backends.envelope.queue.patches.goithau["package-a"], {
    id: "package-a", fieldA: "new-a", fieldB: "new-b",
  });
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: "package-a", fieldA: "last-a" }] });
  await tabB.flush();
  assert.equal(backends.envelope.queue.patches.goithau["package-a"].fieldA, "last-a");
});

test("a stale canonical ACK removes its own patch fields and retains unseen sibling fields", async () => {
  const backends = sharedAtomicBackends();
  const tabA = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  const tabB = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await Promise.all([tabA.hydrate(), tabB.hydrate()]);
  const base = { id: "package-a", fieldA: "server-a", rowVersion: 3 };
  tabA.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "entered-a" }], baseRecords: [base] });
  await tabA.flush();
  const receipt = tabA.snapshotForSync({ goithau: [base] }).snapshot;
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldB: "entered-b" }] });
  await tabB.flush();
  tabA.ack(receipt);
  await tabA.flush();

  assert.deepEqual(backends.envelope.queue.patches.goithau[base.id], { id: base.id, fieldB: "entered-b" });
  assert.deepEqual(backends.envelope.queue.baseSnapshots.goithau[base.id], base);
});

test("a stale canonical ACK retains a newer sibling edit of the same field", async () => {
  const backends = sharedAtomicBackends();
  const tabA = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await tabA.hydrate();
  const base = { id: "package-a", fieldA: "server-a", rowVersion: 3 };
  tabA.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "entered-a" }] });
  await tabA.flush();
  const receipt = tabA.snapshotForSync({ goithau: [base] }).snapshot;
  const tabB = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await tabB.hydrate();
  tabB.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "newer-a" }] });
  await tabB.flush();
  tabA.ack(receipt);
  await tabA.flush();

  assert.deepEqual(backends.envelope.queue.patches.goithau[base.id], { id: base.id, fieldA: "newer-a" });
});

test("an acknowledged unchanged patch field is not resurrected by a stale edit to another field", async () => {
  const backends = sharedAtomicBackends();
  const ackTab = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await ackTab.hydrate();
  const base = { id: "package-a", fieldA: "server-a", rowVersion: 3 };
  ackTab.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "entered-a" }] });
  await ackTab.flush();
  const stale = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await stale.hydrate();
  ackTab.ack(ackTab.snapshotForSync({ goithau: [base] }).snapshot);
  await ackTab.flush();
  stale.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldB: "entered-b" }] });
  await stale.flush();

  assert.deepEqual(backends.envelope.queue.patches.goithau[base.id], { id: base.id, fieldB: "entered-b" });
});

test("a stale partial patch preserves a sibling full import through serialized reload and canonical ACK", async () => {
  const backends = sharedAtomicBackends();
  const model = new BiddingModel();
  const createOutbox = () => new WorkspaceMutationOutbox({
    store: new WorkspaceMutationOutboxStore(backends),
    getBaseSyncVersion: () => "3",
    createId: () => "import-patch-regression",
    isSyncedType: () => true,
    normalizeRecord: (record, type) => model.normalizeRecordKeys(clone(record), type),
    serializeRecord: (record, type) => serializeOutboundRecord(record, type, (value, recordType) => model.normalizeRecordKeys(value, recordType)),
  });
  const imported = createOutbox();
  const stale = createOutbox();
  await Promise.all([imported.hydrate(), stale.hydrate()]);
  const base = { id: "package-a", tenGoiThau: "server title", maGoiThau: "server code", rowVersion: 3, organizationId: "org-a" };
  const importedRecord = {
    ...base, tenGoiThau: "imported title",
    phanLoList: [{ id: "lot-a", nested: ["imported", null] }],
    ehsmtAdjustments: { before: ["old"] },
    _procurementImportCurrent: true,
    sourceRevision: { revision: "import-revision-a" },
  };
  imported.enqueue({ kind: "upsert", table: "goithau", records: [importedRecord], baseRecords: [base] });
  await imported.flush();
  const originalReceipt = imported.snapshotForSync({ goithau: [base] }).snapshot;
  const changedObject = { after: ["edited", null] };
  stale.enqueue({
    kind: "patch", table: "goithau",
    records: [{ id: base.id, maGoiThau: "edited code", ehsmtAdjustments: changedObject, tuyChonMuaThemList: null }],
    baseRecords: [base],
  });
  await stale.flush();

  assert.equal(backends.envelope.queue.upserts.goithau?.[base.id]?.tenGoiThau, "imported title");
  assert.deepEqual(backends.envelope.queue.patches, {});
  // The old full-import receipt cannot erase the later patch merged into it.
  imported.ack(originalReceipt);
  await imported.flush();
  const reloaded = createOutbox();
  await reloaded.hydrate();
  const sent = reloaded.snapshotForSync({ goithau: [base] });
  assert.equal(sent.payload.goithau[0].tenGoiThau, "imported title");
  assert.equal(sent.payload.goithau[0].maGoiThau, "edited code");
  assert.deepEqual(sent.payload.goithau[0].phanLoList, importedRecord.phanLoList);
  assert.deepEqual(sent.payload.goithau[0].ehsmtAdjustments, changedObject);
  assert.equal(sent.payload.goithau[0].tuyChonMuaThemList, null);
  assert.deepEqual(sent.payload.goithau[0].sourceRevision, importedRecord.sourceRevision);
  assert.equal(sent.payload.goithau[0].expectedVersion, 3);
  assert.deepEqual(sent.snapshot.baseSnapshots.goithau[base.id], base);
  reloaded.ack(sent.snapshot);
  await reloaded.flush();
  assert.deepEqual(backends.envelope.queue.upserts, {});
  assert.deepEqual(backends.envelope.queue.patches, {});
  assert.deepEqual(backends.envelope.queue.baseSnapshots, {});
});

test("a stale partial patch changes only its authored fields in an unseen sibling upsert", async () => {
  const backends = sharedAtomicBackends();
  const seed = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await seed.hydrate();
  const base = { id: "package-a", fieldA: "server-a", rowVersion: 3, organizationId: "org-a" };
  seed.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldA: "old-a" }], baseRecords: [base] });
  await seed.flush();
  const imported = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  const stale = outboxForStore(new WorkspaceMutationOutboxStore(backends));
  await Promise.all([imported.hydrate(), stale.hydrate()]);
  imported.enqueue({
    kind: "upsert", table: "goithau",
    records: [{ ...base, fieldA: "imported-a", fieldC: ["imported-c"] }],
    baseRecords: [base],
  });
  await imported.flush();
  stale.enqueue({ kind: "patch", table: "goithau", records: [{ id: base.id, fieldB: null }], baseRecords: [base] });
  await stale.flush();

  assert.deepEqual(backends.envelope.queue.upserts.goithau?.[base.id], {
    ...base, fieldA: "imported-a", fieldB: null, fieldC: ["imported-c"],
  });
  assert.deepEqual(backends.envelope.queue.patches, {});
  assert.deepEqual(backends.envelope.queue.baseSnapshots.goithau[base.id], base);
});

test("stale tab cannot resurrect an acknowledged deletion while enqueuing another record", async () => {
  const backends = sharedAtomicBackends();
  const seed = new WorkspaceMutationOutboxStore(backends);
  const deletion = { table: "goithau", id: "package-deleted", expectedVersion: 3 };
  const queue = { ...queueWithUpsert("unused"), upserts: {}, deletes: [deletion] };
  seed.persist(queue, [deletion]);
  await seed.flush();
  const ackTab = new WorkspaceMutationOutboxStore(backends);
  const enqueueTab = new WorkspaceMutationOutboxStore(backends);
  await Promise.all([ackTab.hydrate(), enqueueTab.hydrate()]);

  ackTab.persist(null, []);
  await ackTab.flush();
  enqueueTab.persist({ ...queueWithUpsert("package-b"), deletes: [deletion] }, [deletion]);
  await enqueueTab.flush();

  assert.deepEqual(backends.envelope.queue.deletes, []);
  assert.deepEqual(backends.envelope.localDeletions, []);
  assert.equal(backends.envelope.queue.upserts.goithau["package-b"].id, "package-b");
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
  assert.deepEqual(backends.envelope.localDeletions, []);
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
