import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMutationPayload,
  mutationQueueHasChanges,
  normalizeMutationQueue
} from "../../frontend/app/mutationQueue.js";
import { serializeOutboundRecord } from "../../frontend/app/outboundSerializer.js";

test("mutation queue normalization is independent from browser storage", () => {
  const queue = normalizeMutationQueue({ upserts: null, deletes: "bad" }, {
    baseSyncVersion: "4",
    createId: () => "mutation-1"
  });

  assert.equal(queue.baseSyncVersion, "4");
  assert.equal(queue.clientMutationId, "mutation-1");
  assert.deepEqual(queue.upserts, {});
  assert.deepEqual(queue.deletes, []);
  assert.equal(mutationQueueHasChanges(queue), false);
});

test("mutation payload uses canonical table arrays, adds row concurrency and deduplicates deletions", () => {
  const queue = {
    clientMutationId: "mutation-2",
    baseSyncVersion: "8",
    dirtyTables: {},
    upserts: { goithau: { "gt-1": { id: "gt-1", rowVersion: 3 } } },
    deletes: [{ table: "nhathau", id: "nt-1", expectedVersion: 2 }],
    revision: 1
  };
  const result = buildMutationPayload({
    queue,
    state: {},
    localDeletions: [{ table: "nhathau", id: "nt-1", expectedVersion: 2 }],
    isSyncedType: () => true,
    normalizeRecord: (record, type) => serializeOutboundRecord(record, type)
  });

  assert.equal(result.payload.goithau[0].expectedVersion, 3);
  assert.equal(Object.hasOwn(result.payload, "upserts"), false);
  assert.deepEqual(result.payload.deletions, [{ table: "nhathau", id: "nt-1", expectedVersion: 2 }]);
  assert.notEqual(result.snapshot, queue);
});
