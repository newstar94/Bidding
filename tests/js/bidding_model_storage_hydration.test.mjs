import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { BrowserDBError } from "../../frontend/app/BrowserDB.js";
import { WorkspaceDataStore } from "../../frontend/app/WorkspaceDataStore.js";
import { deriveSyncStatus } from "../../frontend/app/syncStatus.js";


function storage() {
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

function createModel({ readTable, stores = ["goithau", "kehoach"] } = {}) {
  const databaseValues = new Map();
  const writes = [];
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org", organizationId: "org" };
  model.workspaceStorage = storage();
  model.db = {
    stores,
    async get(key) {
      return structuredClone(databaseValues.get(key) ?? null);
    },
    async set(key, value) {
      databaseValues.set(key, structuredClone(value));
    },
    async getTableData(table) {
      return readTable?.(table) ?? [];
    },
    async putTableData(table, records) {
      writes.push({ records: structuredClone(records), table });
    },
  };
  return { model, writes };
}

function readError(code, table = "goithau") {
  return new BrowserDBError(code, `read failed: ${code}`, {
    operation: "read",
    store: table,
  });
}

async function withoutConsoleErrors(callback) {
  const previous = console.error;
  console.error = () => {};
  try {
    return await callback();
  } finally {
    console.error = previous;
  }
}


test("successful empty IndexedDB store is ready and never triggers a repair write", async () => {
  const { model, writes } = createModel({ readTable: () => [] });
  model.state.goithau = [{ id: "stale-memory" }];

  await model.loadStorageKeys(["GOITHAU"]);

  assert.deepEqual(model.state.goithau, []);
  assert.deepEqual(model.getStorageHydrationStatus("goithau"), {
    code: null,
    recoverable: false,
    state: "ready",
    table: "goithau",
  });
  assert.deepEqual(writes, []);
});


test("IndexedDB request, permission, and corruption failures preserve memory and stay retryable", async (t) => {
  for (const code of ["OPERATION_FAILED", "PERMISSION_DENIED", "CORRUPTED_OR_INCOMPATIBLE"]) {
    await t.test(code, async () => {
      const existing = [{ id: `preserved-${code}` }];
      const { model, writes } = createModel({
        readTable: () => { throw readError(code); },
      });
      model.state.goithau = existing;

      await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));

      assert.strictEqual(model.state.goithau, existing);
      assert.equal(model.getStorageHydrationStatus("goithau").code, code);
      assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");
      assert.deepEqual(writes, []);
    });
  }
});


test("one failed table does not erase or prevent other tables from loading", async () => {
  const plan = [{ id: "plan-1" }];
  const { model } = createModel({
    readTable(table) {
      if (table === "goithau") throw readError("PERMISSION_DENIED");
      return plan;
    },
  });
  model.state.goithau = [{ id: "package-in-memory" }];

  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU", "KEHOACH"]));

  assert.deepEqual(model.state.goithau, [{ id: "package-in-memory" }]);
  assert.deepEqual(model.state.kehoach, plan);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");
  assert.equal(model.getStorageHydrationStatus("kehoach").state, "ready");
});


test("failed table retries and becomes writable after a successful read", async () => {
  let attempts = 0;
  const { model } = createModel({
    readTable() {
      attempts += 1;
      if (attempts === 1) throw readError("CORRUPTED_OR_INCOMPATIBLE");
      return [{ id: "package-from-retry" }];
    },
  });

  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));
  assert.throws(() => model.assertStorageTablesWritable(["goithau"]), {
    code: "CORRUPTED_OR_INCOMPATIBLE",
  });

  await model.loadStorageKeys(["GOITHAU"]);

  assert.equal(attempts, 2);
  assert.deepEqual(model.state.goithau, [{ id: "package-from-retry" }]);
  assert.doesNotThrow(() => model.assertStorageTablesWritable(["goithau"]));
  assert.equal(model.hasStorageReadFailures(), false);
});


test("read failure neither stages deletion nor overwrites IndexedDB and retains pending outbox", async () => {
  const { model, writes } = createModel({
    readTable: () => { throw readError("OPERATION_FAILED"); },
  });
  await model.hydrateMutationOutbox();
  model.markRecordDirty("goithau", [{ id: "pending-package", value: 1 }]);
  await model.flushMutationOutbox();
  const before = model.getMutationQueue();

  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));

  assert.deepEqual(model.getMutationQueue(), before);
  assert.deepEqual(writes, []);
  assert.throws(
    () => model.commitLocalMutation("goithau", { deletedIds: ["pending-package"] }),
    { code: "OPERATION_FAILED" },
  );
  assert.deepEqual(model.getMutationQueue(), before);
});


test("offline plus local read failure remains explicit and recoverable", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: false },
  });
  try {
    const { model } = createModel({
      readTable: () => { throw readError("PERMISSION_DENIED"); },
    });
    await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));
    assert.deepEqual(model.getStorageReadFailures(), [{
      code: "PERMISSION_DENIED",
      recoverable: true,
      state: "failed",
      table: "goithau",
    }]);
    assert.equal(deriveSyncStatus({ phase: "storageError", online: false }).state, "storage-error");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  }
});


test("workspace transaction blocks before mutation while a table hydration failed", async () => {
  const { model, writes } = createModel({
    readTable: () => { throw readError("CORRUPTED_OR_INCOMPATIBLE"); },
  });
  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));
  let mutationRan = false;
  const store = new WorkspaceDataStore({ model });

  const outcome = await store.transaction(
    { tables: ["goithau"], mutationId: "blocked-hydration" },
    () => { mutationRan = true; },
  );

  assert.equal(outcome.status, "persistenceFailed");
  assert.equal(outcome.reason, "LOCAL_STORAGE_UNAVAILABLE");
  assert.equal(outcome.error.code, "CORRUPTED_OR_INCOMPATIBLE");
  assert.equal(mutationRan, false);
  assert.deepEqual(writes, []);
});


test("authoritative server persistence can recover a failed table", async () => {
  const { model } = createModel({
    readTable: () => { throw readError("OPERATION_FAILED"); },
  });
  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));
  const events = [];
  model.addStorageHydrationListener((event) => events.push(event));

  model.markStorageTablesRecovered(new Set(["goithau"]));

  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.equal(events.at(-1).recovered, true);
  assert.doesNotThrow(() => model.assertStorageTablesWritable("goithau"));
});
