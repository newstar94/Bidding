import test from "node:test";
import assert from "node:assert/strict";

import {
  countPendingMutations,
  prepareExplicitLogout,
  quarantineForcedSession,
} from "../../frontend/auth/logoutMutationSafety.js";

function pendingQueue() {
  return {
    dirtyTables: {},
    upserts: { goithau: { "package-1": { id: "package-1" } } },
    deletes: [{ table: "goithau", id: "package-2" }],
  };
}

test("pending mutation count includes upserts, deletes, and dirty tables", () => {
  assert.equal(countPendingMutations(pendingQueue()), 2);
  assert.equal(countPendingMutations({
    dirtyTables: { kehoach: true },
    upserts: {},
    deletes: [],
  }), 1);
});

test("successful final sync permits logout without discarding data", async () => {
  let discarded = false;
  const controller = {
    autoSync: async () => ({ ok: true }),
    model: {
      getMutationQueue: () => pendingQueue(),
      discardMutationBatch: () => { discarded = true; },
    },
    view: { customConfirm: async () => { throw new Error("must not prompt"); } },
  };

  const decision = await prepareExplicitLogout(controller);

  assert.deepEqual(decision, { discardConfirmed: false, proceed: true });
  assert.equal(discarded, false);
});

test("failed final sync with pending data can cancel logout without purge", async () => {
  let discarded = false;
  const controller = {
    autoSync: async () => ({ ok: false, error: { code: "SYNC_CONFLICT" } }),
    model: {
      getMutationQueue: () => pendingQueue(),
      discardMutationBatch: () => { discarded = true; },
    },
    view: { customConfirm: async () => false },
  };

  const decision = await prepareExplicitLogout(controller);

  assert.equal(decision.proceed, false);
  assert.equal(decision.pendingCount, 2);
  assert.equal(discarded, false);
});

test("throwing final sync requires explicit discard before logout", async () => {
  let discarded = false;
  const controller = {
    autoSync: async () => { throw new Error("network offline"); },
    model: {
      getMutationQueue: () => pendingQueue(),
      discardMutationBatch: () => { discarded = true; return true; },
      flushMutationOutbox: async () => {},
    },
    view: { customConfirm: async (_title, message) => {
      assert.match(message, /2 thay đổi/);
      assert.match(message, /network offline/);
      return true;
    } },
  };

  const decision = await prepareExplicitLogout(controller);

  assert.equal(decision.proceed, true);
  assert.equal(decision.discardConfirmed, true);
  assert.equal(discarded, true);
});

test("failed final sync without pending mutations does not block logout", async () => {
  const controller = {
    autoSync: async () => ({ ok: false }),
    model: {
      getMutationQueue: () => ({ dirtyTables: {}, upserts: {}, deletes: [] }),
    },
    view: { customConfirm: async () => { throw new Error("must not prompt"); } },
  };

  assert.deepEqual(await prepareExplicitLogout(controller), {
    discardConfirmed: false,
    proceed: true,
  });
});

test("forced session termination deactivates but never purges pending workspace", async () => {
  const events = [];
  const controller = {
    disconnectWebSocket: (reconnect) => events.push(["socket", reconnect]),
    model: {
      flushMutationOutbox: async () => events.push(["flush"]),
      deactivateWorkspace: async () => events.push(["deactivate"]),
      purgeWorkspaceData: async () => events.push(["purge"]),
      clearSessionData: () => events.push(["session"]),
    },
  };

  await quarantineForcedSession(controller);

  assert.deepEqual(events, [
    ["socket", false],
    ["flush"],
    ["deactivate"],
    ["session"],
  ]);
});
