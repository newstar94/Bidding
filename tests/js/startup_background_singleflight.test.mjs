import assert from "node:assert/strict";
import test from "node:test";

import { scheduleBackgroundSync } from "../../frontend/app/WorkspaceEventBridge.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function nextTimerTurn() {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

test("scheduled background sync waits for initial reconciliation single-flight", async () => {
  const startup = deferred();
  const calls = [];
  const controller = {
    _startupReconciliationPromise: startup.promise,
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  scheduleBackgroundSync.call(controller, 0);
  await nextTimerTurn();
  assert.deepEqual(calls, []);

  startup.resolve(true);
  await nextTimerTurn();
  assert.deepEqual(calls, ["pull"]);
});

test("a startup completion from the old workspace cannot start a background pull", async () => {
  const startup = deferred();
  const calls = [];
  let token = "user:org-a@1";
  const controller = {
    _startupReconciliationPromise: startup.promise,
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
    },
    async forceSyncData() {
      calls.push("pull");
      return { ok: true };
    },
  };

  scheduleBackgroundSync.call(controller, 0);
  await nextTimerTurn();
  token = "user:org-b@2";
  controller.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  startup.resolve(true);
  await nextTimerTurn();

  assert.deepEqual(calls, []);
});

test("workspace_b_background_schedule_does_not_reuse_workspace_a_timer", async () => {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  let nextTimerId = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback) => {
    const id = ++nextTimerId;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  let token = "user:org-a@1";
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
    },
    async forceSyncData() {
      calls.push(token);
      return { ok: true };
    },
  };

  try {
    scheduleBackgroundSync.call(controller, 10);
    token = "user:org-b@2";
    controller.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    scheduleBackgroundSync.call(controller, 10);
    for (const callback of [...timers.values()]) await callback();

    assert.deepEqual(calls, ["user:org-b@2"]);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test("workspace_b_background_run_waits_for_workspace_a_owner_cleanup", async () => {
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const pullA = deferred();
  let nextTimerId = 0;
  const timers = new Map();
  globalThis.setTimeout = (callback) => {
    const id = ++nextTimerId;
    timers.set(id, callback);
    return id;
  };
  globalThis.clearTimeout = (id) => timers.delete(id);
  let token = "user:org-a@1";
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => token,
      isWorkspaceCurrent: (candidate) => candidate === token,
    },
    async forceSyncData() {
      calls.push(token);
      if (token === "user:org-a@1") await pullA.promise;
      return { ok: true };
    },
  };
  controller.scheduleBackgroundSync = (...args) => scheduleBackgroundSync.call(controller, ...args);
  const runTimer = (id) => {
    const callback = timers.get(id);
    timers.delete(id);
    return callback();
  };

  try {
    scheduleBackgroundSync.call(controller, 10);
    const runA = runTimer(1);
    await Promise.resolve();
    token = "user:org-b@2";
    controller.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    scheduleBackgroundSync.call(controller, 10);
    await runTimer(2);
    assert.deepEqual(calls, ["user:org-a@1"]);

    pullA.resolve();
    await runA;
    await runTimer(3);
    assert.deepEqual(calls, ["user:org-a@1", "user:org-b@2"]);
    assert.equal(controller._backgroundSyncRunning, false);
  } finally {
    pullA.resolve();
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});
