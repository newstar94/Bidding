import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";


function createOutbox({ hydrated = null } = {}) {
  const persisted = [];
  let sequence = 0;
  const store = {
    persist(queue, localDeletions) {
      persisted.push({ queue: structuredClone(queue), localDeletions: structuredClone(localDeletions) });
    },
    async flush() {},
    async hydrate() {
      return hydrated || { queue: {}, localDeletions: [] };
    },
  };
  return {
    persisted,
    outbox: new WorkspaceMutationOutbox({
      store,
      getBaseSyncVersion: () => "5",
      createId: () => `mutation-${++sequence}`,
      isSyncedType: (table) => table !== "local-only",
      normalizeRecord: (record) => structuredClone(record),
      serializeRecord: (record) => structuredClone(record),
    }),
  };
}


test("outbox command variants preserve row versions and delete receipts", () => {
  const { outbox } = createOutbox();
  assert.equal(outbox.enqueue({ kind: "unknown", table: "goithau" }), false);
  assert.equal(outbox.enqueue({ kind: "upsert", table: "local-only", records: [{ id: "local" }] }), false);
  assert.equal(outbox.enqueue({ kind: "replace-table", table: "goithau", records: [] }), false);

  assert.equal(outbox.enqueue({
    kind: "upsert", table: "goithau", records: [{ id: "package-1", rowVersion: 1 }],
  }), true);
  assert.equal(outbox.enqueue({
    kind: "server-row-version", entries: [{ table: "goithau", id: "package-1", rowVersion: 4 }],
  }), true);
  assert.equal(outbox.snapshot().upserts.goithau["package-1"].rowVersion, 4);
  assert.equal(outbox.enqueue({
    kind: "server-row-version", entries: [{ table: "goithau", id: "package-1", rowVersion: 4 }],
  }), false);

  assert.equal(outbox.enqueue({
    kind: "replace-table", table: "nhathau", records: [{ id: "contractor-1" }],
  }), true);
  assert.equal(outbox.enqueue({
    kind: "delete", table: "goithau", records: [{ id: "package-2", rowVersion: 7 }],
  }), true);
  const receipt = outbox.snapshotForSync({}).snapshot;
  const deleteKey = "delete:goithau:package-2";
  assert.equal(receipt.deletes[deleteKey] > 0, true);
  assert.equal(outbox.enqueue({
    kind: "ack-server-deletions", deletionsByTable: { goithau: ["package-2"] },
  }), true);
  assert.equal(outbox.snapshot().deletes.length, 0);
});


test("outbox only acknowledges the generations that were sent", async () => {
  const { outbox } = createOutbox();
  outbox.enqueue({ kind: "upsert", table: "goithau", records: [{ id: "package-1", name: "first" }] });
  const firstReceipt = outbox.snapshotForSync({}).snapshot;
  outbox.enqueue({ kind: "upsert", table: "goithau", records: [{ id: "package-1", name: "second" }] });

  assert.equal(outbox.ack(firstReceipt), false);
  assert.equal(outbox.snapshot().upserts.goithau["package-1"].name, "second");
  const currentReceipt = outbox.snapshotForSync({}).snapshot;
  assert.equal(outbox.ack(currentReceipt), true);
  assert.equal(outbox.snapshotForSync({}), null);
  await outbox.flush();
});

test("older_upsert_response_advances_newer_delete_expected_version_without_acknowledging_it", () => {
  const { outbox } = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "goithau",
    records: [{ id: "package-1", rowVersion: 4 }],
  });
  const upsertReceipt = outbox.snapshotForSync({}).snapshot;
  outbox.enqueue({
    kind: "delete",
    table: "goithau",
    records: [{ id: "package-1", rowVersion: 4 }],
  });

  outbox.enqueue({
    kind: "server-row-version",
    entries: [{ table: "goithau", id: "package-1", rowVersion: 5 }],
  });
  outbox.ack(upsertReceipt);

  assert.deepEqual(outbox.snapshot().deletes, [{
    table: "goithau",
    id: "package-1",
    expectedVersion: 5,
  }]);
});


test("outbox hydrate, restore, rebase, discard and rejection edges are durable", async () => {
  assert.throws(() => new WorkspaceMutationOutbox(), /durable store/u);
  const { outbox, persisted } = createOutbox({
    hydrated: {
      queue: {
        baseSyncVersion: "3", revision: 2, clientMutationId: "rehydrated",
        upserts: { goithau: { "package-1": { id: "package-1" } } },
        deletes: [], dirtyTables: {},
      },
      localDeletions: [{ table: "goithau", id: "removed" }],
    },
  });
  assert.equal(outbox.restore(null), false);
  await outbox.hydrate();
  assert.equal(outbox.enqueue({ kind: "rebase", syncVersion: "8" }), true);
  assert.equal(outbox.enqueue({ kind: "rebase", syncVersion: "8" }), false);
  assert.equal(outbox.enqueue({ kind: "delete", table: "goithau", records: [{ id: "package-1" }] }), true);
  const sent = outbox.snapshotForSync({}).snapshot;
  assert.deepEqual(outbox.reject(sent, [{ table: "goithau", id: "missing" }]), []);
  assert.equal(outbox.discard(), true);
  assert.equal(outbox.discard(), false);
  assert.equal(persisted.at(-1).queue, null);
});

test("terminal unscoped validation rejects only the sent outbox generation", () => {
  const outbox = new WorkspaceMutationOutbox({
    store: { persist() {}, async flush() {} },
    getBaseSyncVersion: () => "1",
    createId: (() => {
      let id = 0;
      return () => `mutation-${++id}`;
    })(),
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [{ id: "package-1", tenGoiThau: "Rejected value" }],
  });
  const sent = outbox.snapshotForSync({});

  const rejected = outbox.reject(sent.snapshot, [{
    field: "$record",
    code: "HISTORICAL_PARENT_IMMUTABLE",
  }], { fallbackToBatch: true });

  assert.deepEqual(rejected, [{
    type: "goithau",
    id: "package-1",
    operation: "upsert",
    conflictingId: "",
  }]);
  assert.deepEqual(outbox.snapshot().upserts, {});
});

test("terminal validation cannot discard a newer edit made after the sent receipt", () => {
  const outbox = new WorkspaceMutationOutbox({
    store: { persist() {}, async flush() {} },
    getBaseSyncVersion: () => "1",
    createId: (() => {
      let id = 0;
      return () => `mutation-${++id}`;
    })(),
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [{ id: "package-1", tenGoiThau: "Sent value" }],
  });
  const sent = outbox.snapshotForSync({});
  outbox.enqueue({
    table: "goithau",
    kind: "upsert",
    records: [{ id: "package-1", tenGoiThau: "Newer value" }],
  });

  const rejected = outbox.reject(sent.snapshot, [{
    field: "$record",
    code: "HISTORICAL_PARENT_IMMUTABLE",
  }], { fallbackToBatch: true });

  assert.deepEqual(rejected, []);
  assert.equal(
    outbox.snapshot().upserts.goithau["package-1"].tenGoiThau,
    "Newer value",
  );
});
