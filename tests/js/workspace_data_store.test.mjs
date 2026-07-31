import test from "node:test";
import assert from "node:assert/strict";

import { WorkspaceDataStore } from "../../frontend/app/WorkspaceDataStore.js";


function controller({ syncResult = { ok: true }, persistFailure = false, outboxFailure = false } = {}) {
  const calls = [];
  const model = {
    state: { goods: [{ id: "g1", value: 1 }], bids: [{ id: "b1", total: 1 }] },
    async persistData(table) {
      calls.push(`persist:${table}`);
      if (persistFailure) throw new Error("persistence failed");
    },
    async flushMutationOutbox() {
      calls.push("outbox");
      if (outboxFailure) throw new Error("outbox failed");
    },
    db: {
      async putTableData(table) {
        calls.push(`rollback:${table}`);
      },
    },
  };
  return {
    calls,
    model,
    async autoSync() {
      calls.push("sync");
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


test("workspace transaction rolls back persistence outbox and sync failures", async () => {
  for (const options of [
    { persistFailure: true },
    { outboxFailure: true },
    { syncResult: { ok: false, conflict: true } },
  ]) {
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
    assert.equal(outcome.status, options.syncResult ? "conflict" : "rejected");
  }
});


test("workspace transaction supports validation offline queue and idempotent retry", async () => {
  const rejectedTarget = controller();
  const rejectedStore = new WorkspaceDataStore(rejectedTarget);
  const rejected = await rejectedStore.transaction(
    { tables: ["goods"], mutationId: "mutation-rejected" },
    () => ({ status: "rejected", reason: "invalid" }),
  );
  assert.deepEqual(rejected, { status: "rejected", reason: "invalid" });
  assert.deepEqual(rejectedTarget.calls, []);

  const offlineTarget = controller({ syncResult: { ok: true, offline: true } });
  const offlineStore = new WorkspaceDataStore(offlineTarget);
  let mutationCalls = 0;
  const mutate = (draft) => {
    mutationCalls += 1;
    draft.goods[0].value = 3;
  };
  const first = await offlineStore.transaction(
    { tables: ["goods"], mutationId: "mutation-offline" },
    mutate,
  );
  const retry = await offlineStore.transaction(
    { tables: ["goods"], mutationId: "mutation-offline" },
    mutate,
  );

  assert.equal(first.status, "offlineQueued");
  assert.deepEqual(retry, first);
  assert.equal(mutationCalls, 1);
});
