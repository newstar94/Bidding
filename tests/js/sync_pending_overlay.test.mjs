import test from "node:test";
import assert from "node:assert/strict";

import { applyServerSnapshot } from "../../frontend/app/syncMergeUtils.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";

test("delta pull cannot overwrite a pending local upsert", async () => {
  const persisted = [];
  const localRecord = { id: "package-1", name: "LOCAL UNSYNCED", rowVersion: 3 };
  const model = {
    state: { goithau: [structuredClone(localRecord)] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: { goithau: { "package-1": structuredClone(localRecord) } },
      deletes: [],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    goithau: [{ id: "package-1", name: "SERVER STALE", rowVersion: 2 }],
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, [localRecord]);
  assert.deepEqual(persisted[0].upserts.goithau, [localRecord]);
});

test("full pull keeps pending local upsert as the visible and durable overlay", async () => {
  const persisted = [];
  const localRecord = { id: "package-1", name: "LOCAL FULL", rowVersion: 4 };
  const model = {
    state: { goithau: [structuredClone(localRecord)] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: { goithau: { "package-1": structuredClone(localRecord) } },
      deletes: [],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    goithau: [
      { id: "package-1", name: "SERVER FULL", rowVersion: 2 },
      { id: "package-2", name: "SERVER OTHER", rowVersion: 1 },
    ],
  }, { useVersionDelta: false, since: "0" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, [
    localRecord,
    { id: "package-2", name: "SERVER OTHER", rowVersion: 1 },
  ]);
  assert.deepEqual(persisted[0].replacements.goithau, model.state.goithau);
});

test("delta pull cannot resurrect a record with a pending local delete", async () => {
  const persisted = [];
  const model = {
    state: { goithau: [] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: {},
      deletes: [{ table: "goithau", id: "package-1", expectedVersion: 3 }],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    goithau: [{ id: "package-1", name: "SERVER STILL PRESENT", rowVersion: 3 }],
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(persisted[0].upserts.goithau, []);
});

test("server deletion cannot remove a record with a newer pending local upsert", async () => {
  const persisted = [];
  const localRecord = { id: "package-1", name: "EDIT AFTER SERVER DELETE" };
  const model = {
    state: { goithau: [structuredClone(localRecord)] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: { goithau: { "package-1": structuredClone(localRecord) } },
      deletes: [],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    deletions: [{ table: "goithau", id: "package-1" }],
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, [localRecord]);
  assert.equal(result.deletionsByTable.goithau, undefined);
  assert.equal(persisted[0].deletions.goithau, undefined);
});

test("reference hydration cannot resurrect a pending local delete", async () => {
  const model = {
    state: { goithau: [] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: {},
      deletes: [{ table: "goithau", id: "package-1" }],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: { async applySyncChanges() {} },
  };

  const result = applyServerSnapshot(model, {
    referenceData: {
      goithau: [{ id: "package-1", name: "SERVER REFERENCE" }],
    },
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, []);
});

test("record manifest cannot retain a row covered by a pending local delete", async () => {
  const model = {
    state: { goithau: [{ id: "package-1", name: "STALE IDB ROW" }] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: {},
      deletes: [{ table: "goithau", id: "package-1" }],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: { async applySyncChanges() {} },
  };

  const result = applyServerSnapshot(model, {
    recordManifest: { goithau: ["package-1"] },
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, []);
  assert.equal(result.deletionsByTable.goithau, undefined);
});

test("reconnect overlays a durable pending upsert even when delta is empty", async () => {
  const persisted = [];
  const queuedRecord = { id: "package-1", name: "QUEUED BEFORE RELOAD" };
  const model = {
    state: { goithau: [] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: { goithau: { "package-1": structuredClone(queuedRecord) } },
      deletes: [],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    goithau: [],
  }, { useVersionDelta: true, since: "4" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, [queuedRecord]);
  assert.deepEqual(persisted[0].upserts.goithau, [queuedRecord]);
});

test("a second edit after pull preserves every field from the first pending edit", async () => {
  const outbox = new WorkspaceMutationOutbox({
    store: { persist() {}, async flush() {} },
    getBaseSyncVersion: () => "1",
    createId: (() => {
      let id = 0;
      return () => `mutation-${++id}`;
    })(),
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
  const firstEdit = {
    id: "package-1",
    name: "LOCAL FIRST",
    preservedField: "KEEP ME",
    rowVersion: 4,
  };
  outbox.enqueue({ table: "goithau", kind: "upsert", records: [firstEdit] });
  const model = {
    state: { goithau: [structuredClone(firstEdit)] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => outbox.snapshot(),
    suspendMutationTracking: (callback) => callback(),
    db: { async applySyncChanges() {} },
  };

  const result = applyServerSnapshot(model, {
    goithau: [{
      id: "package-1",
      name: "SERVER STALE",
      preservedField: "SERVER VALUE",
      rowVersion: 2,
    }],
  }, { useVersionDelta: true, since: "1" });
  await result.persistencePromise;
  const secondEdit = { ...model.state.goithau[0], note: "SECOND EDIT" };
  outbox.enqueue({ table: "goithau", kind: "upsert", records: [secondEdit] });

  assert.deepEqual(outbox.snapshot().upserts.goithau["package-1"], {
    ...firstEdit,
    note: "SECOND EDIT",
  });
});

test("full pull keeps a pending local delete absent", async () => {
  const persisted = [];
  const model = {
    state: { goithau: [] },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => ({
      upserts: {},
      deletes: [{ table: "goithau", id: "package-1" }],
    }),
    suspendMutationTracking: (callback) => callback(),
    db: {
      async applySyncChanges(changes) {
        persisted.push(structuredClone(changes));
      },
    },
  };

  const result = applyServerSnapshot(model, {
    goithau: [{ id: "package-1", name: "SERVER FULL" }],
  }, { useVersionDelta: false, since: "0" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(persisted[0].replacements.goithau, []);
});
