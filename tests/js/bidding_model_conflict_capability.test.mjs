import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import {
  CONFLICT_CENTER_CAPABILITY,
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";


afterEach(() => invalidateServerCapabilities());

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}


test("conflict recovery stays local when the server capability is absent", async () => {
  const model = new BiddingModel();
  const replacements = [];
  model.workspaceScope = { key: "user-1:org-a" };
  model._getConflictCenterClient = () => ({
    list() { assert.fail("unsupported sessions must not call conflict-center"); },
  });
  model._getConflictRecoveryStore = () => ({
    replace(items) {
      replacements.push(items);
      return structuredClone(items);
    },
  });
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [],
  });

  assert.deepEqual(await model.refreshConflictRecoveryDrafts(), []);
  assert.deepEqual(replacements, [[]]);
});


test("conflict recovery loads only the active workspace when supported", async () => {
  const model = new BiddingModel();
  const calls = [];
  const responses = [{ items: [{ id: "draft-1" }] }, {}];
  model.workspaceScope = { key: "user-1:org-a" };
  model._getConflictCenterClient = () => ({
    async list(workspaceFingerprint) {
      calls.push(workspaceFingerprint);
      return responses.shift();
    },
  });
  model._getConflictRecoveryStore = () => ({
    replace(items) { return structuredClone(items); },
  });
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });

  assert.deepEqual(
    await model.refreshConflictRecoveryDrafts(),
    [{ id: "draft-1" }],
  );
  assert.deepEqual(await model.refreshConflictRecoveryDrafts(), []);
  assert.deepEqual(calls, ["user-1:org-a", "user-1:org-a"]);
});

test("late conflict responses cannot change the next workspace's draft store", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const model = new BiddingModel();
  const storeChanges = [];
  const pending = { list: deferred(), discard: deferred(), resolve: deferred() };
  model.workspaceScope = { key: "user-1:org-a" };
  model._getConflictCenterClient = () => ({
    list: () => pending.list.promise,
    discard: () => pending.discard.promise,
    resolve: () => pending.resolve.promise,
  });
  model._getConflictRecoveryStore = () => ({
    replace: (items) => { storeChanges.push(["replace", model.workspaceScope.key, items]); return items; },
    remove: (id) => storeChanges.push(["remove", model.workspaceScope.key, id]),
  });

  const listing = model.refreshConflictRecoveryDrafts();
  model.workspaceScope = { key: "user-1:org-b" };
  pending.list.resolve({ items: [{ id: "draft-a" }] });
  assert.deepEqual(await listing, []);

  model.workspaceScope = { key: "user-1:org-a" };
  const discarding = model.discardConflictRecoveryDraft("draft-a");
  model.workspaceScope = { key: "user-1:org-b" };
  pending.discard.resolve({ status: "deleted" });
  await discarding;

  model.workspaceScope = { key: "user-1:org-a" };
  const resolving = model.resolveConflictRecoveryDraft("draft-a", { resolutionAuthority: "authority" }, {});
  model.workspaceScope = { key: "user-1:org-b" };
  pending.resolve.resolve({ status: "resolved" });
  await resolving;
  assert.deepEqual(storeChanges, []);
});


test("conflict recovery does not query without an initialized workspace", async () => {
  const model = new BiddingModel();
  model._getConflictCenterClient = () => ({
    list() { assert.fail("workspace-less models must not call conflict-center"); },
  });

  assert.deepEqual(await model.refreshConflictRecoveryDrafts(), []);
});

test("conflict capture is disabled before the capability is advertised", async () => {
  const model = new BiddingModel();
  model.workspaceScope = { key: "user-1:org-a" };
  model._getConflictCenterClient = () => ({
    capture() { assert.fail("unsupported sessions must not capture a conflict draft"); },
  });

  assert.deepEqual(await model._captureServerConflictDrafts({ queue: {} }, {
    errors: [{ table: "goi_thau", id: "package-1", code: "ROW_VERSION_CONFLICT" }],
  }), []);
});

test("conflict capture ignores unsupported rows and an empty valid request set", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const model = new BiddingModel();
  model.workspaceScope = { key: "user-1:org-a" };
  model._getConflictCenterClient = () => ({
    capture() { assert.fail("invalid conflict rows must not be submitted"); },
  });
  model._getConflictRecoveryStore = () => ({
    remember() { assert.fail("there are no drafts to remember"); },
  });

  assert.deepEqual(await model._captureServerConflictDrafts({
    queue: { clientMutationId: "mutation-1", revision: 1, baseSnapshots: {} },
  }, {
    errors: [
      { table: "unknown_table", id: "record-1", code: "ROW_VERSION_CONFLICT" },
      { table: "goi_thau", id: "", code: "ROW_VERSION_CONFLICT" },
    ],
  }, { id: "receipt-1" }), []);
});

test("conflict capture keeps valid drafts when another conflict lacks a local base", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
  });
  const model = new BiddingModel();
  model.workspaceScope = { key: "user-1:org-a" };
  model.state.goithau = [{ id: "package-1", rowVersion: 4, tenGoiThau: "Local" }];
  const captured = [];
  model._getConflictCenterClient = () => ({
    async capture(request) {
      captured.push(request);
      return { id: "draft-package-1" };
    },
  });
  const checkpoint = {
    queue: {
      clientMutationId: "mutation-1",
      revision: 2,
      baseSnapshots: {
        goithau: {
          "package-1": { id: "package-1", rowVersion: 3, tenGoiThau: "Base" },
        },
      },
    },
  };

  const drafts = await model._captureServerConflictDrafts(checkpoint, {
    errors: [
      {
        table: "goi_thau",
        id: "package-1",
        code: "ROW_VERSION_CONFLICT",
        expectedVersion: 3,
      },
      {
        table: "goi_thau",
        id: "historical-package",
        code: "ROW_VERSION_CONFLICT",
        expectedVersion: 2,
      },
    ],
  }, { id: "receipt-1" });

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].id, "draft-package-1");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].recordId, "package-1");
});
