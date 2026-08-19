import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceConflictRecoveryStore } from "../../frontend/app/WorkspaceConflictRecoveryStore.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("row conflict draft survives reload without remaining in the active outbox", () => {
  const storage = memoryStorage();
  const first = new WorkspaceConflictRecoveryStore({
    storage,
    now: () => 1234,
    createId: () => "recovery-1",
  });
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-1",
      baseSyncVersion: "11",
      dirtyTables: {},
      upserts: {},
      patches: { assignments: { "assignment-1": { id: "assignment-1", expertId: "expert-2" } } },
      deletes: [],
      revision: 3,
    },
    localDeletions: [],
  };

  const saved = first.quarantine(checkpoint, {
    currentSyncVersion: 12,
    errors: [{ table: "assignments", id: "assignment-1", code: "ROW_VERSION_CONFLICT" }],
  });

  assert.equal(saved.id, "recovery-1");
  assert.deepEqual(saved.checkpoint, checkpoint);
  assert.equal(saved.savedAt, 1234);

  const afterReload = new WorkspaceConflictRecoveryStore({ storage });
  assert.equal(afterReload.count(), 1);
  assert.deepEqual(afterReload.latest().checkpoint, checkpoint);
});

test("repeated conflict for the same records replaces one recovery draft", () => {
  const storage = memoryStorage();
  let sequence = 0;
  const store = new WorkspaceConflictRecoveryStore({
    storage,
    createId: () => `recovery-${++sequence}`,
  });
  const conflict = {
    currentSyncVersion: 12,
    errors: [{ table: "goithau", id: "package-1", code: "ROW_VERSION_CONFLICT" }],
  };

  store.quarantine({ queue: { revision: 1 } }, conflict);
  store.quarantine({ queue: { revision: 2 } }, conflict);

  assert.equal(store.count(), 1);
  assert.equal(store.latest().checkpoint.queue.revision, 2);
});

test("reload cleanup clears only the current workspace conflict store", () => {
  const workspaceAStorage = memoryStorage();
  const workspaceBStorage = memoryStorage();
  const workspaceA = new WorkspaceConflictRecoveryStore({ workspaceAStorage, storage: workspaceAStorage });
  const workspaceB = new WorkspaceConflictRecoveryStore({ workspaceBStorage, storage: workspaceBStorage });
  workspaceA.quarantine({ queue: { revision: 1 } }, {
    errors: [{ table: "goithau", id: "package-a", code: "ROW_VERSION_CONFLICT" }],
  });
  workspaceB.quarantine({ queue: { revision: 2 } }, {
    errors: [{ table: "goithau", id: "package-b", code: "ROW_VERSION_CONFLICT" }],
  });

  assert.equal(workspaceA.clear(), true);
  assert.equal(workspaceA.count(), 0);
  assert.equal(workspaceB.count(), 1);
});
