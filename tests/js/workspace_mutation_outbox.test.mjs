import assert from "node:assert/strict";
import test from "node:test";

import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";


class MemoryOutboxStore {
  constructor(initial = null) {
    this.initial = initial;
    this.saved = [];
  }

  persist(queue, localDeletions) {
    this.saved.push(structuredClone({ queue, localDeletions }));
  }

  async hydrate() {
    return structuredClone(this.initial || {
      queue: {
        baseSyncVersion: "0",
        clientMutationId: "initial",
        dirtyTables: {},
        upserts: {},
        deletes: [],
        revision: 0,
      },
      localDeletions: [],
    });
  }

  async flush() {}
}


function createOutbox(initial = null) {
  let id = 0;
  return new WorkspaceMutationOutbox({
    store: new MemoryOutboxStore(initial),
    getBaseSyncVersion: () => "7",
    createId: () => `mutation-${++id}`,
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
  });
}


test("enqueue and snapshot expose a sync payload without leaking internal state", () => {
  const outbox = createOutbox();
  const record = { id: "plan-1", tenKeHoach: "Kế hoạch A" };

  outbox.enqueue({ kind: "upsert", table: "kehoach", records: [record] });
  const sync = outbox.snapshotForSync({});
  record.tenKeHoach = "Đã sửa bên ngoài";
  sync.payload.kehoach[0].tenKeHoach = "Đã sửa payload";

  const next = outbox.snapshotForSync({});
  assert.equal(next.payload.kehoach[0].tenKeHoach, "Kế hoạch A");
  assert.notEqual(next.snapshot.id, "");
});


test("ack of an older snapshot preserves a concurrent edit", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Bản gửi server" }],
  });
  const sent = outbox.snapshotForSync({});

  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Chỉnh trong lúc chờ" }],
  });
  outbox.ack(sent.snapshot);

  const pending = outbox.snapshotForSync({});
  assert.equal(pending.payload.kehoach[0].tenKeHoach, "Chỉnh trong lúc chờ");
});


test("partial ack assigns a new idempotency key to the remaining edit", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [
      { id: "plan-1", tenKeHoach: "Bản cũ" },
      { id: "plan-2", tenKeHoach: "Đã gửi" },
    ],
  });
  const sent = outbox.snapshotForSync({});
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Bản mới" }],
  });
  const beforeAck = outbox.snapshotForSync({});

  outbox.ack(sent.snapshot);

  const remaining = outbox.snapshotForSync({});
  assert.notEqual(remaining.payload.clientMutationId, beforeAck.payload.clientMutationId);
  assert.deepEqual(remaining.payload.kehoach.map((record) => record.id), ["plan-1"]);
});


test("reject of an older snapshot does not discard a concurrent correction", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Không hợp lệ" }],
  });
  const sent = outbox.snapshotForSync({});

  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Đã sửa hợp lệ" }],
  });
  const rejected = outbox.reject(sent.snapshot, [{ table: "kehoach", id: "plan-1" }]);

  assert.deepEqual(rejected, []);
  assert.equal(
    outbox.snapshotForSync({}).payload.kehoach[0].tenKeHoach,
    "Đã sửa hợp lệ",
  );
});


test("reject removes the exact invalid record from the sent snapshot", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [{ id: "plan-1", tenKeHoach: "Không hợp lệ" }],
  });
  const sent = outbox.snapshotForSync({});

  const rejected = outbox.reject(sent.snapshot, [{
    table: "kehoach",
    id: "plan-1",
    conflictingId: "plan-existing",
  }]);

  assert.deepEqual(rejected, [{
    type: "kehoach",
    id: "plan-1",
    operation: "upsert",
    conflictingId: "plan-existing",
  }]);
  assert.equal(outbox.snapshotForSync({}), null);
});


test("partial reject assigns a new idempotency key to the remaining payload", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "kehoach",
    records: [
      { id: "plan-1", tenKeHoach: "Không hợp lệ" },
      { id: "plan-2", tenKeHoach: "Hợp lệ" },
    ],
  });
  const sent = outbox.snapshotForSync({});

  outbox.reject(sent.snapshot, [{ table: "kehoach", id: "plan-1" }]);

  const remaining = outbox.snapshotForSync({});
  assert.notEqual(remaining.payload.clientMutationId, sent.payload.clientMutationId);
  assert.deepEqual(remaining.payload.kehoach.map((record) => record.id), ["plan-2"]);
});


test("a delete supersedes a queued upsert and is acknowledged by snapshot", () => {
  const outbox = createOutbox();
  outbox.enqueue({
    kind: "upsert",
    table: "goithau",
    records: [{ id: "package-1", tenGoiThau: "Gói thầu" }],
  });
  outbox.enqueue({
    kind: "delete",
    table: "goithau",
    records: [{ id: "package-1", rowVersion: 3 }],
  });

  const sent = outbox.snapshotForSync({});
  assert.equal(sent.payload.goithau, undefined);
  assert.deepEqual(sent.payload.deletions, [{
    table: "goithau",
    id: "package-1",
    expectedVersion: 3,
  }]);

  outbox.ack(sent.snapshot);
  assert.equal(outbox.snapshotForSync({}), null);
});
