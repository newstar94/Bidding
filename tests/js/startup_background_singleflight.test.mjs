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
