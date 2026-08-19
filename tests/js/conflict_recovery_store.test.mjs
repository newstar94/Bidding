import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
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

test("model persists recovery before clearing and flushing the active outbox", async () => {
  const storage = memoryStorage();
  const recoveryStore = new WorkspaceConflictRecoveryStore({
    storage,
    createId: () => "recovery-1",
  });
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-1",
      baseSyncVersion: "11",
      dirtyTables: {},
      upserts: { assignments: { "assignment-1": { id: "assignment-1" } } },
      patches: {},
      deletes: [],
      revision: 1,
    },
    localDeletions: [],
  };
  const calls = [];
  const outbox = {
    checkpoint: () => structuredClone(checkpoint),
    discard() { calls.push("discard"); return true; },
    async flush() { calls.push("flush"); },
  };
  const model = new BiddingModel();
  model._getMutationOutbox = () => outbox;
  model._getConflictRecoveryStore = () => recoveryStore;

  const draft = await model.quarantineMutationBatch({
    data: {
      errors: [{ table: "assignments", id: "assignment-1", code: "ROW_VERSION_CONFLICT" }],
    },
    snapshot: { id: "receipt-1" },
  });

  assert.equal(draft.id, "recovery-1");
  assert.deepEqual(calls, ["discard", "flush"]);
  assert.deepEqual(recoveryStore.latest().checkpoint, checkpoint);
});

test("model never clears the active outbox when recovery persistence fails", async () => {
  const calls = [];
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-1",
      dirtyTables: {},
      upserts: { goithau: { "package-1": { id: "package-1" } } },
      patches: {},
      deletes: [],
    },
    localDeletions: [],
  };
  const model = new BiddingModel();
  model._getMutationOutbox = () => ({
    checkpoint: () => checkpoint,
    discard() { calls.push("discard"); },
    async flush() { calls.push("flush"); },
  });
  model._getConflictRecoveryStore = () => ({ quarantine: () => null });

  assert.equal(await model.quarantineMutationBatch({ data: {} }), null);
  assert.deepEqual(calls, []);
});
