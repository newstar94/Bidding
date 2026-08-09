import test from "node:test";
import assert from "node:assert/strict";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { WorkspaceDataStore } from "../../frontend/app/WorkspaceDataStore.js";
import { mutatePersistAndSync } from "../../frontend/shared/MutationService.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    readJson(key, fallback) {
      return structuredClone(values.get(key) ?? fallback);
    },
    writeJson(key, value) {
      values.set(key, structuredClone(value));
    },
  };
}

function workspaceDatabase({
  close,
  deleteRecord,
  deleteRecords,
  getTableData,
  putRecord,
  putRecords,
  putTableData,
  stores = ["goithau"],
} = {}) {
  const values = new Map();
  return {
    stores,
    close() {
      return close?.();
    },
    async get(key) {
      return structuredClone(values.get(key) ?? null);
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async putRecord(table, record) {
      return putRecord?.(table, record);
    },
    async deleteRecord(table, recordId) {
      return deleteRecord?.(table, recordId);
    },
    async putRecords(table, records) {
      return putRecords?.(table, records);
    },
    async deleteRecords(table, recordIds) {
      return deleteRecords?.(table, recordIds);
    },
    async getTableData(table) {
      return getTableData?.(table) ?? [];
    },
    async putTableData(table, records) {
      return putTableData?.(table, records);
    },
  };
}

function installWorkspace(model, { key, state, storage, database }) {
  model.workspaceScope = { key, organizationId: key };
  model.workspaceStorage = storage;
  model.state = state;
  model.db = database;
  model._mutationOutbox = null;
  model._mutationOutboxStoreRef = null;
  model._mutationOutboxStore = null;
  model._mutationOutboxStoreStorage = null;
  model._mutationOutboxStoreDatabase = null;
}

test("addRecord started in workspace A cannot stage into workspace B", async () => {
  const durableWrite = deferred();
  const writesA = [];
  const writesB = [];
  const model = new BiddingModel();
  const stateA = { ...model.state, goithau: [] };
  const stateB = { ...model.state, goithau: [] };
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  const dbA = workspaceDatabase({
    putRecord(table, record) {
      writesA.push([table, structuredClone(record)]);
      return durableWrite.promise;
    },
  });
  const dbB = workspaceDatabase({
    putRecord(table, record) {
      writesB.push([table, structuredClone(record)]);
    },
  });
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: storageA,
    database: dbA,
  });
  const outboxA = model._getMutationOutbox();

  const mutation = model.addRecord("goithau", {
    id: "package-a",
    organizationId: "org-a",
  });
  installWorkspace(model, {
    key: "org-b",
    state: stateB,
    storage: storageB,
    database: dbB,
  });
  durableWrite.resolve();
  await mutation;

  assert.deepEqual(stateA.goithau, [{ id: "package-a", organizationId: "org-a" }]);
  assert.deepEqual(stateB.goithau, []);
  assert.deepEqual(writesA, [["goithau", { id: "package-a", organizationId: "org-a" }]]);
  assert.deepEqual(writesB, []);
  assert.deepEqual(outboxA.snapshot().upserts.goithau, {
    "package-a": { id: "package-a", organizationId: "org-a" },
  });
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});

test("updateRecord started in workspace A cannot stage into workspace B", async () => {
  const durableWrite = deferred();
  const model = new BiddingModel();
  const stateA = { ...model.state, goithau: [{ id: "package-a", name: "before" }] };
  const stateB = { ...model.state, goithau: [{ id: "package-b", name: "workspace B" }] };
  const dbA = workspaceDatabase({ putRecord: () => durableWrite.promise });
  const dbB = workspaceDatabase();
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: memoryStorage(),
    database: dbA,
  });
  const outboxA = model._getMutationOutbox();

  const mutation = model.updateRecord("goithau", {
    id: "package-a",
    name: "after",
  });
  installWorkspace(model, {
    key: "org-b",
    state: stateB,
    storage: memoryStorage(),
    database: dbB,
  });
  durableWrite.resolve();
  await mutation;

  assert.deepEqual(stateA.goithau, [{ id: "package-a", name: "after" }]);
  assert.deepEqual(stateB.goithau, [{ id: "package-b", name: "workspace B" }]);
  assert.deepEqual(outboxA.snapshot().upserts.goithau, {
    "package-a": { id: "package-a", name: "after" },
  });
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});

test("workspace transition waits for an in-flight deleteRecord", async () => {
  const durableDelete = deferred();
  const model = new BiddingModel();
  const stateA = {
    ...model.state,
    goithau: [{ id: "package-a", rowVersion: 7 }],
  };
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: memoryStorage(),
    database: workspaceDatabase({ deleteRecord: () => durableDelete.promise }),
  });
  const outboxA = model._getMutationOutbox();

  const mutation = model.deleteRecord("goithau", "package-a");
  model.beginWorkspaceTransition();
  let drained = false;
  const drain = model.waitForWorkspaceMutations().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  durableDelete.resolve();
  await mutation;
  await drain;

  assert.deepEqual(stateA.goithau, []);
  assert.deepEqual(outboxA.snapshot().deletes, [{
    table: "goithau",
    id: "package-a",
    expectedVersion: 7,
  }]);
});

test("mixed persistChanges upsert and delete stay entirely on workspace A", async () => {
  const upsertWrite = deferred();
  const operationsA = [];
  const operationsB = [];
  const model = new BiddingModel();
  const dbA = workspaceDatabase({
    putRecords(table, records) {
      operationsA.push(["upsert", table, structuredClone(records)]);
      return upsertWrite.promise;
    },
    deleteRecords(table, ids) {
      operationsA.push(["delete", table, structuredClone(ids)]);
    },
  });
  const dbB = workspaceDatabase({
    putRecords(table, records) {
      operationsB.push(["upsert", table, structuredClone(records)]);
    },
    deleteRecords(table, ids) {
      operationsB.push(["delete", table, structuredClone(ids)]);
    },
  });
  installWorkspace(model, {
    key: "org-a",
    state: { ...model.state, goithau: [] },
    storage: memoryStorage(),
    database: dbA,
  });

  const persistence = model.persistChanges("goithau", {
    upserts: [{ id: "package-a", organizationId: "org-a" }],
    deletions: ["old-package-a"],
  }, { throwOnError: true });
  installWorkspace(model, {
    key: "org-b",
    state: { ...model.state, goithau: [] },
    storage: memoryStorage(),
    database: dbB,
  });
  upsertWrite.resolve();
  await persistence;

  assert.deepEqual(operationsA, [
    ["upsert", "goithau", [{ id: "package-a", organizationId: "org-a" }]],
    ["delete", "goithau", ["old-package-a"]],
  ]);
  assert.deepEqual(operationsB, []);
});

test("persistData read, outbox stage, and table write stay on workspace A", async () => {
  const priorTableRead = deferred();
  const writesA = [];
  const writesB = [];
  const model = new BiddingModel();
  const stateA = {
    ...model.state,
    goithau: [{ id: "package-a", organizationId: "org-a" }],
  };
  const stateB = {
    ...model.state,
    goithau: [{ id: "package-b", organizationId: "org-b" }],
  };
  const dbA = workspaceDatabase({
    getTableData: () => priorTableRead.promise,
    putTableData(table, records) {
      writesA.push([table, structuredClone(records)]);
    },
  });
  const dbB = workspaceDatabase({
    putTableData(table, records) {
      writesB.push([table, structuredClone(records)]);
    },
  });
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: memoryStorage(),
    database: dbA,
  });
  const outboxA = model._getMutationOutbox();

  const persistence = model.persistData("goithau", { throwOnError: true });
  installWorkspace(model, {
    key: "org-b",
    state: stateB,
    storage: memoryStorage(),
    database: dbB,
  });
  priorTableRead.resolve([]);
  await persistence;

  assert.deepEqual(writesA, [[
    "goithau",
    [{ id: "package-a", organizationId: "org-a" }],
  ]]);
  assert.deepEqual(writesB, []);
  assert.deepEqual(outboxA.snapshot().upserts.goithau, {
    "package-a": { id: "package-a", organizationId: "org-a" },
  });
  assert.equal(model.getMutationQueue().upserts.goithau, undefined);
});

test("multi-table mutatePersistAndSync never continues on workspace B", async () => {
  const firstWrite = deferred();
  const operationsA = [];
  const operationsB = [];
  const model = new BiddingModel();
  const stateA = {
    ...model.state,
    goithau: [{ id: "package-a", value: 1 }],
    kehoach: [{ id: "plan-a", value: 1 }],
  };
  const stateB = {
    ...model.state,
    goithau: [{ id: "package-b", value: 9 }],
    kehoach: [{ id: "plan-b", value: 9 }],
  };
  let writeCount = 0;
  const dbA = workspaceDatabase({
    stores: ["goithau", "kehoach"],
    putRecords(table, records) {
      operationsA.push([table, structuredClone(records)]);
      writeCount += 1;
      return writeCount === 1 ? firstWrite.promise : undefined;
    },
  });
  const dbB = workspaceDatabase({
    stores: ["goithau", "kehoach"],
    putRecords(table, records) {
      operationsB.push([table, structuredClone(records)]);
    },
  });
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: memoryStorage(),
    database: dbA,
  });
  const outboxA = model._getMutationOutbox();

  const persistence = mutatePersistAndSync({ model }, {
    upserts: {
      goithau: [{ id: "package-a", value: 2 }],
      kehoach: [{ id: "plan-a", value: 2 }],
    },
  }, { tableKeys: ["goithau", "kehoach"] });
  installWorkspace(model, {
    key: "org-b",
    state: stateB,
    storage: memoryStorage(),
    database: dbB,
  });
  firstWrite.resolve();
  await persistence;

  assert.deepEqual(stateA.goithau, [{ id: "package-a", value: 2 }]);
  assert.deepEqual(stateA.kehoach, [{ id: "plan-a", value: 2 }]);
  assert.deepEqual(stateB.goithau, [{ id: "package-b", value: 9 }]);
  assert.deepEqual(stateB.kehoach, [{ id: "plan-b", value: 9 }]);
  assert.deepEqual(operationsA, [
    ["goithau", [{ id: "package-a", value: 2 }]],
    ["kehoach", [{ id: "plan-a", value: 2 }]],
  ]);
  assert.deepEqual(operationsB, []);
  assert.deepEqual(Object.keys(outboxA.snapshot().upserts).sort(), ["goithau", "kehoach"]);
  assert.deepEqual(model.getMutationQueue().upserts, {});
});

test("deactivateWorkspace drains mutations before closing workspace A", async () => {
  const durableDelete = deferred();
  const events = [];
  const model = new BiddingModel();
  installWorkspace(model, {
    key: "org-a",
    state: {
      ...model.state,
      goithau: [{ id: "package-a", rowVersion: 3 }],
    },
    storage: memoryStorage(),
    database: workspaceDatabase({
      close: () => events.push("close-a"),
      deleteRecord: async () => {
        events.push("delete-start");
        await durableDelete.promise;
        events.push("delete-finish");
      },
    }),
  });

  const mutation = model.deleteRecord("goithau", "package-a");
  const deactivation = model.deactivateWorkspace();
  await Promise.resolve();
  assert.deepEqual(events, ["delete-start"]);
  assert.equal(model.workspaceScope.key, "org-a");

  durableDelete.resolve();
  await mutation;
  await deactivation;
  assert.deepEqual(events, ["delete-start", "delete-finish", "close-a"]);
  assert.equal(model.workspaceScope, null);
});

test("workspace switch waits while a WorkspaceDataStore transaction validates", async () => {
  const validation = deferred();
  const model = new BiddingModel();
  installWorkspace(model, {
    key: "org-a",
    state: {
      ...model.state,
      goithau: [{ id: "package-a", value: 1 }],
    },
    storage: memoryStorage(),
    database: workspaceDatabase({
      putRecords() {},
    }),
  });
  const store = new WorkspaceDataStore({ model });

  const transaction = store.transaction({
    tables: ["goithau"],
    mutationId: "deferred-validation-a",
  }, async (draft) => {
    await validation.promise;
    draft.goithau[0].value = 2;
  });
  model.beginWorkspaceTransition();
  let drained = false;
  const drain = model.waitForWorkspaceMutations().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);

  validation.resolve();
  const outcome = await transaction;
  await drain;

  assert.equal(outcome.status, "committed");
  assert.deepEqual(model.state.goithau, [{ id: "package-a", value: 2 }]);
});

test("workspace switch waits through WorkspaceDataStore durable-failure rollback", async () => {
  const failedWrite = deferred();
  const rollbackWrite = deferred();
  const rollbackStarted = deferred();
  const previousConsoleError = console.error;
  console.error = () => {};
  const model = new BiddingModel();
  let writeCount = 0;
  installWorkspace(model, {
    key: "org-a",
    state: {
      ...model.state,
      goithau: [{ id: "package-a", value: 1 }],
    },
    storage: memoryStorage(),
    database: workspaceDatabase({
      putRecords() {
        writeCount += 1;
        if (writeCount === 1) return failedWrite.promise;
        rollbackStarted.resolve();
        return rollbackWrite.promise;
      },
    }),
  });
  const store = new WorkspaceDataStore({ model });

  try {
    const patching = store.patch({
      mutationId: "durable-failure-a",
      upserts: { goithau: [{ id: "package-a", value: 2 }] },
    });
    model.beginWorkspaceTransition();
    let drained = false;
    const drain = model.waitForWorkspaceMutations().then(() => {
      drained = true;
    });
    failedWrite.reject(new Error("IndexedDB quota"));
    const phase = await Promise.race([
      rollbackStarted.promise.then(() => "rollback-started"),
      patching.then(() => "patch-finished"),
    ]);
    assert.equal(phase, "rollback-started");
    await Promise.resolve();
    assert.equal(drained, false);

    rollbackWrite.resolve();
    const outcome = await patching;
    await drain;
    assert.equal(outcome.status, "persistenceFailed");
    assert.deepEqual(model.state.goithau, [{ id: "package-a", value: 1 }]);
  } finally {
    console.error = previousConsoleError;
  }
});

test("failed workspace A addRecord never stages into workspace B", async () => {
  const failedWrite = deferred();
  const previousConsoleError = console.error;
  console.error = () => {};
  const model = new BiddingModel();
  const stateA = { ...model.state, goithau: [] };
  const stateB = { ...model.state, goithau: [] };
  installWorkspace(model, {
    key: "org-a",
    state: stateA,
    storage: memoryStorage(),
    database: workspaceDatabase({ putRecord: () => failedWrite.promise }),
  });
  const outboxA = model._getMutationOutbox();

  try {
    const mutation = model.addRecord("goithau", { id: "package-a" });
    installWorkspace(model, {
      key: "org-b",
      state: stateB,
      storage: memoryStorage(),
      database: workspaceDatabase(),
    });
    failedWrite.reject(new Error("IndexedDB quota"));

    await assert.rejects(mutation, /IndexedDB quota/);
    assert.equal(outboxA.snapshot().upserts.goithau, undefined);
    assert.equal(model.getMutationQueue().upserts.goithau, undefined);
    assert.deepEqual(stateB.goithau, []);
  } finally {
    console.error = previousConsoleError;
  }
});
