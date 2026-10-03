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
      getMutationQueue: () => ({ dirtyTables: {}, upserts: {}, deletes: [] }),
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

for (const syncResult of [
  { ok: true },
  { ok: false, transport: true },
  { ok: true, localMutationsPending: true },
  { ok: true, requiredActiveRole: "manager" },
]) {
  test(`logout preserves pending partial patches until discard is confirmed: ${JSON.stringify(syncResult)}`, async () => {
    let prompted = false;
    let discarded = false;
    const controller = {
      autoSync: async () => syncResult,
      model: {
        getMutationQueue: () => ({
          patches: { goithau: { "package-1": { id: "package-1", danhGiaHsdtMetadata: "entered" } } },
        }),
        discardMutationBatch: () => { discarded = true; },
      },
      view: { customConfirm: async (_title, message) => {
        prompted = true;
        assert.match(message, /1 thay đổi/);
        return false;
      } },
    };

    const decision = await prepareExplicitLogout(controller);

    assert.equal(prompted, true);
    assert.equal(decision.proceed, false);
    assert.equal(decision.pendingCount, 1);
    assert.equal(discarded, false);
  });
}

test("throwing final sync records discard consent without changing data before server logout", async () => {
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
  assert.equal(discarded, false);
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

test("forced session cleanup cannot deactivate a new login after an old outbox flush", async () => {
  let releaseFlush;
  const flush = new Promise((resolve) => { releaseFlush = resolve; });
  const events = [];
  let token = "user-a:org-a@1";
  const model = {
    state: { activeuser: { id: "user-a" } },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    flushMutationOutbox: () => flush,
    deactivateWorkspace: async () => events.push("deactivate"),
    clearSessionData: () => events.push("clear"),
  };
  const pending = quarantineForcedSession({ model });
  token = "user-b:org-b@2";
  model.state.activeuser = { id: "user-b" };
  releaseFlush();
  await pending;
  assert.deepEqual(events, []);
});

test("forced session cleanup cannot clear a new login while old deactivation settles", async () => {
  let releaseDeactivation;
  const deactivate = new Promise((resolve) => { releaseDeactivation = resolve; });
  const events = [];
  const model = {
    state: { activeuser: { id: "user-a" } },
    flushMutationOutbox: async () => {},
    deactivateWorkspace: () => deactivate,
    clearSessionData: () => events.push("clear"),
  };
  const pending = quarantineForcedSession({ model });
  await new Promise((resolve) => setImmediate(resolve));
  model.state.activeuser = { id: "user-b" };
  releaseDeactivation();
  await pending;
  assert.deepEqual(events, []);
});
