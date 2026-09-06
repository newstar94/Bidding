import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFailedPush,
  applySuccessfulPush,
} from "../../frontend/app/SyncPushService.js";
import { captureWorkspace } from "../../frontend/app/SyncWorkspaceContext.js";
import { paginatedProjectionStore } from "../../frontend/shared/PaginatedProjectionStore.js";

test("successful partner create invalidates pre-commit page before canonical rendering", async () => {
  const race = raceController();
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const store = paginatedProjectionStore(race.model);
    store.setValue("chudautu", {}, { items: [], totalItems: 0 });
    assert.equal(store.cache.size, 1);
    await applySuccessfulPush(race.controller, {
      workspace: captureWorkspace(race.controller), data: { status: "success" },
      payload: { chudautu: [{ id: "new" }] }, snapshot: {}, deferPostCommitRender: true,
    });
    assert.equal(store.cache.size, 0, "ACK must retire the page fetched before the insert");
  } finally { globalThis.document = previousDocument; }
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function raceController() {
  let token = "user:org-a@1";
  const storageA = memoryStorage();
  const storageB = memoryStorage();
  const updates = [];
  const toasts = [];
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    workspaceStorage: storageA,
    state: { activetab: "goithau", goithau: [] },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
  };
  const controller = {
    model,
    view: { showToast: (...args) => toasts.push(args) },
    updateSyncState: (patch) => updates.push(patch),
  };
  return {
    controller,
    model,
    storageA,
    storageB,
    updates,
    toasts,
    switchToB() {
      token = "user:org-b@2";
      model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
      model.workspaceStorage = storageB;
      model.state = { activetab: "goithau", goithau: [{ id: "package-b" }] };
    },
    switchToSameOrgNewEpoch() {
      token = "user:org-a@2";
      model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
      model.workspaceStorage = storageB;
      model.state = { activetab: "goithau", goithau: [{ id: "package-new-epoch" }] };
    },
  };
}

test("workspace_change_during_successful_push_row_version_commit_cannot_mutate_new_workspace", async () => {
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const rowVersions = deferred();
  race.model.clearCommittedMutationBatch = () => {};
  race.model.applyCommittedRowVersions = () => rowVersions.promise;

  const pending = applySuccessfulPush(race.controller, {
    workspace,
    data: { status: "success", rowVersions: [{ table: "goithau", id: "package-a", rowVersion: 2 }] },
    payload: { goithau: [{ id: "package-a" }] },
    snapshot: { id: "receipt-a" },
    deferPostCommitRender: false,
    status: 200,
  });
  await new Promise((resolve) => setImmediate(resolve));
  race.switchToB();
  race.updates.length = 0;
  rowVersions.resolve();

  const result = await pending;
  assert.equal(result.workspaceChanged, true);
  assert.deepEqual(race.updates, []);
  assert.deepEqual(race.model.state.goithau, [{ id: "package-b" }]);
});

test("workspace_change_during_successful_push_render_cannot_mark_new_workspace_server_saved", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: (id) => id === "tab-goithau" ? {} : null };
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const render = deferred();
  race.model.clearCommittedMutationBatch = () => {};
  race.controller.view.renderGoiThauTable = () => render.promise;

  try {
    const pending = applySuccessfulPush(race.controller, {
      workspace,
      data: { status: "success" },
      payload: { deletions: [{ table: "goithau", id: "package-a" }] },
      snapshot: { id: "receipt-a" },
      deferPostCommitRender: false,
      status: 200,
    });
    await new Promise((resolve) => setImmediate(resolve));
    race.switchToB();
    race.updates.length = 0;
    race.toasts.length = 0;
    render.resolve();

    const result = await pending;
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(race.updates, []);
    assert.deepEqual(race.toasts, []);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("workspace_change_during_conflict_resolution_cannot_set_conflict_on_new_workspace", async () => {
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const pending = applyFailedPush(race.controller, {
    workspace,
    status: 409,
    data: {
      status: "conflict",
      currentSyncVersion: 8,
      errors: [{ code: "ROW_VERSION_CONFLICT", id: "package-a", serverRecord: {} }],
    },
    snapshot: { id: "receipt-a" },
  });
  race.switchToB();
  race.updates.length = 0;
  race.toasts.length = 0;

  const result = await pending;
  assert.equal(result.workspaceChanged, true);
  assert.equal(race.controller._syncConflict, undefined);
  assert.deepEqual(race.updates, []);
  assert.deepEqual(race.toasts, []);
  assert.equal(race.storageB.values.has("bf_conflict_server_sync_version"), false);
});

test("workspace_change_during_validation_recovery_cannot_restore_or_delete_new_workspace_records", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const flush = deferred();
  const calls = [];
  race.model.discardRejectedMutations = () => [{
    type: "goithau",
    id: "package-a",
    conflictingId: "package-a",
  }];
  race.model.flushMutationOutbox = () => flush.promise;
  race.model.db = { deleteRecord: (...args) => calls.push(["delete", ...args]) };
  race.controller.fetchRecordByLookup = (...args) => {
    calls.push(["fetch", ...args]);
    return null;
  };

  try {
    const pending = applyFailedPush(race.controller, {
      workspace,
      status: 400,
      data: { errors: [{ code: "INVALID", message: "Rejected" }] },
      snapshot: { id: "receipt-a" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    race.switchToB();
    race.updates.length = 0;
    race.toasts.length = 0;
    flush.resolve();

    const result = await pending;
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(calls, []);
    assert.deepEqual(race.model.state.goithau, [{ id: "package-b" }]);
    assert.deepEqual(race.updates, []);
    assert.deepEqual(race.toasts, []);
  } finally {
    console.error = originalConsoleError;
  }
});

test("late_success_response_from_workspace_a_cannot_clear_workspace_b_outbox", async () => {
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const clears = [];
  race.switchToB();
  race.model.clearCommittedMutationBatch = (snapshot) => clears.push(snapshot);

  const result = await applySuccessfulPush(race.controller, {
    workspace,
    data: { status: "success" },
    payload: { goithau: [{ id: "package-a" }] },
    snapshot: { id: "receipt-a" },
    deferPostCommitRender: false,
    status: 200,
  });

  assert.equal(result.workspaceChanged, true);
  assert.deepEqual(clears, []);
  assert.deepEqual(race.updates, []);
});

test("same_org_new_epoch_rejects_late_push_completion", async () => {
  const race = raceController();
  const workspace = captureWorkspace(race.controller);
  const clears = [];
  race.switchToSameOrgNewEpoch();
  race.model.clearCommittedMutationBatch = (snapshot) => clears.push(snapshot);

  const result = await applySuccessfulPush(race.controller, {
    workspace,
    data: { status: "success", syncVersion: 7 },
    payload: { goithau: [{ id: "package-old-epoch" }] },
    snapshot: { id: "receipt-old-epoch" },
    deferPostCommitRender: false,
    status: 200,
  });

  assert.equal(result.workspaceChanged, true);
  assert.equal(result.code, "WORKSPACE_CHANGED");
  assert.deepEqual(clears, []);
  assert.deepEqual(race.model.state.goithau, [{ id: "package-new-epoch" }]);
  assert.equal(race.storageB.getItem("bf_last_sync_version"), null);
});
