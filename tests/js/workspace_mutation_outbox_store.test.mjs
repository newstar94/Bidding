import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceMutationOutboxStore } from "../../frontend/app/WorkspaceMutationOutboxStore.js";


function createStorage(values = new Map()) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    readJson(key, fallback) {
      const value = this.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    },
    writeJson(key, value) {
      this.setItem(key, JSON.stringify(value));
    },
    values,
  };
}


function mutationQueue(label, revision = 1) {
  return {
    baseSyncVersion: "4",
    clientMutationId: `mutation-${label}`,
    dirtyTables: {},
    upserts: {
      kehoach: {
        "plan-1": { id: "plan-1", tenKeHoach: label },
      },
    },
    deletes: [],
    revision,
  };
}


test("outbox store dual-writes an isolated envelope", async () => {
  const storage = createStorage();
  const databaseValues = new Map();
  const database = {
    async get(key) { return databaseValues.get(key) || null; },
    async set(key, value) { databaseValues.set(key, structuredClone(value)); },
  };
  const store = new WorkspaceMutationOutboxStore({
    storage,
    database,
    now: () => 123,
  });
  const queue = mutationQueue("Bản nháp");
  const deletions = [{ table: "goithau", id: "package-1" }];

  store.persist(queue, deletions);
  queue.upserts.kehoach["plan-1"].tenKeHoach = "Thay đổi sau persist";
  deletions[0].id = "package-2";
  await store.flush();

  const localEnvelope = JSON.parse(storage.getItem("bf_mutation_queue"));
  const databaseEnvelope = databaseValues.get("bf_mutation_queue");
  assert.deepEqual(databaseEnvelope, localEnvelope);
  assert.equal(localEnvelope.savedAt, 123);
  assert.equal(localEnvelope.queue.upserts.kehoach["plan-1"].tenKeHoach, "Bản nháp");
  assert.deepEqual(localEnvelope.localDeletions, [{ table: "goithau", id: "package-1" }]);
});


test("hydrate selects the newest durable envelope", async () => {
  const storage = createStorage();
  storage.writeJson("bf_mutation_queue", {
    version: 1,
    revision: 2,
    savedAt: 200,
    queue: mutationQueue("Local cũ"),
    localDeletions: [],
  });
  const database = {
    async get() {
      return {
        version: 1,
        revision: 3,
        savedAt: 150,
        queue: mutationQueue("IndexedDB mới"),
        localDeletions: [{ table: "nhathau", id: "contractor-1" }],
      };
    },
    async set() {},
  };
  const store = new WorkspaceMutationOutboxStore({ storage, database });

  const hydrated = await store.hydrate({ baseSyncVersion: "9" });

  assert.equal(hydrated.queue.upserts.kehoach["plan-1"].tenKeHoach, "IndexedDB mới");
  assert.deepEqual(hydrated.localDeletions, [{ table: "nhathau", id: "contractor-1" }]);
});


test("a newer tombstone prevents an acknowledged queue from returning", async () => {
  const storage = createStorage();
  storage.writeJson("bf_mutation_queue", {
    version: 1,
    revision: 5,
    savedAt: 500,
    queue: null,
    localDeletions: [],
  });
  const database = {
    async get() {
      return {
        version: 1,
        revision: 4,
        savedAt: 600,
        queue: mutationQueue("Đã đồng bộ"),
        localDeletions: [],
      };
    },
    async set() {},
  };
  const store = new WorkspaceMutationOutboxStore({ storage, database });

  const hydrated = await store.hydrate({ baseSyncVersion: "9" });

  assert.deepEqual(hydrated.queue.upserts, {});
  assert.deepEqual(hydrated.queue.deletes, []);
});


test("legacy queue and deletion mirror remain readable", async () => {
  const storage = createStorage();
  storage.writeJson("bf_mutation_queue", mutationQueue("Legacy"));
  storage.writeJson("bf_local_deletions", [{ table: "hopdong", id: "contract-1" }]);
  const store = new WorkspaceMutationOutboxStore({
    storage,
    database: { async get() { return null; }, async set() {} },
  });

  const hydrated = await store.hydrate({ baseSyncVersion: "9" });

  assert.equal(hydrated.queue.upserts.kehoach["plan-1"].tenKeHoach, "Legacy");
  assert.deepEqual(hydrated.localDeletions, [{ table: "hopdong", id: "contract-1" }]);
});


test("flush reports the latest IndexedDB write failure", async () => {
  const store = new WorkspaceMutationOutboxStore({
    storage: createStorage(),
    database: {
      async get() { return null; },
      async set() { throw new Error("quota exceeded"); },
    },
  });

  store.persist(mutationQueue("Không lưu được"), []);

  await assert.rejects(store.flush(), /quota exceeded/);
});
