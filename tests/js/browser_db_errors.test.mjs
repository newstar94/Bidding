import assert from "node:assert/strict";
import test from "node:test";

import { BrowserDB, BrowserDBError } from "../../frontend/app/BrowserDB.js";
import { WorkspaceMutationOutboxStore } from "../../frontend/app/WorkspaceMutationOutboxStore.js";


function requestFailure(error) {
  const request = { error };
  queueMicrotask(() => request.onerror?.({ target: request }));
  return request;
}

function controllableWriteDatabase() {
  let activeTransaction = null;
  const successfulRequest = (result) => {
    const request = { result };
    queueMicrotask(() => request.onsuccess?.({ target: request }));
    return request;
  };
  const database = new BrowserDB("write-durability");
  database.db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      activeTransaction = {
        error: new DOMException("transaction aborted", "AbortError"),
        objectStore() {
          return {
            clear: successfulRequest,
            delete: successfulRequest,
            getAllKeys: () => successfulRequest([]),
            put: successfulRequest,
          };
        },
      };
      return activeTransaction;
    },
  };
  return {
    database,
    abort() {
      activeTransaction?.onabort?.({ target: activeTransaction });
    },
    complete() {
      activeTransaction?.oncomplete?.({ target: activeTransaction });
    },
    fail(error = new DOMException("transaction failed", "UnknownError")) {
      if (!activeTransaction) return;
      activeTransaction.error = error;
      activeTransaction.onerror?.({ target: activeTransaction });
    },
  };
}

async function flushRequestSuccess() {
  await new Promise((resolve) => queueMicrotask(resolve));
  await new Promise((resolve) => queueMicrotask(resolve));
}

async function flushPromiseChain() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const WRITE_OPERATIONS = {
  set: (database) => database.set("key", "value"),
  putRecord: (database) => database.putRecord("goithau", { id: "record-1" }),
  deleteRecord: (database) => database.deleteRecord("goithau", "record-1"),
  putTableData: (database) => database.putTableData("goithau", [{ id: "record-1" }]),
  putRecords: (database) => database.putRecords("goithau", [{ id: "record-1" }]),
  deleteRecords: (database) => database.deleteRecords("goithau", ["record-1"]),
  applySyncChanges: (database) => database.applySyncChanges({
    deletions: { goithau: ["record-old"] },
    upserts: { goithau: [{ id: "record-new" }] },
  }),
};


test("BrowserDB distinguishes an uninitialized database from empty data", async () => {
  const database = new BrowserDB("not-opened");

  await assert.rejects(database.getTableData("goithau"), (error) => (
    error instanceof BrowserDBError && error.code === "NOT_INITIALIZED"
  ));
  await assert.rejects(database.get("missing"), (error) => (
    error instanceof BrowserDBError && error.code === "NOT_INITIALIZED"
  ));
});


test("BrowserDB surfaces quota and corrupted-record failures with stable codes", async () => {
  const database = new BrowserDB("failing");
  database.db = {
    objectStoreNames: { contains: () => true },
    transaction(_store, mode) {
      return {
        objectStore() {
          return mode === "readwrite"
            ? { put: () => requestFailure(new DOMException("quota", "QuotaExceededError")) }
            : { getAll: () => requestFailure(new DOMException("bad data", "DataError")) };
        },
      };
    },
  };

  await assert.rejects(database.set("key", "value"), (error) => (
    error.code === "QUOTA_EXCEEDED" && error.store === "kv_store"
  ));
  await assert.rejects(database.getTableData("goithau"), (error) => (
    error.code === "CORRUPTED_OR_INCOMPATIBLE" && error.store === "goithau"
  ));
});


test("BrowserDB reports a blocked schema upgrade instead of hanging", async () => {
  const originalIndexedDB = globalThis.indexedDB;
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => request.onblocked?.());
      return request;
    },
  };
  try {
    await assert.rejects(new BrowserDB("blocked").init(), (error) => (
      error.code === "MIGRATION_BLOCKED" && error.operation === "open"
    ));
  } finally {
    globalThis.indexedDB = originalIndexedDB;
  }
});


test("BrowserDB write APIs reject when requests succeed but the transaction aborts", async (t) => {
  for (const [name, operation] of Object.entries(WRITE_OPERATIONS)) {
    await t.test(name, async () => {
      const fixture = controllableWriteDatabase();
      const write = operation(fixture.database);
      let outcome = null;
      write.then(
        () => { outcome = { status: "fulfilled" }; },
        (error) => { outcome = { error, status: "rejected" }; },
      );
      await flushRequestSuccess();
      assert.equal(outcome, null, `${name} resolved before the transaction committed`);
      fixture.abort();
      await flushRequestSuccess();
      assert.equal(outcome?.status, "rejected", `${name} did not reject after transaction abort`);
      assert.equal(outcome?.error instanceof BrowserDBError, true);
      assert.equal(outcome?.error.code, "TRANSACTION_ABORTED");
    });
  }
});


test("BrowserDB write APIs stay pending until transaction completion", async (t) => {
  for (const [name, operation] of Object.entries(WRITE_OPERATIONS)) {
    await t.test(name, async () => {
      const fixture = controllableWriteDatabase();
      let outcome = null;
      operation(fixture.database).then(
        () => { outcome = { status: "fulfilled" }; },
        (error) => { outcome = { error, status: "rejected" }; },
      );
      await flushRequestSuccess();
      assert.equal(outcome, null, `${name} resolved before transaction completion`);
      fixture.complete();
      await flushRequestSuccess();
      assert.equal(outcome?.status, "fulfilled");
    });
  }
});


test("BrowserDB write APIs reject transaction errors", async (t) => {
  for (const [name, operation] of Object.entries(WRITE_OPERATIONS)) {
    await t.test(name, async () => {
      const fixture = controllableWriteDatabase();
      let outcome = null;
      operation(fixture.database).then(
        () => { outcome = { status: "fulfilled" }; },
        (error) => { outcome = { error, status: "rejected" }; },
      );
      await flushRequestSuccess();
      fixture.fail();
      await flushRequestSuccess();
      assert.equal(outcome?.status, "rejected");
      assert.equal(outcome?.error instanceof BrowserDBError, true);
      assert.equal(outcome?.error.code, "OPERATION_FAILED");
    });
  }
});


test("outbox writes remain ordered until each IndexedDB transaction commits", async () => {
  const transactions = [];
  const database = new BrowserDB("outbox-ordering");
  database.db = {
    objectStoreNames: { contains: () => true },
    transaction() {
      const transaction = {
        objectStore() {
          return {
            put() {
              const request = {};
              queueMicrotask(() => request.onsuccess?.({ target: request }));
              return request;
            },
          };
        },
      };
      transactions.push(transaction);
      return transaction;
    },
  };
  const store = new WorkspaceMutationOutboxStore({ database, now: () => 1 });

  store.persist({ operations: [{ id: "mutation-1" }] });
  store.persist({ operations: [{ id: "mutation-2" }] });
  await flushPromiseChain();
  assert.equal(transactions.length, 1);

  transactions[0].oncomplete?.({ target: transactions[0] });
  await flushPromiseChain();
  assert.equal(transactions.length, 2);

  let flushOutcome = null;
  store.flush().then(
    () => { flushOutcome = { status: "fulfilled" }; },
    (error) => { flushOutcome = { error, status: "rejected" }; },
  );
  transactions[1].oncomplete?.({ target: transactions[1] });
  await flushPromiseChain();
  assert.equal(flushOutcome?.status, "fulfilled");
  assert.equal(store.writeError, null);
});
