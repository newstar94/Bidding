import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceConflictRecoveryStore } from "../../frontend/app/WorkspaceConflictRecoveryStore.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    dump() { return [...values.values()].join("\n"); },
  };
}

function draft(id = "server-draft-1", recordId = "package-1") {
  return {
    id,
    entityType: "goithau",
    tableName: "goi_thau",
    recordId,
    status: "ACTIVE",
    expiresAt: 9999,
  };
}

test("server conflict reference survives reload without storing record payload", () => {
  const storage = memoryStorage();
  const first = new WorkspaceConflictRecoveryStore({ storage, now: () => 1234 });

  const saved = first.remember(draft());

  assert.equal(saved[0].id, "server-draft-1");
  assert.equal(saved[0].savedAt, 1234);
  assert.equal(storage.dump().includes("baseSnapshot"), false);
  assert.equal(storage.dump().includes("localIntent"), false);

  const afterReload = new WorkspaceConflictRecoveryStore({ storage });
  assert.equal(afterReload.count(), 1);
  assert.equal(afterReload.latest().recordId, "package-1");
});

test("refresh replaces local references with the authoritative server list", () => {
  const storage = memoryStorage();
  const store = new WorkspaceConflictRecoveryStore({ storage });
  store.remember(draft("old-draft", "package-old"));

  store.replace([draft("new-draft", "package-new")]);

  assert.equal(store.count(), 1);
  assert.equal(store.latest().id, "new-draft");
  assert.equal(store.latest().recordId, "package-new");
});

test("reference cleanup remains isolated to the current workspace storage", () => {
  const workspaceAStorage = memoryStorage();
  const workspaceBStorage = memoryStorage();
  const workspaceA = new WorkspaceConflictRecoveryStore({ storage: workspaceAStorage });
  const workspaceB = new WorkspaceConflictRecoveryStore({ storage: workspaceBStorage });
  workspaceA.remember(draft("draft-a", "package-a"));
  workspaceB.remember(draft("draft-b", "package-b"));

  assert.equal(workspaceA.clear(), true);
  assert.equal(workspaceA.count(), 0);
  assert.equal(workspaceB.count(), 1);
});
