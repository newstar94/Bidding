import assert from "node:assert/strict";
import test from "node:test";

import {
  listPendingSyncItems,
  pendingSyncItemDisplay
} from "../../frontend/app/PendingSyncDialog.js";
import {
  continuePendingSync,
  removePendingSyncItem
} from "../../frontend/app/BiddingControllerSync.js";

test("pending sync list includes upserts, deletions and per-record conflicts", () => {
  const items = listPendingSyncItems({
    upserts: {
      goithau: {
        "gt-1": { id: "gt-1", maGoiThau: "ib-01", tenGoiThau: "Mua sắm" }
      }
    },
    deletes: [{ table: "nhathau", id: "nt-1" }]
  }, {
    errors: [{ table: "goithau", id: "gt-1" }]
  });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.operation).sort(), ["delete", "upsert"]);
  assert.equal(items.find(item => item.id === "gt-1").conflict, true);
  assert.equal(items.find(item => item.id === "nt-1").conflict, false);
  assert.deepEqual(pendingSyncItemDisplay(items[0]), {
    table: "Gói thầu",
    title: "ib-01",
    description: "Mua sắm",
    operation: "Thêm/Cập nhật"
  });
});

test("continue pending sync retries valid data through the normal sync flow", async () => {
  let autoSyncCalls = 0;
  const controller = {
    model: { getPendingMutationSummary: () => ({ pendingCount: 2 }) },
    autoSync: async () => {
      autoSyncCalls += 1;
      return { ok: true };
    }
  };

  assert.deepEqual(await continuePendingSync.call(controller), { ok: true });
  assert.equal(autoSyncCalls, 1);
});

test("removing a pending item refreshes authoritative data and preserves siblings", async () => {
  const removedCalls = [];
  let forceSyncCalls = 0;
  const controller = {
    model: {
      removePendingMutation(type, id, operation) {
        removedCalls.push({ type, id, operation });
        return { type, id, operation };
      },
      getPendingMutationSummary: () => ({ pendingCount: 1 })
    },
    _syncConflict: {
      data: {
        errors: [
          { table: "goithau", id: "gt-remove" },
          { table: "goithau", id: "gt-keep" }
        ]
      }
    },
    forceSyncData: async () => {
      forceSyncCalls += 1;
      return { ok: true };
    }
  };

  const result = await removePendingSyncItem.call(controller, {
    type: "goithau",
    id: "gt-remove",
    operation: "upsert"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(removedCalls, [{ type: "goithau", id: "gt-remove", operation: "upsert" }]);
  assert.deepEqual(controller._syncConflict.data.errors, [{ table: "goithau", id: "gt-keep" }]);
  assert.equal(forceSyncCalls, 1);
});
