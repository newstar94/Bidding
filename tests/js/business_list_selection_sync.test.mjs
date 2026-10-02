import assert from "node:assert/strict";
import test from "node:test";

import { applySuccessfulPush } from "../../frontend/app/SyncPushService.js";
import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { captureWorkspace } from "../../frontend/app/SyncWorkspaceContext.js";
import {
  getBusinessListSelection,
  toggleBusinessListRow,
} from "../../frontend/shared/BusinessListSelection.js";

function fixture() {
  const values = new Map([
    ["bf_last_sync_version", "12"], ["bf_last_sync_timestamp", "v12"],
    ["bf_visibility_token", "visibility-1"], ["bf_sync_active_role", "manager"],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const model = {
    token: "user:org-1@1",
    workspaceScope: { key: "user:org-1", organizationId: "org-1" },
    workspaceStorage: storage,
    state: {
      activeuser: { id: "user" }, activerole: "manager",
      goithau: [{ id: "package-1", rowVersion: 1 }], hopdong: [{ id: "contract-1", rowVersion: 1 }],
    },
    getWorkspaceToken() { return this.token; },
    isWorkspaceCurrent(candidate) { return candidate === this.token; },
    normalizeRecordKeys: (record) => structuredClone(record),
    getMutationQueue: () => null,
    suspendMutationTracking: (callback) => callback(),
    buildMutationSyncPayload: () => null,
    clearCommittedMutationBatch() {}, rebaseMutationBatch() {},
    db: { async applySyncChanges() {} },
  };
  const controller = { model, view: null, routeMap: {}, updateSyncState() {}, hasLocalWorkspaceData: () => true };
  toggleBusinessListRow(model, "goithau", { id: "package-1" }, true);
  toggleBusinessListRow(model, "hopdong", { id: "contract-1" }, true);
  return { model, controller };
}

function installGlobals(fetchImpl) {
  const names = ["document", "window", "navigator", "fetch"];
  const saved = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({
    document: { getElementById: () => null, querySelector: () => null },
    window: { location: { pathname: "/goi-thau" } },
    navigator: { onLine: true },
    fetch: fetchImpl || globalThis.fetch,
  })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

test("canonical push deletion acknowledgement clears only its table selection", async () => {
  const restore = installGlobals();
  const { controller, model } = fixture();
  try {
    const result = await applySuccessfulPush(controller, {
      workspace: captureWorkspace(controller), data: { status: "success" },
      payload: { deletions: [{ table: "goithau", id: "package-1" }] },
      snapshot: {}, deferPostCommitRender: true, status: 200,
    });
    assert.equal(result.ok, true);
    assert.equal(getBusinessListSelection(model, "goithau").count, 0);
    assert.equal(getBusinessListSelection(model, "hopdong").count, 1);
  } finally { restore(); }
});

test("canonical pull tombstone clears only its table after persistence completes", async () => {
  const restore = installGlobals(async () => new Response(JSON.stringify({
    deletions: [{ table: "goithau", id: "package-1" }],
    throughVersion: 13, syncVersion: 13, visibilityToken: "visibility-1", partial: false,
  }), { status: 200, headers: { "content-type": "application/json" } }));
  const { controller, model } = fixture();
  let beforePersistence;
  model.db.applySyncChanges = async () => {
    beforePersistence = getBusinessListSelection(model, "goithau").count;
  };
  try {
    const result = await forceSyncData.call(controller, true, false, false);
    assert.equal(result.ok, true);
    assert.equal(beforePersistence, 1);
    assert.equal(getBusinessListSelection(model, "goithau").count, 0);
    assert.equal(getBusinessListSelection(model, "hopdong").count, 1);
  } finally { restore(); }
});

test("an old push deletion acknowledgement cannot clear selections in a newer workspace", async () => {
  const restore = installGlobals();
  const { controller, model } = fixture();
  const workspace = captureWorkspace(controller);
  let finishVersion;
  model.applyCommittedRowVersions = () => new Promise((resolve) => { finishVersion = resolve; });
  try {
    const pending = applySuccessfulPush(controller, {
      workspace, data: { status: "success", rowVersions: [] },
      payload: { deletions: [{ table: "goithau", id: "package-1" }] },
      snapshot: {}, deferPostCommitRender: true, status: 200,
    });
    model.token = "user:org-2@2";
    model.workspaceScope = { key: "user:org-2", organizationId: "org-2" };
    toggleBusinessListRow(model, "goithau", { id: "package-2" }, true);
    finishVersion();
    const result = await pending;
    assert.equal(result.workspaceChanged, true);
    assert.equal(getBusinessListSelection(model, "goithau").count, 1);
    assert.equal(getBusinessListSelection(model, "goithau").selectedVersions[0].id, "package-2");
  } finally { restore(); }
});

test("authoritative full snapshot omission resets selection without treating paginated omissions as deletion", async () => {
  for (const paginated of [false, true]) {
    const restore = installGlobals(async () => new Response(JSON.stringify({
      goithau: [], hopdong: [{ id: "contract-1", rowVersion: 1 }],
      useServerSidePagination: paginated, paginatedKeys: paginated ? ["goithau"] : [],
      syncVersion: 13, timestamp: "v13", visibilityToken: "visibility-1",
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const { controller, model } = fixture();
    try {
      const result = await forceSyncData.call(controller, true, true, false);
      assert.equal(result.ok, true);
      assert.equal(getBusinessListSelection(model, "goithau").count, paginated ? 1 : 0);
      assert.equal(getBusinessListSelection(model, "hopdong").count, 1);
    } finally { restore(); }
  }
});
