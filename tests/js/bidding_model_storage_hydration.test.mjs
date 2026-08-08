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


test("compatibility full-table persistence accepts a successful empty read", async () => {
  const { model, writes } = createModel({ readTable: () => [] });
  model.state.goithau = [{ id: "package-created-locally", value: 1 }];

  await model.persistData("goithau", { throwOnError: true });

  assert.deepEqual(writes, [{
    records: [{ id: "package-created-locally", value: 1 }],
    table: "goithau",
  }]);
  assert.deepEqual(model.getMutationQueue().upserts.goithau, {
    "package-created-locally": { id: "package-created-locally", value: 1 },
  });
});


test("compatibility full-table persistence fails closed on IndexedDB read errors", async (t) => {
  for (const code of [
    "OPERATION_FAILED",
    "TRANSACTION_ABORTED",
    "CORRUPTED_OR_INCOMPATIBLE",
    "PERMISSION_DENIED",
  ]) {
    await t.test(code, async () => {
      const { model, writes } = createModel({
        readTable: () => { throw readError(code); },
      });
      await model.hydrateMutationOutbox();
      model.markRecordDirty("goithau", [{ id: "already-pending", value: 1 }]);
      await model.flushMutationOutbox();
      const pendingBefore = model.getMutationQueue();
      model.state.goithau = [{ id: "replacement", value: 2 }];

      await assert.rejects(
        withoutConsoleErrors(() => model.persistData("goithau", { throwOnError: true })),
        (error) => error instanceof BrowserDBError
          && error.code === code
          && error.operation === "read"
          && error.store === "goithau",
      );

      assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");
      assert.deepEqual(writes, []);
      assert.deepEqual(model.getMutationQueue(), pendingBefore);
    });
  }
});


test("compatibility full-table persistence succeeds after explicit read recovery", async () => {
  let recovered = false;
  const { model, writes } = createModel({
    readTable: () => {
      if (!recovered) throw readError("TRANSACTION_ABORTED");
      return [{ id: "stored-before-retry", value: 1 }];
    },
  });
  model.state.goithau = [{ id: "replacement", value: 2 }];

  await assert.rejects(
    withoutConsoleErrors(() => model.persistData("goithau", { throwOnError: true })),
    { code: "TRANSACTION_ABORTED" },
  );
  recovered = true;
  await model.loadStorageKeys(["GOITHAU"]);
  model.state.goithau = [{ id: "replacement", value: 2 }];

  await model.persistData("goithau", { throwOnError: true });

  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.deepEqual(writes, [{
    records: [{ id: "replacement", value: 2 }],
    table: "goithau",
  }]);
  assert.deepEqual(model.getMutationQueue().deletes, [{
    id: "stored-before-retry",
    table: "goithau",
  }]);
});


test("a table recovers locally after a read failure that follows successful hydration", async () => {
  let readMode = "ready";
  let goiThauReads = 0;
  const storedPackage = { id: "stored-package", value: 1 };
  const { model, writes } = createModel({
    readTable(table) {
      if (table !== "goithau") return [];
      goiThauReads += 1;
      if (readMode === "failed") throw readError("TRANSACTION_ABORTED");
      return [storedPackage];
    },
  });

  await model.hydrateMutationOutbox();
  await model.loadStorageKeys(["GOITHAU"]);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.deepEqual(model.state.goithau, [storedPackage]);

  model.markRecordDirty("goithau", [{ id: "already-pending", value: 9 }]);
  await model.flushMutationOutbox();
  const pendingBeforeFailure = model.getMutationQueue();
  readMode = "failed";
  await assert.rejects(
    withoutConsoleErrors(() => model.persistData("goithau", { throwOnError: true })),
    { code: "TRANSACTION_ABORTED" },
  );
  assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");
  assert.throws(() => model.assertStorageTablesWritable("goithau"), {
    code: "TRANSACTION_ABORTED",
  });
  assert.deepEqual(writes, []);
  assert.deepEqual(model.getMutationQueue(), pendingBeforeFailure);

  readMode = "ready";
  await model.loadStorageKeys(["GOITHAU"]);

  assert.equal(goiThauReads, 3);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.deepEqual(model.state.goithau, [storedPackage]);
  assert.doesNotThrow(() => model.assertStorageTablesWritable("goithau"));
  assert.deepEqual(model.getMutationQueue(), pendingBeforeFailure);
  model.state.goithau = [{ id: "stored-package", value: 2 }];
  await model.persistData("goithau", { throwOnError: true });
  assert.deepEqual(writes, [{
    records: [{ id: "stored-package", value: 2 }],
    table: "goithau",
  }]);
});


test("ensureAllDataLoaded retries only a table that failed after the cached load completed", async () => {
  let goiThauFailed = false;
  const reads = { goithau: 0, kehoach: 0 };
  const { model } = createModel({
    readTable(table) {
      reads[table] += 1;
      if (table === "goithau" && goiThauFailed) {
        throw readError("OPERATION_FAILED");
      }
      return [{ id: `${table}-stored` }];
    },
  });

  await model.ensureAllDataLoaded();
  assert.deepEqual(reads, { goithau: 1, kehoach: 1 });
  goiThauFailed = true;
  await assert.rejects(
    withoutConsoleErrors(() => model.trackDeletions("goithau")),
    { code: "OPERATION_FAILED" },
  );
  assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");

  goiThauFailed = false;
  await model.ensureAllDataLoaded();

  assert.deepEqual(reads, { goithau: 3, kehoach: 1 });
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.equal(model.getStorageHydrationStatus("kehoach").state, "ready");
});


test("a failed local retry preserves memory and keeps the table write-locked", async () => {
  let shouldFail = false;
  const storedPackage = { id: "stored-package", value: 1 };
  const { model, writes } = createModel({
    readTable(table) {
      if (table !== "goithau") return [];
      if (shouldFail) throw readError("PERMISSION_DENIED");
      return [storedPackage];
    },
  });

  await model.loadStorageKeys(["GOITHAU"]);
  const preservedMemory = model.state.goithau;
  shouldFail = true;
  await assert.rejects(
    withoutConsoleErrors(() => model.trackDeletions("goithau")),
    { code: "PERMISSION_DENIED" },
  );

  await withoutConsoleErrors(() => model.loadStorageKeys(["GOITHAU"]));

  assert.strictEqual(model.state.goithau, preservedMemory);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");
  assert.throws(() => model.assertStorageTablesWritable("goithau"), {
    code: "PERMISSION_DENIED",
  });
  assert.deepEqual(writes, []);
});


test("concurrent callers share one failed-table hydration retry", async () => {
  let mode = "ready";
  let reads = 0;
  let releaseRetry;
  const retryRead = new Promise((resolve) => { releaseRetry = resolve; });
  const storedPackage = { id: "stored-package", value: 1 };
  const { model, writes } = createModel({
    readTable(table) {
      if (table !== "goithau") return [];
      reads += 1;
      if (mode === "failed") throw readError("TRANSACTION_ABORTED");
      if (mode === "retrying") return retryRead;
      return [storedPackage];
    },
  });

  await model.hydrateMutationOutbox();
  await model.loadStorageKeys(["GOITHAU"]);
  model.markRecordDirty("goithau", [{ id: "already-pending" }]);
  await model.flushMutationOutbox();
  const pendingBeforeRetry = model.getMutationQueue();
  mode = "failed";
  await assert.rejects(
    withoutConsoleErrors(() => model.trackDeletions("goithau")),
    { code: "TRANSACTION_ABORTED" },
  );

  mode = "retrying";
  const retryA = model.loadStorageKeys(["GOITHAU"]);
  const retryB = model.loadStorageKeys(["GOITHAU"]);
  await Promise.resolve();

  assert.equal(reads, 3);
  releaseRetry([storedPackage]);
  await Promise.all([retryA, retryB]);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.deepEqual(model.state.goithau, [storedPackage]);
  assert.deepEqual(model.getMutationQueue(), pendingBeforeRetry);
  assert.deepEqual(writes, []);
});


test("workspace switch clears loaded, failed, and all-data hydration state", async () => {
  let workspace = "a";
  let workspaceAFailed = false;
  const reads = { a: 0, b: 0 };
  const { model } = createModel({
    readTable(table) {
      if (table !== "goithau") return [];
      reads[workspace] += 1;
      if (workspace === "a" && workspaceAFailed) {
        throw readError("CORRUPTED_OR_INCOMPATIBLE");
      }
      return [{ id: `package-${workspace}` }];
    },
  });

  await model.ensureAllDataLoaded();
  workspaceAFailed = true;
  await assert.rejects(
    withoutConsoleErrors(() => model.trackDeletions("goithau")),
    { code: "CORRUPTED_OR_INCOMPATIBLE" },
  );
  assert.equal(model.getStorageHydrationStatus("goithau").state, "failed");

  await model.deactivateWorkspace();
  assert.equal(model.getStorageHydrationStatus("goithau").state, "pending");
  assert.equal(model.hasStorageReadFailures(), false);
  workspace = "b";
  model.workspaceScope = { key: "user:workspace-b", organizationId: "workspace-b" };
  model.workspaceStorage = storage();

  await model.ensureAllDataLoaded();

  assert.deepEqual(reads, { a: 2, b: 1 });
  assert.deepEqual(model.state.goithau, [{ id: "package-b" }]);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.doesNotThrow(() => model.assertStorageTablesWritable("goithau"));
});


test("an in-flight recovery from workspace A cannot overwrite workspace B", async () => {
  let mode = "a-ready";
  let releaseWorkspaceARecovery;
  const workspaceARecovery = new Promise((resolve) => {
    releaseWorkspaceARecovery = resolve;
  });
  const { model } = createModel({
    readTable(table) {
      if (table !== "goithau") return [];
      if (mode === "a-failed") throw readError("OPERATION_FAILED");
      if (mode === "a-retrying") return workspaceARecovery;
      if (mode === "b-ready") return [{ id: "package-b" }];
      return [{ id: "package-a" }];
    },
  });

  await model.loadStorageKeys(["GOITHAU"]);
  mode = "a-failed";
  await assert.rejects(
    withoutConsoleErrors(() => model.trackDeletions("goithau")),
    { code: "OPERATION_FAILED" },
  );
  mode = "a-retrying";
  const staleWorkspaceARetry = model.loadStorageKeys(["GOITHAU"]);
  await Promise.resolve();

  await model.deactivateWorkspace();
  model.workspaceScope = { key: "user:workspace-b", organizationId: "workspace-b" };
  model.workspaceStorage = storage();
  mode = "b-ready";
  await model.loadStorageKeys(["GOITHAU"]);
  releaseWorkspaceARecovery([{ id: "package-a-stale" }]);
  await staleWorkspaceARetry;

  assert.deepEqual(model.state.goithau, [{ id: "package-b" }]);
  assert.equal(model.getStorageHydrationStatus("goithau").state, "ready");
  assert.equal(model.hasStorageReadFailures(), false);
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
