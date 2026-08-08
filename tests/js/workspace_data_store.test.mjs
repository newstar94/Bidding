import test from "node:test";
import assert from "node:assert/strict";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { WorkspaceDataStore } from "../../frontend/app/WorkspaceDataStore.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { WorkspaceMutationOutboxStore } from "../../frontend/app/WorkspaceMutationOutboxStore.js";


function clone(value) {
  return structuredClone(value);
}

function controller({
  syncResult = { ok: true },
  syncFailure = null,
  persistFailure = false,
  outboxFailure = false,
} = {}) {
  const calls = [];
  let pendingMutations = [{ table: "legacy", id: "pending-before-transaction" }];
  const durableState = {
    goods: [{ id: "g1", value: 1 }],
    bids: [{ id: "b1", total: 1 }],
  };
  const model = {
    state: clone(durableState),
    captureMutationCheckpoint() {
      return clone(pendingMutations);
    },
    restoreMutationCheckpoint(checkpoint) {
      pendingMutations = clone(checkpoint);
      calls.push("restore-outbox");
    },
    async persistData(table) {
      calls.push(`persist:${table}`);
      pendingMutations.push({ table, id: `${table}-changed` });
      if (persistFailure) throw new Error("persistence failed");
      durableState[table] = clone(this.state[table]);
    },
    async flushMutationOutbox() {
      calls.push("outbox");
      if (outboxFailure) throw new Error("outbox failed");
    },
    db: {
      async putTableData(table, records) {
        calls.push(`rollback:${table}`);
        durableState[table] = clone(records);
      },
    },
  };
  return {
    calls,
    durableState,
    model,
    pendingMutations: () => clone(pendingMutations),
    async autoSync() {
      calls.push("sync");
      if (syncFailure) throw syncFailure;
      return syncResult;
    },
  };
}


test("workspace transaction commits multiple tables and notifies once", async () => {
  const target = controller();
  const store = new WorkspaceDataStore(target);
  const observed = [];
  store.subscribe((state) => state.goods, (goods) => observed.push(goods));

  const outcome = await store.transaction(
    { tables: ["goods", "bids"], mutationId: "mutation-1" },
    (draft) => {
      draft.goods[0].value = 2;
      draft.bids[0].total = 2;
    },
  );

  assert.equal(outcome.status, "committed");
  assert.equal(target.model.state.goods[0].value, 2);
  assert.equal(target.model.state.bids[0].total, 2);
  assert.equal(observed.length, 1);
  assert.deepEqual(target.calls, ["persist:goods", "persist:bids", "outbox", "sync"]);
});


test("workspace transaction reports persistence failure and restores state plus exact outbox checkpoint", async () => {
  for (const options of [{ persistFailure: true }, { outboxFailure: true }]) {
    const target = controller(options);
    const store = new WorkspaceDataStore(target);
    const outcome = await store.transaction(
      { tables: ["goods", "bids"], mutationId: `mutation-${JSON.stringify(options)}` },
      (draft) => {
        draft.goods[0].value = 9;
        draft.bids[0].total = 9;
      },
    );

    assert.equal(target.model.state.goods[0].value, 1);
    assert.equal(target.model.state.bids[0].total, 1);
    assert.equal(target.durableState.goods[0].value, 1);
    assert.equal(target.durableState.bids[0].total, 1);
    assert.equal(outcome.status, "persistenceFailed");
    assert.deepEqual(target.pendingMutations(), [
      { table: "legacy", id: "pending-before-transaction" },
    ]);
  }
});


test("workspace transaction rejects validation before persistence", async () => {
  const target = controller();
  const store = new WorkspaceDataStore(target);
  const outcome = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-rejected" },
    () => ({ status: "rejected", reason: "invalid" }),
  );

  assert.deepEqual(outcome, { status: "validationRejected", reason: "invalid" });
  assert.deepEqual(target.calls, []);
});


test("workspace transaction rolls back a 400 validation rejection and its exact mutation", async () => {
  const target = controller({ syncResult: { ok: false, status: 400, validation: true } });
  const store = new WorkspaceDataStore(target);
  const outcome = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-validation" },
    (draft) => {
      draft.goods[0].value = 7;
    },
  );

  assert.equal(outcome.status, "validationRejected");
  assert.equal(target.model.state.goods[0].value, 1);
  assert.equal(target.durableState.goods[0].value, 1);
  assert.deepEqual(target.pendingMutations(), [
    { table: "legacy", id: "pending-before-transaction" },
  ]);
});


test("workspace transaction preserves local state and outbox for offline and transport failures", async () => {
  const cases = [
    [{ ok: false, offline: true }, "offlineQueued"],
    [{ ok: false, status: 503 }, "transportFailed"],
    [{ ok: false, transport: true, error: new TypeError("network") }, "transportFailed"],
  ];
  for (const [syncResult, expectedStatus] of cases) {
    const target = controller({ syncResult });
    const store = new WorkspaceDataStore(target);
    const outcome = await store.transaction(
      { tables: ["goods"], mutationId: `mutation-${expectedStatus}-${syncResult.status || "network"}` },
      (draft) => {
        draft.goods[0].value = 3;
      },
    );

    assert.equal(outcome.status, expectedStatus);
    assert.equal(target.model.state.goods[0].value, 3);
    assert.equal(target.durableState.goods[0].value, 3);
    assert.equal(target.pendingMutations().at(-1).table, "goods");
    assert.equal(target.calls.some((call) => call.startsWith("rollback:")), false);
  }
});


test("workspace transaction converts a thrown sync transport exception without rollback", async () => {
  const target = controller({ syncFailure: new TypeError("connection reset") });
  const store = new WorkspaceDataStore(target);
  const outcome = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-thrown-transport" },
    (draft) => {
      draft.goods[0].value = 5;
    },
  );

  assert.equal(outcome.status, "transportFailed");
  assert.equal(target.model.state.goods[0].value, 5);
  assert.equal(target.pendingMutations().at(-1).table, "goods");
});


test("workspace transaction preserves local state and outbox on unresolved conflict", async () => {
  const target = controller({ syncResult: { ok: false, status: 409, conflict: true } });
  const store = new WorkspaceDataStore(target);
  const outcome = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-conflict" },
    (draft) => {
      draft.goods[0].value = 4;
    },
  );

  assert.equal(outcome.status, "conflict");
  assert.equal(target.model.state.goods[0].value, 4);
  assert.equal(target.pendingMutations().at(-1).table, "goods");
  assert.equal(target.calls.some((call) => call.startsWith("rollback:")), false);
});


test("workspace transaction keeps accepted offline mutation idempotent", async () => {
  const target = controller({ syncResult: { ok: true, offline: true } });
  const store = new WorkspaceDataStore(target);
  let mutationCalls = 0;
  const mutate = (draft) => {
    mutationCalls += 1;
    draft.goods[0].value = 3;
  };
  const first = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-offline" },
    mutate,
  );
  const retry = await store.transaction(
    { tables: ["goods"], mutationId: "mutation-offline" },
    mutate,
  );

  assert.equal(first.status, "offlineQueued");
  assert.deepEqual(retry, first);
  assert.equal(mutationCalls, 1);
});


test("workspace transaction reports a real BiddingModel IndexedDB write failure", async () => {
  const model = new BiddingModel();
  model.workspaceScope = { organizationId: "org-1" };
  model.workspaceStorage = {
    getItem: () => "0",
    writeJson() {},
  };
  model.state.goithau = [{ id: "package-1", value: 1 }];
  model.db = {
    stores: ["goithau"],
    async getTableData() {
      return [{ id: "package-1", value: 1 }];
    },
    async putTableData() {
      throw Object.assign(new Error("quota exceeded"), { name: "QuotaExceededError" });
    },
    async set() {},
  };
  const target = {
    model,
    async autoSync() {
      return { ok: true };
    },
  };
  const store = new WorkspaceDataStore(target);

  const previousConsoleError = console.error;
  console.error = () => {};
  try {
    const outcome = await store.transaction(
      { tables: ["goithau"], mutationId: "real-idb-failure" },
      (draft) => {
        draft.goithau[0].value = 2;
      },
    );
    assert.equal(outcome.status, "persistenceFailed");
    assert.equal(model.state.goithau[0].value, 1);
  } finally {
    console.error = previousConsoleError;
  }
});


test("restoring a transaction checkpoint survives reload with the prior pending outbox intact", async () => {
  const localValues = new Map();
  const databaseValues = new Map();
  const storage = {
    readJson(key, fallback) {
      return clone(localValues.get(key) ?? fallback);
    },
    writeJson(key, value) {
      localValues.set(key, clone(value));
    },
  };
  const database = {
    async get(key) {
      return clone(databaseValues.get(key) ?? null);
    },
    async set(key, value) {
      databaseValues.set(key, clone(value));
    },
  };
  let nextId = 0;
  const outbox = new WorkspaceMutationOutbox({
    store: new WorkspaceMutationOutboxStore({ storage, database }),
    createId: () => `mutation-${++nextId}`,
  });
  outbox.enqueue({ kind: "upsert", table: "goods", records: [{ id: "old-pending" }] });
  await outbox.flush();
  const checkpoint = outbox.checkpoint();
  outbox.enqueue({ kind: "upsert", table: "goods", records: [{ id: "rejected-new" }] });
  outbox.restore(checkpoint);
  await outbox.flush();

  const reloaded = new WorkspaceMutationOutbox({
    store: new WorkspaceMutationOutboxStore({ storage, database }),
    createId: () => `reload-${++nextId}`,
  });
  await reloaded.hydrate();
  const payload = reloaded.snapshotForSync({ goods: [{ id: "old-pending" }] });

  assert.equal(payload.payload.goods.length, 1);
  assert.equal(payload.payload.goods[0].id, "old-pending");
  assert.equal(payload.payload.goods.some((record) => record.id === "rejected-new"), false);
});


test("workspace patch persists and rolls back only affected record ids", async () => {
  const persisted = [];
  let syncResult = { ok: true };
  const model = {
    state: {
      goods: [
        { id: "unchanged", value: 10 },
        { id: "update", value: 1 },
        { id: "delete", value: 2 },
      ],
    },
    captureMutationCheckpoint: () => ({ queue: "before" }),
    async restoreMutationCheckpoint() {},
    normalizeRecordKeys: (record) => ({ ...record }),
    commitLocalMutation() {},
    markDeleted() {},
    async persistChanges(table, changes) {
      persisted.push({ table, changes: clone(changes) });
    },
    async persistData() {
      throw new Error("patch must not persist a full table");
    },
    async flushMutationOutbox() {},
  };
  const target = {
    model,
    async autoSync() {
      return syncResult;
    },
  };
  const store = new WorkspaceDataStore(target);

  const committed = await store.patch({
    mutationId: "patch-commit",
    upserts: { goods: [{ id: "update", value: 3 }, { id: "create", value: 4 }] },
    deletions: { goods: ["delete"] },
  });
  assert.equal(committed.status, "committed");
  assert.deepEqual(model.state.goods, [
    { id: "unchanged", value: 10 },
    { id: "update", value: 3 },
    { id: "create", value: 4 },
  ]);
  assert.deepEqual(persisted[0], {
    table: "goods",
    changes: {
      upserts: [{ id: "update", value: 3 }, { id: "create", value: 4 }],
      deletions: ["delete"],
    },
  });

  syncResult = { ok: false, status: 400, validation: true };
  const rejected = await store.patch({
    mutationId: "patch-reject",
    upserts: { goods: [{ id: "update", value: 99 }] },
    deletions: { goods: ["create"] },
  });
  assert.equal(rejected.status, "validationRejected");
  assert.deepEqual(model.state.goods, [
    { id: "unchanged", value: 10 },
    { id: "update", value: 3 },
    { id: "create", value: 4 },
  ]);
  assert.equal(persisted.some(({ changes }) => (
    changes.upserts.some((record) => record.id === "unchanged")
  )), false);
});
