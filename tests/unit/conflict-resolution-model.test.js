import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";

test("keeping local conflict data rebases row versions before retry", async () => {
  const writes = [];
  const storageValues = new Map([["bf_last_sync_version", "9"]]);
  const model = new BiddingModel();
  model.workspaceStorage = {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, String(value)),
    removeItem: (key) => storageValues.delete(key),
    writeJson: (key, value) => storageValues.set(key, JSON.stringify(value)),
    readJson: (key, fallback) => storageValues.has(key) ? JSON.parse(storageValues.get(key)) : fallback
  };
  model.db = {
    stores: ["goithau"],
    putRecord: async (type, record) => writes.push({ type, record }),
    deleteRecord: async () => {}
  };
  model.state.goithau = [{ id: "gt-1", tenGoiThau: "Máy chủ", rowVersion: 7 }];
  const pending = {
    baseSyncVersion: "5",
    clientMutationId: "old",
    revision: 1,
    dirtyTables: {},
    deletes: [],
    upserts: { goithau: { "gt-1": { id: "gt-1", tenGoiThau: "Máy này", rowVersion: 3 } } }
  };

  await model.reapplyPendingMutationQueue(pending, 9);

  assert.equal(model.state.goithau[0].tenGoiThau, "Máy này");
  assert.equal(model.state.goithau[0].rowVersion, 7);
  assert.equal(writes[0].record.rowVersion, 7);
  const rebased = JSON.parse(storageValues.get("bf_mutation_queue"));
  assert.equal(rebased.baseSyncVersion, "9");
  assert.equal(rebased.upserts.goithau["gt-1"].rowVersion, 7);
});
