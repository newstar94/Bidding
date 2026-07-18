import assert from "node:assert/strict";
import test from "node:test";

import {
  ScopedWorkspaceStorage,
  createWorkspaceScope,
  getActiveOrganizationId,
  isWorkspaceStorageEvent,
  purgeWorkspaceLocalData,
  retryPendingWorkspacePurges,
  setActiveOrganizationId,
  workspaceDatabaseName
} from "../../frontend/app/workspaceState.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    values
  };
}

test("workspace purge removes every local workspace of the selected user", async () => {
  const scopeA = createWorkspaceScope("user-1", "org-a");
  const scopeB = createWorkspaceScope("user-1", "org-b");
  const storage = memoryStorage();
  new ScopedWorkspaceStorage(scopeA, storage).setItem("pending", "private-a");
  new ScopedWorkspaceStorage(scopeB, storage).setItem("pending", "private-b");
  let deletedDatabase = "";
  const indexedDB = {
    deleteDatabase(name) {
      deletedDatabase = name;
      const request = {};
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  };

  await purgeWorkspaceLocalData(scopeA, {
    indexedDB,
    localStorage: storage,
    sessionStorage: memoryStorage()
  });

  assert.equal(new ScopedWorkspaceStorage(scopeA, storage).getItem("pending"), null);
  assert.equal(new ScopedWorkspaceStorage(scopeB, storage).getItem("pending"), null);
  assert.equal(deletedDatabase, workspaceDatabaseName(scopeA));
});

test("startup retries an IndexedDB purge left blocked during logout", async () => {
  const scope = createWorkspaceScope("user-retry", "org-a");
  const storage = memoryStorage({
    "bf_workspace_purge_pending:user-retry": JSON.stringify({
      userId: scope.userId,
      organizationId: scope.organizationId
    })
  });
  let deleted = 0;
  const indexedDB = {
    async databases() {
      return [{ name: workspaceDatabaseName(scope) }];
    },
    deleteDatabase() {
      deleted += 1;
      const request = {};
      queueMicrotask(() => request.onsuccess());
      return request;
    }
  };

  assert.equal(await retryPendingWorkspacePurges({ indexedDB, localStorage: storage, sessionStorage: memoryStorage() }), 1);
  assert.equal(deleted, 1);
  assert.equal(storage.getItem("bf_workspace_purge_pending:user-retry"), null);
});

test("A → B → A preserves independent mutation queues, tombstones and cursors", () => {
  const local = memoryStorage();
  const scopeA = createWorkspaceScope("user-1", "org-a");
  const scopeB = createWorkspaceScope("user-1", "org-b");
  const storeA = new ScopedWorkspaceStorage(scopeA, local);
  const storeB = new ScopedWorkspaceStorage(scopeB, local);

  storeA.writeJson("bf_mutation_queue", { upserts: { goithau: { a: { id: "a" } } } });
  storeA.writeJson("bf_local_deletions", [{ table: "goithau", id: "old-a" }]);
  storeA.setItem("bf_last_sync_version", "7");
  storeB.writeJson("bf_mutation_queue", { upserts: { goithau: { b: { id: "b" } } } });
  storeB.setItem("bf_last_sync_version", "19");

  assert.deepEqual(storeA.readJson("bf_mutation_queue", null).upserts.goithau.a, { id: "a" });
  assert.deepEqual(storeA.readJson("bf_local_deletions", []), [{ table: "goithau", id: "old-a" }]);
  assert.equal(storeA.getItem("bf_last_sync_version"), "7");
  assert.equal(storeB.readJson("bf_local_deletions", []).length, 0);
  assert.deepEqual(storeB.readJson("bf_mutation_queue", null).upserts.goithau.b, { id: "b" });
  assert.equal(storeB.getItem("bf_last_sync_version"), "19");
  assert.notEqual(workspaceDatabaseName(scopeA), workspaceDatabaseName(scopeB));
});

test("two tabs can keep different active organizations without sharing request context", () => {
  const local = memoryStorage();
  const tabA = memoryStorage();
  const tabB = memoryStorage();

  setActiveOrganizationId("org-a", { localStorage: local, sessionStorage: tabA });
  setActiveOrganizationId("org-b", { localStorage: local, sessionStorage: tabB });

  assert.equal(getActiveOrganizationId({ localStorage: local, sessionStorage: tabA }), "org-a");
  assert.equal(getActiveOrganizationId({ localStorage: local, sessionStorage: tabB }), "org-b");
  assert.equal(local.getItem("bf_active_org"), "org-b");
});

test("cross-tab storage notifications are filtered by workspace scope", () => {
  const scopeA = createWorkspaceScope("user-1", "org-a");
  const scopeB = createWorkspaceScope("user-1", "org-b");
  const storeB = new ScopedWorkspaceStorage(scopeB, memoryStorage());
  const event = { key: storeB.key("bf_mutation_queue") };

  assert.equal(isWorkspaceStorageEvent(event, scopeA), false);
  assert.equal(isWorkspaceStorageEvent(event, scopeB), true);
});

test("starting a workspace transition invalidates delayed responses", () => {
  const model = new BiddingModel();
  model.workspaceScope = createWorkspaceScope("user-1", "org-a");
  const requestToken = model.getWorkspaceToken();

  model.beginWorkspaceTransition();

  assert.equal(model.isWorkspaceCurrent(requestToken), false);
  assert.throws(() => model.commitLocalMutation("goithau", { records: { id: "late" } }), /temporarily locked/);
});

test("the removed viewer mode cannot downgrade an administrator or manager", () => {
  assert.equal(BiddingModel.resolveAllowedActiveRole({ dbRoles: ["super_admin"] }, "viewer"), "super_admin");
  assert.equal(BiddingModel.resolveAllowedActiveRole({ dbRoles: ["manager"] }, "viewer"), "manager");
  assert.equal(BiddingModel.resolveAllowedActiveRole({ dbRoles: ["employee"] }, "viewer"), "employee");
});

test("committed row versions clear the sent mutation without creating a retry loop", async () => {
  const model = new BiddingModel();
  model.workspaceStorage = new ScopedWorkspaceStorage(
    createWorkspaceScope("user-1", "org-a"),
    memoryStorage()
  );
  model.db = { stores: [], putRecord: async () => {} };
  model.state = { goithau: [{ id: "bid-1", rowVersion: 1, tenGoiThau: "Bid" }] };
  const snapshot = {
    baseSyncVersion: "1",
    clientMutationId: "mutation-1",
    dirtyTables: {},
    upserts: { goithau: { "bid-1": { id: "bid-1", rowVersion: 1, tenGoiThau: "Bid" } } },
    deletes: [],
    revision: 1
  };
  model.workspaceStorage.writeJson("bf_mutation_queue", snapshot);

  model.clearSyncedMutationQueue(snapshot);
  await model.applyCommittedRowVersions([
    { table: "goithau", id: "bid-1", rowVersion: 2 }
  ]);

  assert.equal(model.state.goithau[0].rowVersion, 2);
  assert.equal(model.workspaceStorage.getItem("bf_mutation_queue"), null);
});

test("rule-violating upserts and deletions are removed from every retry store", () => {
  const model = new BiddingModel();
  model.workspaceStorage = new ScopedWorkspaceStorage(
    createWorkspaceScope("user-validation", "org-a"),
    memoryStorage()
  );
  model.workspaceStorage.writeJson("bf_mutation_queue", {
    baseSyncVersion: "4",
    clientMutationId: "validation-batch",
    revision: 1,
    dirtyTables: {},
    upserts: { goithau: { "gt-invalid": { id: "gt-invalid" } } },
    deletes: [{ table: "nhathau", id: "nt-invalid", expectedVersion: 2 }]
  });
  model.workspaceStorage.writeJson("bf_local_deletions", [
    { table: "nhathau", id: "nt-invalid", expectedVersion: 2 }
  ]);

  const rejected = model.discardRejectedMutations([
    { table: "goithau", id: "gt-invalid", code: "INVALID_FIELD" },
    { table: "nha_thau", id: "nt-invalid", code: "DELETE_NOT_ALLOWED" }
  ]);

  assert.deepEqual(rejected.map(item => item.operation).sort(), ["delete", "upsert"]);
  assert.equal(model.workspaceStorage.getItem("bf_mutation_queue"), null);
  assert.equal(model.workspaceStorage.getItem("bf_local_deletions"), null);
  assert.equal(model.getPendingMutationSummary().pendingCount, 0);
});

test("a user can remove one pending record without discarding valid siblings", () => {
  const model = new BiddingModel();
  model.workspaceStorage = new ScopedWorkspaceStorage(
    createWorkspaceScope("user-pending", "org-a"),
    memoryStorage()
  );
  model.workspaceStorage.writeJson("bf_mutation_queue", {
    baseSyncVersion: "7",
    clientMutationId: "pending-batch",
    revision: 1,
    dirtyTables: {},
    upserts: {
      chuyengia: {
        "cg-remove": { id: "cg-remove", hoTen: "Bỏ khỏi hàng chờ" },
        "cg-keep": { id: "cg-keep", hoTen: "Tiếp tục đồng bộ" }
      }
    },
    deletes: []
  });

  assert.deepEqual(model.removePendingMutation("chuyengia", "cg-remove", "upsert"), {
    type: "chuyengia",
    id: "cg-remove",
    operation: "upsert"
  });
  const queue = model.getMutationQueue();
  assert.equal(queue.upserts.chuyengia["cg-remove"], undefined);
  assert.equal(queue.upserts.chuyengia["cg-keep"].hoTen, "Tiếp tục đồng bộ");
  assert.equal(model.getPendingMutationSummary().pendingCount, 1);
});
