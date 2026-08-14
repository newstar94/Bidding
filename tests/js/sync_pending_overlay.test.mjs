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
    state: {
      goithau: [
        structuredClone(localRecord),
        { id: "package-2", name: "STALE UNASSIGNED" },
      ],
      thongtinmothau: [
        { id: "opening-2", goiThauId: "package-2" },
      ],
    },
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
    ],
    thongtinmothau: [],
  }, { useVersionDelta: false, since: "0" });
  await result.persistencePromise;

  assert.deepEqual(model.state.goithau, [localRecord]);
  assert.deepEqual(model.state.thongtinmothau, []);
  assert.deepEqual(persisted[0].replacements.goithau, model.state.goithau);
  assert.deepEqual(
    persisted[0].replacements.thongtinmothau,
    model.state.thongtinmothau,
  );
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

test("validation rejection removes the rejected plan and every dependent record from the sent batch", () => {
  const outbox = new WorkspaceMutationOutbox({
    store: { persist() {}, async flush() {} },
    getBaseSyncVersion: () => "1",
    createId: (() => {
      let id = 0;
      return () => `mutation-${++id}`;
    })(),
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
    resolveServerTable: (table) => ({
      ke_hoach_lcnt: "kehoach",
      goi_thau: "goithau",
    })[table] || table,
  });
  outbox.enqueue({
    table: "kehoach",
    kind: "upsert",
    records: [{ id: "plan-draft", tenKeHoach: "Kế hoạch lỗi" }],
  });
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [
      { id: "package-1", keHoachId: "plan-draft", tenGoiThau: "TV-01" },
      { id: "package-2", keHoachId: "plan-draft", tenGoiThau: "TV-02" },
      { id: "package-3", keHoachId: "plan-draft", tenGoiThau: "MS" },
      { id: "package-independent", keHoachId: "plan-existing" },
    ],
  });
  outbox.enqueue({
    table: "goithauhanghoa",
    kind: "upsert",
    records: [
      { id: "goods-1", goiThauId: "package-1" },
      { id: "goods-independent", goiThauId: "package-independent" },
    ],
  });
  const sent = outbox.snapshotForSync({});

  const rejected = outbox.reject(sent.snapshot, [{
    table: "ke_hoach_lcnt",
    id: "plan-draft",
    code: "SYNC_ITEM_INVALID",
  }]);

  assert.deepEqual(rejected.map(({ type, id }) => `${type}:${id}`).sort(), [
    "goithau:package-1",
    "goithau:package-2",
    "goithau:package-3",
    "goithauhanghoa:goods-1",
    "kehoach:plan-draft",
  ]);
  assert.deepEqual(outbox.snapshot().upserts, {
    goithau: {
      "package-independent": { id: "package-independent", keHoachId: "plan-existing" },
    },
    goithauhanghoa: {
      "goods-independent": { id: "goods-independent", goiThauId: "package-independent" },
    },
  });
});

test("pending package repairs a missing unsynced plan dependency before retry", () => {
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
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [{ id: "package-1", keHoachId: "plan-draft" }],
  });

  const pending = outbox.snapshotForSync({
    kehoach: [{ id: "plan-draft", chuDauTuId: "investor-draft" }],
    chudautu: [{ id: "investor-draft", tenChuDauTu: "Chủ đầu tư mới" }],
    goithau: [{ id: "package-1", keHoachId: "plan-draft" }],
  });

  assert.deepEqual(pending.payload.kehoach, [{
    id: "plan-draft",
    chuDauTuId: "investor-draft",
  }]);
  assert.deepEqual(pending.payload.chudautu, [{
    id: "investor-draft",
    tenChuDauTu: "Chủ đầu tư mới",
  }]);
  assert.deepEqual(Object.keys(pending.snapshot.upserts).sort(), [
    "chudautu",
    "goithau",
    "kehoach",
  ]);
});

test("pending package does not restage a persisted plan dependency", () => {
  const outbox = new WorkspaceMutationOutbox({
    store: { persist() {}, async flush() {} },
    createId: () => "mutation-1",
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [{ id: "package-1", keHoachId: "plan-existing" }],
  });

  const pending = outbox.snapshotForSync({
    kehoach: [{ id: "plan-existing", rowVersion: 2 }],
    goithau: [{ id: "package-1", keHoachId: "plan-existing" }],
  });

  assert.equal(pending.payload.kehoach, undefined);
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
