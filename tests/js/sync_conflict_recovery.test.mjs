import assert from "node:assert/strict";
import test from "node:test";

import { reconcileRouteDataAtStartup } from "../../frontend/app/startupReconciliation.js";
import {
  finalizePulledSyncState,
  resolveRowVersionConflicts,
} from "../../frontend/app/BiddingControllerSync.js";


test("startup does not submit the same mutation again after a conflict", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, conflict: true, status: 409 };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  const result = await reconcileRouteDataAtStartup(controller);

  assert.equal(result, false);
  assert.deepEqual(calls, ["push", "pull"]);
});


test("startup flushes once, pulls once, and skips an empty replay", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true, skipped: calls.length === 1 };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: false };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), true);
  assert.deepEqual(calls, ["push", "pull"]);
});


test("startup replays only mutations produced while reconciling the pull", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true, localMutationsPending: true };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), true);
  assert.deepEqual(calls, ["push", "pull", "push"]);
});


test("startup keeps the local snapshot when the pull is offline", async () => {
  const calls = [];
  const controller = {
    markStartup() {},
    async autoSync() {
      calls.push("push");
      return { ok: false, error: new Error("offline") };
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: false, error: new Error("offline") };
    },
  };

  assert.equal(await reconcileRouteDataAtStartup(controller), false);
  assert.deepEqual(calls, ["push", "pull"]);
});


test("a successful pull cannot report synced while the outbox is pending", () => {
  const patches = [];
  const controller = {
    model: { buildMutationSyncPayload: () => ({ clientMutationId: "pending-1" }) },
    updateSyncState(patch) { patches.push(patch); },
  };

  assert.equal(finalizePulledSyncState(controller, 123), true);
  assert.deepEqual(patches, [{
    phase: "error",
    online: true,
    message: "CÃ³ thay Ä‘á»•i chÆ°a Ä‘á»“ng bá»™",
  }]);
});


test("a successful pull reports synced after the outbox is empty", () => {
  const patches = [];
  const controller = {
    model: { buildMutationSyncPayload: () => null },
    updateSyncState(patch) { patches.push(patch); },
  };

  assert.equal(finalizePulledSyncState(controller, 123), false);
  assert.deepEqual(patches, [{ phase: "idle", online: true, lastSyncedAt: 123 }]);
});


test("row version conflicts always use server data without prompting", async () => {
  const calls = [];
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  const error = {
    table: "ke_hoach_lcnt",
    id: "plan-1",
    code: "ROW_VERSION_CONFLICT",
    serverRecord: { id: "plan-1", maKeHoach: "PL01", tenKeHoach: "Kế hoạch server" },
  };
  const controller = {
    model: {
      state: { kehoach: [] },
      discardRejectedMutations(errors, snapshot) {
        calls.push(["discard", errors, snapshot]);
        return [{ type: "kehoach", id: "plan-1", conflictingId: "" }];
      },
      db: { async deleteRecord() {} },
    },
    view: {
      showToast(title, message) { calls.push(["toast", title, message]); },
      customConflictDialog() { throw new Error("Conflict dialog must not open"); },
    },
    async fetchRecordByLookup(type, id) {
      calls.push(["fetch", type, id]);
      return error.serverRecord;
    },
  };

  try {
    const result = await resolveRowVersionConflicts(controller, {
      data: { errors: [error] },
      snapshot: { id: "receipt-1" },
    });

    assert.deepEqual(result, { resolved: true, choice: "server", automatic: true });
    assert.equal(calls.some(([kind]) => kind === "discard"), true);
    assert.equal(calls.some(([kind]) => kind === "fetch"), true);
    assert.equal(calls.some(([kind]) => kind === "toast"), true);
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
});
