import assert from "node:assert/strict";
import test from "node:test";

import {
  awaitCanonicalSyncResult,
  CANONICAL_SAVE_STATUS,
  classifyCanonicalSyncResult,
  applyStateMutations,
  mutatePersistAndSync,
  persistAndSync,
  stageLocalRecords,
} from "../../frontend/shared/MutationService.js";

test("canonical save states distinguish commit, rejection, conflict, and offline pending", async () => {
  assert.equal(
    classifyCanonicalSyncResult({ ok: true }),
    CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED,
  );
  assert.equal(
    classifyCanonicalSyncResult({ ok: false, status: 400, data: {} }),
    CANONICAL_SAVE_STATUS.CANONICAL_REJECTED,
  );
  assert.equal(
    classifyCanonicalSyncResult({ ok: false, status: 409, conflict: true }),
    CANONICAL_SAVE_STATUS.CONFLICT,
  );
  assert.equal(
    classifyCanonicalSyncResult({ ok: false, error: new TypeError("offline"), transport: true }),
    CANONICAL_SAVE_STATUS.OFFLINE_PENDING,
  );
  assert.equal(
    classifyCanonicalSyncResult({ ok: false, error: new Error("storage"), storageDegraded: true }),
    CANONICAL_SAVE_STATUS.CANONICAL_REJECTED,
  );
  assert.equal(
    classifyCanonicalSyncResult({ ok: true, skipped: true, localMutationsPending: true }),
    CANONICAL_SAVE_STATUS.REMOTE_PENDING,
  );

  const canonical = await awaitCanonicalSyncResult({
    syncPromise: Promise.resolve({ ok: true, canonicalStatus: CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED }),
  });
  assert.equal(canonical.canonicalStatus, CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED);
});

function persistenceController() {
  const calls = [];
  const controller = {
    model: {
      state: {},
      async flushMutationOutbox() {},
      async persistChanges(table, changes) {
        calls.push({ kind: "changes", table, changes });
      },
      async persistData(table) {
        calls.push({ kind: "legacy", table });
      },
    },
    async autoSync() { return { ok: true }; },
  };
  return { calls, controller };
}

test("synced tables reject implicit full-table persistence", async () => {
  const { calls, controller } = persistenceController();

  await assert.rejects(
    persistAndSync(controller, "goithau"),
    (error) => error?.code === "EXPLICIT_CHANGES_REQUIRED"
      && /goithau/.test(error.message),
  );

  assert.deepEqual(calls, []);
});

test("synced tables use explicit record-level changes", async () => {
  const { calls, controller } = persistenceController();

  await persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [{ id: "pkg-1" }] } },
  });

  assert.deepEqual(calls, [{
    kind: "changes",
    table: "goithau",
    changes: { deletions: [], upserts: [{ id: "pkg-1" }] },
  }]);
});

test("persist retries a renewed idempotency mutation after authoritative rebase", async () => {
  const calls = [];
  let pushCount = 0;
  const controller = {
    model: {
      state: {},
      async flushMutationOutbox() { calls.push("flush"); },
      async persistChanges() { calls.push("persist"); },
    },
    async autoSync() {
      calls.push("push");
      pushCount += 1;
      return pushCount === 1
        ? { ok: false, status: 409, idempotencyKeyReused: true }
        : { ok: true, recovered: true };
    },
    async forceSyncData(isBackground, forceFull) {
      calls.push(["pull", isBackground, forceFull]);
      return { ok: true, localMutationsPending: true };
    },
  };

  const result = await persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [{ id: "pkg-1" }] } },
  });

  assert.deepEqual(result, { ok: true, recovered: true });
  assert.deepEqual(calls, [
    "persist",
    "flush",
    "push",
    ["pull", false, true],
    "push",
  ]);
});

test("startup_does_not_commit_a_stale_package_before_authoritative_reconciliation", async () => {
  const calls = [];
  let releaseBoundary;
  const boundary = new Promise((resolve) => {
    releaseBoundary = resolve;
  });
  const controller = {
    model: {
      state: {},
      async flushMutationOutbox() {
        calls.push("flush");
      },
      async persistChanges() {
        calls.push("persist");
      },
    },
    async awaitAuthoritativeMutationBoundary() {
      calls.push("boundary:start");
      await boundary;
      calls.push("boundary:end");
    },
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
  };

  const mutation = persistAndSync(controller, "goithau", {
    changes: { upserts: { goithau: [{ id: "pkg-1", rowVersion: 1 }] } },
  });
  await Promise.resolve();

  assert.deepEqual(calls, ["boundary:start"]);
  releaseBoundary();
  await mutation;
  assert.deepEqual(calls, ["boundary:start", "boundary:end", "persist", "flush", "push"]);
});

test("state mutation waits for startup reconciliation before staging the outbox", async () => {
  const calls = [];
  let releaseBoundary;
  const boundary = new Promise((resolve) => {
    releaseBoundary = resolve;
  });
  const model = {
    state: { goithau: [{ id: "pkg-1", rowVersion: 1, name: "stale" }] },
    normalizeRecordKeys: (record) => ({ ...record }),
    commitLocalMutation() { calls.push("stage"); },
    async persistChanges() { calls.push("persist"); },
    async flushMutationOutbox() { calls.push("flush"); },
  };
  const controller = {
    model,
    async awaitAuthoritativeMutationBoundary() {
      calls.push("boundary:start");
      await boundary;
      calls.push("boundary:end");
    },
    async autoSync() {
      calls.push("push");
      return { ok: true };
    },
  };

  const commit = mutatePersistAndSync(controller, {
    upserts: { goithau: { id: "pkg-1", rowVersion: 1, name: "edited" } },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["boundary:start"]);
  assert.equal(model.state.goithau[0].name, "stale");

  releaseBoundary();
  await commit;
  assert.deepEqual(calls, [
    "boundary:start",
    "boundary:end",
    "stage",
    "persist",
    "flush",
    "push",
  ]);
  assert.equal(model.state.goithau[0].name, "edited");
});

test("local-only tables keep compatibility persistence without an opt-in", async () => {
  const { calls, controller } = persistenceController();

  await persistAndSync(controller, "employees");

  assert.deepEqual(calls, [{ kind: "legacy", table: "employees" }]);
});

test("an explicit compatibility opt-in permits a synced projection write", async () => {
  const { calls, controller } = persistenceController();

  await persistAndSync(controller, "permissionmatrix", {
    allowLegacyPersistence: true,
  });

  assert.deepEqual(calls, [{ kind: "legacy", table: "permissionmatrix" }]);
});

test("stages explicit upserts before mutatePersistAndSync persists them", () => {
  const calls = [];
  const model = {
    state: { goithau: [{ id: "pkg-1", trangThai: "Chuẩn bị" }] },
    normalizeRecordKeys: (record) => ({ ...record }),
    commitLocalMutation(table, options) {
      calls.push({ table, records: options.records });
    },
  };

  const changed = applyStateMutations(model, {
    upserts: { goithau: { id: "pkg-1", trangThai: "Hủy thầu" } },
  });

  assert.deepEqual(changed, ["goithau"]);
  assert.equal(model.state.goithau[0].trangThai, "Hủy thầu");
  assert.deepEqual(calls, [{
    table: "goithau",
    records: [{ id: "pkg-1", trangThai: "Hủy thầu" }],
  }]);
});

test("stages only valid records and preserves deleted row versions", () => {
  const staged = [];
  const deleted = [];
  const packageRecord = { id: "pkg-1", rowVersion: 7 };
  const model = {
    state: { goithau: [packageRecord] },
    commitLocalMutation(table, options) { staged.push([table, options.records]); },
    markDeleted(table, records) { deleted.push([table, records]); },
  };

  assert.deepEqual(stageLocalRecords(model, "goithau", [null, {}, packageRecord]), [packageRecord]);
  applyStateMutations(model, { deletions: { goithau: "pkg-1" } });

  assert.deepEqual(staged, [["goithau", [packageRecord]]]);
  assert.deepEqual(deleted, [["goithau", [{ id: "pkg-1", rowVersion: 7 }]]]);
});

test("explicit mutations use record-level persistence without a full-table fallback", async () => {
  const persisted = [];
  const model = {
    state: {
      goithau: [
        { id: "pkg-1", trangThai: "Chuẩn bị" },
        { id: "pkg-delete", rowVersion: 3 },
      ],
    },
    normalizeRecordKeys: (record) => ({ ...record }),
    commitLocalMutation() {},
    markDeleted() {},
    async persistChanges(table, changes) {
      persisted.push({ table, changes });
    },
    async persistData() {
      throw new Error("full-table persistence must not run");
    },
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    async autoSync() {
      return { ok: true };
    },
  };

  const outcome = await mutatePersistAndSync(controller, {
    upserts: { goithau: { id: "pkg-1", trangThai: "Đang mời thầu" } },
    deletions: { goithau: "pkg-delete" },
  });

  assert.deepEqual(outcome, { ok: true });
  assert.deepEqual(persisted, [{
    table: "goithau",
    changes: {
      upserts: [{ id: "pkg-1", trangThai: "Đang mời thầu" }],
      deletions: ["pkg-delete"],
    },
  }]);
});

test("interactive persistence responds after durability without awaiting remote synchronization", async () => {
  const calls = [];
  let releaseSync;
  const remoteSync = new Promise((resolve) => { releaseSync = resolve; });
  const lease = {
    outbox: {
      async flush() { calls.push("flush"); },
    },
  };
  const model = {
    state: { goithau: [{ id: "pkg-fast" }] },
    beginWorkspaceMutation() { calls.push("begin"); return lease; },
    assertWorkspaceMutation() {},
    finishWorkspaceMutation() { calls.push("finish"); },
    workspaceMutationUsesCurrentResources() { return true; },
    async persistChanges() { calls.push("persist"); },
  };
  const controller = {
    model,
    autoSync() {
      calls.push("sync-start");
      return remoteSync;
    },
  };

  let committed = false;
  const committing = persistAndSync(controller, "goithau", {
    backgroundSync: true,
    changes: { upserts: { goithau: [{ id: "pkg-fast" }] } },
  }).then((result) => {
    committed = true;
    return result;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(committed, true);
  assert.deepEqual(calls, ["begin", "persist", "flush", "sync-start", "finish"]);
  const result = await committing;
  assert.equal(result.local, true);
  assert.equal(result.queued, true);
  assert.equal(result.localStatus, CANONICAL_SAVE_STATUS.LOCAL_DURABLE);
  assert.equal(result.canonicalStatus, CANONICAL_SAVE_STATUS.REMOTE_PENDING);
  releaseSync({ ok: true });
  assert.equal(
    (await result.syncPromise).canonicalStatus,
    CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED,
  );
});

test("local durable result does not wait for a delayed paginated renderer", async () => {
  let releaseRender;
  const delayedRender = new Promise((resolve) => { releaseRender = resolve; });
  const calls = [];
  const lease = { outbox: { async flush() { calls.push("flush"); } } };
  const model = {
    state: { kehoach: [{ id: "plan-fast" }] },
    useServerSidePagination: true,
    beginWorkspaceMutation() { return lease; },
    assertWorkspaceMutation() {},
    finishWorkspaceMutation() { calls.push("finish"); },
    workspaceMutationUsesCurrentResources() { return true; },
    async persistChanges() { calls.push("persist"); },
  };
  const controller = {
    model,
    autoSync() { calls.push("sync-start"); return Promise.resolve({ ok: true }); },
  };

  let settled = false;
  const resultPromise = persistAndSync(controller, "kehoach", {
    backgroundSync: true,
    changes: { upserts: { kehoach: [{ id: "plan-fast" }] } },
    afterPersist: async () => {
      calls.push("local-feedback");
      await delayedRender;
      calls.push("render-complete");
    },
  }).then((result) => {
    settled = true;
    return result;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settled, true, "the caller must settle after IndexedDB/outbox durability");
  assert.ok(calls.includes("local-feedback"));
  assert.ok(!calls.includes("render-complete"));
  const result = await resultPromise;
  releaseRender();
  await result.syncPromise;
});

test("background mutation separates local modal feedback from canonical table rendering", async () => {
  let releaseSync;
  const remoteSync = new Promise((resolve) => { releaseSync = resolve; });
  const calls = [];
  const lease = { outbox: { async flush() { calls.push("flush"); } } };
  const model = {
    state: { hopdong: [{ id: "contract-fast" }] },
    useServerSidePagination: true,
    beginWorkspaceMutation() { return lease; },
    assertWorkspaceMutation() {},
    finishWorkspaceMutation() { calls.push("finish"); },
    workspaceMutationUsesCurrentResources() { return true; },
    async persistChanges() { calls.push("persist"); },
  };
  const controller = {
    model,
    autoSync() { calls.push("sync-start"); return remoteSync; },
  };

  const result = await persistAndSync(controller, "hopdong", {
    backgroundSync: true,
    changes: { upserts: { hopdong: [{ id: "contract-fast" }] } },
    afterLocalDurable: () => { calls.push("modal-closed"); },
    afterCanonicalSync: () => { calls.push("table-rendered"); },
  });

  assert.equal(result.local, true);
  assert.ok(calls.includes("modal-closed"));
  assert.ok(!calls.includes("table-rendered"));
  releaseSync({ ok: true });
  await result.syncPromise;
  assert.ok(calls.indexOf("modal-closed") < calls.indexOf("table-rendered"));
});

test("background synchronization waits for the local durable phase to finish", async () => {
  let finishLocalPhase;
  const localPhase = new Promise((resolve) => { finishLocalPhase = resolve; });
  const calls = [];
  const controller = {
    model: {
      state: { hopdong: [{ id: "contract-local-phase" }] },
      async flushMutationOutbox() { calls.push("flush"); },
      async persistChanges() { calls.push("persist"); },
    },
    async autoSync() {
      calls.push("sync-start");
      return { ok: true };
    },
  };

  const result = await persistAndSync(controller, "hopdong", {
    backgroundSync: true,
    changes: { upserts: { hopdong: [{ id: "contract-local-phase" }] } },
    afterLocalDurable: async () => {
      calls.push("local-start");
      await localPhase;
      calls.push("modal-closed");
    },
  });

  assert.equal(result.localStatus, CANONICAL_SAVE_STATUS.LOCAL_DURABLE);
  assert.deepEqual(calls, ["persist", "flush", "local-start"]);
  finishLocalPhase();
  assert.equal(
    (await result.syncPromise).canonicalStatus,
    CANONICAL_SAVE_STATUS.CANONICAL_COMMITTED,
  );
  assert.deepEqual(calls, [
    "persist",
    "flush",
    "local-start",
    "modal-closed",
    "sync-start",
  ]);
});

test("a workspace switch during the local durable phase cannot redirect remote synchronization", async () => {
  let finishLocalPhase;
  const localPhase = new Promise((resolve) => { finishLocalPhase = resolve; });
  const calls = [];
  let currentWorkspace = "workspace-a";
  const controller = {
    model: {
      state: { hopdong: [{ id: "contract-workspace-a" }] },
      getWorkspaceToken: () => "workspace-a",
      isWorkspaceCurrent: (token) => token === currentWorkspace,
      async flushMutationOutbox() {},
      async persistChanges() {},
    },
    async autoSync() {
      calls.push("sync-start");
      return { ok: true };
    },
  };

  const result = await persistAndSync(controller, "hopdong", {
    backgroundSync: true,
    changes: { upserts: { hopdong: [{ id: "contract-workspace-a" }] } },
    afterLocalDurable: () => localPhase,
  });

  currentWorkspace = "workspace-b";
  finishLocalPhase();
  const canonical = await result.syncPromise;

  assert.equal(canonical.ok, false);
  assert.equal(canonical.workspaceChanged, true);
  assert.equal(canonical.code, "WORKSPACE_CHANGED");
  assert.deepEqual(calls, []);
});

test("background mutation never invokes canonical success after server rejection", async () => {
  const calls = [];
  const controller = {
    model: {
      state: { hopdong: [{ id: "contract-rejected" }] },
      async flushMutationOutbox() {},
      async persistChanges() {},
    },
    async autoSync() { return { ok: false, status: 400, data: { errors: [] } }; },
  };

  const result = await persistAndSync(controller, "hopdong", {
    backgroundSync: true,
    changes: { upserts: { hopdong: [{ id: "contract-rejected" }] } },
    afterLocalDurable: () => calls.push("local"),
    afterCanonicalSync: () => calls.push("canonical"),
  });

  const canonical = await result.syncPromise;
  assert.equal(canonical.canonicalStatus, CANONICAL_SAVE_STATUS.CANONICAL_REJECTED);
  assert.deepEqual(calls, ["local"]);
});
