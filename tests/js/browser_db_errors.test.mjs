import assert from "node:assert/strict";
import test from "node:test";

import { BrowserDB, BrowserDBError } from "../../frontend/app/BrowserDB.js";


function requestFailure(error) {
  const request = { error };
  queueMicrotask(() => request.onerror?.({ target: request }));
  return request;
}


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
