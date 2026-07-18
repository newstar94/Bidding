import assert from "node:assert/strict";
import test from "node:test";

import { commitSyncCursor, readSyncCursor } from "../../frontend/app/syncCursor.js";

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    values
  };
}

test("sync cursor prefers version delta and supports a forced full fetch", () => {
  const storage = createStorage({
    bf_last_sync_version: "12",
    bf_last_sync_timestamp: "2026-07-14T00:00:00Z"
  });

  assert.deepEqual(readSyncCursor(storage).query, { after_version: "12" });
  assert.deepEqual(readSyncCursor(storage, { forceFull: true }).query, { since: "0" });
});

test("partial snapshots never advance a committed sync cursor", () => {
  const storage = createStorage({ bf_last_sync_version: "12" });
  const partial = commitSyncCursor(storage, {
    partial: true,
    syncVersion: 13,
    timestamp: "2026-07-14T01:00:00Z"
  }, { fetchedAt: 100 });

  assert.equal(partial.syncVersion, null);
  assert.equal(storage.values.get("bf_last_sync_version"), "12");
  assert.equal(storage.values.get("bf_last_fetch_time"), "100");
});

test("full snapshots commit version and timestamp atomically through one adapter", () => {
  const storage = createStorage();
  const committed = commitSyncCursor(storage, {
    partial: false,
    syncVersion: 14,
    timestamp: "2026-07-14T02:00:00Z"
  }, { fetchedAt: 200 });

  assert.equal(committed.syncVersion, "14");
  assert.equal(storage.values.get("bf_last_sync_version"), "14");
  assert.equal(storage.values.get("bf_last_sync_timestamp"), "2026-07-14T02:00:00Z");
});
