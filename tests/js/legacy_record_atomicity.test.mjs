import test from "node:test";
import assert from "node:assert/strict";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";

function clone(value) {
  return structuredClone(value);
}

function memoryStorage() {
  const values = new Map();
  let nextWriteFailure = null;
  return {
    getItem: (key) => values.get(key) ?? null,
    readJson: (key, fallback) => clone(values.get(key) ?? fallback),
    writeJson(key, value) {
      if (nextWriteFailure) {
        const error = nextWriteFailure;
        nextWriteFailure = null;
        throw error;
      }
      values.set(key, clone(value));
    },
    failNextWrite(error) {
      nextWriteFailure = error;
    },
  };
}

function durableDatabase(initialRecords = []) {
  const records = new Map(initialRecords.map((record) => [String(record.id), clone(record)]));
  const values = new Map();
  let nextRecordWriteFailure = null;
  let nextOutboxWriteFailure = null;
  return {
    stores: ["goithau"],
    failNextRecordWrite(error) {
      nextRecordWriteFailure = error;
    },
    failNextOutboxWrite(error) {
      nextOutboxWriteFailure = error;
    },
    async get(key) {
      return clone(values.get(key) ?? null);
    },
    async set(key, value) {
      if (nextOutboxWriteFailure) {
        const error = nextOutboxWriteFailure;
        nextOutboxWriteFailure = null;
        throw error;
      }
      values.set(key, clone(value));
    },
    async getTableData() {
      return clone([...records.values()]);
    },
    async putRecord(_table, record) {
      if (nextRecordWriteFailure) {
        const error = nextRecordWriteFailure;
        nextRecordWriteFailure = null;
        throw error;
      }
      records.set(String(record.id), clone(record));
    },
    async deleteRecord(_table, recordId) {
      if (nextRecordWriteFailure) {
        const error = nextRecordWriteFailure;
        nextRecordWriteFailure = null;
        throw error;
      }
      records.delete(String(recordId));
    },
  };
}

function installWorkspace(model, { database, storage, records }) {
  model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  model.workspaceStorage = storage;
  model.db = database;
  model.state.goithau = clone(records);
  model._mutationOutbox = null;
  model._mutationOutboxStoreRef = null;
  model._mutationOutboxStore = null;
  model._mutationOutboxStoreStorage = null;
  model._mutationOutboxStoreDatabase = null;
}

test("legacy update rolls back memory and remains unchanged after an IndexedDB quota failure", async () => {
  const before = [{ id: "package-1", name: "before", rowVersion: 3 }];
  const storage = memoryStorage();
  const database = durableDatabase(before);
  const model = new BiddingModel();
  installWorkspace(model, { database, storage, records: before });
  database.failNextRecordWrite(
    Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" }),
  );

  await assert.rejects(
    model.updateRecord("goithau", { id: "package-1", name: "after", rowVersion: 3 }),
    { name: "QuotaExceededError" },
  );

  assert.deepEqual(model.state.goithau, before);
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);

  const reloaded = new BiddingModel();
  installWorkspace(reloaded, {
    database,
    storage,
    records: await database.getTableData("goithau"),
  });
  await reloaded.hydrateMutationOutbox();
  assert.deepEqual(reloaded.state.goithau, before);
  assert.equal(reloaded.getMutationQueue().upserts.goithau, undefined);
});

test("legacy add rolls back memory and durable state when its IndexedDB write fails", async () => {
  const storage = memoryStorage();
  const database = durableDatabase([]);
  const model = new BiddingModel();
  installWorkspace(model, { database, storage, records: [] });
  database.failNextRecordWrite(new Error("IndexedDB add failed"));

  await assert.rejects(
    model.addRecord("goithau", { id: "package-new", name: "new" }),
    /IndexedDB add failed/,
  );

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(await database.getTableData("goithau"), []);
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});

test("legacy delete restores the record and outbox when its IndexedDB write fails", async () => {
  const before = [{ id: "package-1", name: "before", rowVersion: 4 }];
  const storage = memoryStorage();
  const database = durableDatabase(before);
  const model = new BiddingModel();
  installWorkspace(model, { database, storage, records: before });
  database.failNextRecordWrite(new Error("IndexedDB delete failed"));

  await assert.rejects(
    model.deleteRecord("goithau", "package-1"),
    /IndexedDB delete failed/,
  );

  assert.deepEqual(model.state.goithau, before);
  assert.deepEqual(await database.getTableData("goithau"), before);
  assert.deepEqual(model.getMutationQueue().deletes, []);
});

test("legacy update compensates its entity write when localStorage outbox staging fails", async () => {
  const before = [{ id: "package-1", name: "before", rowVersion: 5 }];
  const storage = memoryStorage();
  const database = durableDatabase(before);
  const model = new BiddingModel();
  installWorkspace(model, { database, storage, records: before });
  storage.failNextWrite(new Error("localStorage denied"));

  await assert.rejects(
    model.updateRecord("goithau", { id: "package-1", name: "after", rowVersion: 5 }),
    /localStorage denied/,
  );

  assert.deepEqual(model.state.goithau, before);
  assert.deepEqual(await database.getTableData("goithau"), before);
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});

test("legacy update waits for durable outbox staging and compensates an IndexedDB outbox failure", async () => {
  const before = [{ id: "package-1", name: "before", rowVersion: 6 }];
  const storage = memoryStorage();
  const database = durableDatabase(before);
  const model = new BiddingModel();
  installWorkspace(model, { database, storage, records: before });
  database.failNextOutboxWrite(new Error("outbox IndexedDB failed"));

  await assert.rejects(
    model.updateRecord("goithau", { id: "package-1", name: "after", rowVersion: 6 }),
    /outbox IndexedDB failed/,
  );

  assert.deepEqual(model.state.goithau, before);
  assert.deepEqual(await database.getTableData("goithau"), before);
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});
