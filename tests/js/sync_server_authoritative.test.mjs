import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { applyFailedPush } from "../../frontend/app/SyncPushService.js";
import { forceSyncData } from "../../frontend/app/SyncPullService.js";
import { resolvePendingSyncConflict } from "../../frontend/app/SyncCoordinator.js";
import { runManualSyncRetry } from "../../frontend/app/SyncCoordinator.js";
import {
  getStartupReconciliationState,
  initializeStartupReconciliation,
  transitionStartupReconciliation,
} from "../../frontend/app/startupReconciliation.js";

function fixture() {
  let persisted;
  let sequence = 0;
  const writes = [];
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  model.getWorkspaceToken = () => "user:org-a@1";
  model.isWorkspaceCurrent = (token) => token === "user:org-a@1";
  const base = { id: "package-a", rowVersion: 1, tenGoiThau: "Base" };
  const local = { ...base, tenGoiThau: "Rejected local" };
  const unrelated = { id: "package-b", rowVersion: 3, tenGoiThau: "Unrelated local" };
  const server = { ...base, rowVersion: 2, tenGoiThau: "Server authoritative" };
  model.state.goithau = [local, unrelated];
  model.db = { async applySyncChanges(change) { writes.push(structuredClone(change)); } };
  const outbox = new WorkspaceMutationOutbox({
    store: {
      persist(queue, localDeletions) { persisted = structuredClone({ queue, localDeletions }); },
      async flush() {},
    },
    getBaseSyncVersion: () => "7",
    createId: () => `mutation-${++sequence}`,
    isSyncedType: () => true,
    normalizeRecord: (row) => structuredClone(row),
    serializeRecord: (row) => structuredClone(row),
  });
  model._getMutationOutbox = () => outbox;
  outbox.enqueue({ kind: "upsert", table: "goithau", records: [local, unrelated], baseRecords: [base] });
  const snapshot = outbox.snapshotForSync(model.state).snapshot;
  const data = { status: "conflict", errors: [{ table: "goi_thau", id: base.id, code: "ROW_VERSION_CONFLICT", serverRecord: server }] };
  return { model, outbox, snapshot, data, server, writes, persisted: () => persisted };
}

test("durability failure retirement retry keeps later generations and never restores the rejected receipt", async () => {
  const f = fixture();
  let rejectFlush;
  let flushCalls = 0;
  f.outbox.store.flush = async () => {
    if (++flushCalls === 1) await new Promise((_, reject) => { rejectFlush = reject; });
  };
  const controller = {
    model: f.model, updateSyncState() {}, view: { showToast() {} },
    async forceSyncData() { return { ok: true, localMutationsPending: true }; },
  };
  const pending = applyFailedPush(controller, { status: 409, data: f.data, snapshot: f.snapshot });
  await new Promise((resolve) => setImmediate(resolve));
  const later = { id: "later-c", rowVersion: 8, tenGoiThau: "Later independent edit" };
  const newer = { id: "package-a", rowVersion: 1, tenGoiThau: "Newer same row CAS edit" };
  f.outbox.enqueue({ kind: "upsert", table: "goithau", records: [later, newer] });
  rejectFlush(new Error("Storage busy"));
  const failed = await pending;
  assert.equal(failed.reloadUnsafe, true);
  assert.deepEqual(f.outbox.snapshot().upserts.goithau["later-c"], later);
  assert.deepEqual(f.outbox.snapshot().upserts.goithau["package-a"], newer);
  const recovered = await runManualSyncRetry(controller);
  assert.equal(recovered.serverReloaded, true);
  assert.equal(controller._syncConflict, null);
  assert.equal(flushCalls, 2);
  assert.deepEqual(f.outbox.snapshot().upserts.goithau["package-a"], newer);
  assert.deepEqual(f.outbox.snapshot().upserts.goithau["later-c"], later);
  assert.equal(f.outbox.snapshot().upserts.goithau["package-b"].tenGoiThau, "Unrelated local");
  assert.equal(f.persisted().queue.upserts.goithau["package-a"].tenGoiThau, newer.tenGoiThau);
});

test("row conflict discards only rejected receipt rows and writes server data to memory and cache", async () => {
  const f = fixture();
  const result = await f.model.discardConflictingMutationBatch({ data: f.data, snapshot: f.snapshot });
  assert.deepEqual(result, { serverAuthoritative: true, records: [{ table: "goithau", id: "package-a" }] });
  assert.deepEqual(f.model.state.goithau.find((row) => row.id === "package-a"), f.server);
  assert.equal(f.outbox.snapshot().upserts.goithau["package-a"], undefined);
  assert.equal(f.outbox.snapshot().upserts.goithau["package-b"].tenGoiThau, "Unrelated local");
  assert.deepEqual(f.writes, [{ upserts: { goithau: [f.server] } }]);
  assert.equal(f.persisted().queue.upserts.goithau["package-a"], undefined);
});

test("row conflict keeps newer same-row generations and unrelated mutations", async () => {
  const f = fixture();
  f.outbox.enqueue({ kind: "upsert", table: "goithau", records: [{ ...f.server, tenGoiThau: "Explicit later edit" }] });
  await f.model.discardConflictingMutationBatch({ data: f.data, snapshot: f.snapshot });
  assert.equal(f.outbox.snapshot().upserts.goithau["package-a"].tenGoiThau, "Explicit later edit");
  assert.equal(f.outbox.snapshot().upserts.goithau["package-b"].tenGoiThau, "Unrelated local");
});

test("conflict refresh bypasses its active push and reports the server result without save success", async () => {
  const f = fixture();
  const calls = [];
  const controller = {
    model: f.model,
    view: { showToast: (...args) => calls.push(["toast", ...args]) },
    updateSyncState(state) { calls.push(["state", state]); },
    async forceSyncData(...args) { calls.push(["pull", ...args]); return { ok: true }; },
  };
  const result = await applyFailedPush(controller, { status: 409, data: f.data, snapshot: f.snapshot });
  assert.equal(result.ok, false);
  assert.equal(result.serverReloaded, true);
  assert.deepEqual(calls[0], ["pull", false, true, false, { skipFlush: true, skipActivePush: true, discardedConflictRecords: [{ table: "goithau", id: "package-a" }] }]);
  assert.equal(calls.at(-1)[1].message, "Đã dùng dữ liệu máy chủ");
  assert.equal(calls.some((call) => call[0] === "toast"), false);
  assert.equal(calls.some((call) => call.at(-1) === "success"), false);
});

test("server conflict reload does not await the push that owns it", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  let outboxStatusRead = false;
  const model = {
    state: {},
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: () => true,
    getMutationOutboxStatus() { outboxStatusRead = true; return { trusted: false }; },
  };
  const controller = {
    model,
    _autoSyncOwner: { workspaceToken: "user:org-a@1", promise: new Promise(() => {}) },
    updateSyncState() {},
  };
  try {
    const result = await forceSyncData.call(controller, false, true, false, { skipActivePush: true });
    assert.equal(outboxStatusRead, true);
    assert.equal(result.storageDegraded, true);
  } finally { globalThis.document = previousDocument; }
});

async function withCanonicalPull(snapshot, run) {
  const prior = Object.fromEntries(["document", "window", "navigator", "fetch"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  const values = {
    document: { getElementById: () => null, querySelector: () => null },
    window: { location: { pathname: "/goi-thau" } },
    navigator: { onLine: true },
    fetch: async (url) => {
      assert.match(String(url), /\/api\/get-all-data\?/);
      return new Response(JSON.stringify(snapshot), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    },
  };
  Object.entries(values).forEach(([key, value]) => Object.defineProperty(globalThis, key, {
    configurable: true, writable: true, value,
  }));
  try { await run(); } finally {
    Object.keys(values).forEach((key) => {
      if (prior[key]) Object.defineProperty(globalThis, key, prior[key]);
      else delete globalThis[key];
    });
  }
}

for (const deleted of [false, true]) {
  test(`failed canonical pull followed by manual retry ${deleted ? "removes a server-deleted row" : "uses the latest server row"} without reviving the rejected draft`, async () => {
    const f = fixture();
    const latest = { ...f.server, rowVersion: 4, tenGoiThau: "Latest server" };
    const baseline = [{ id: "package-a", rowVersion: 1, tenGoiThau: "Base" }, { id: "package-b", rowVersion: 3, tenGoiThau: "Other base" }];
    if (deleted) delete f.data.errors[0].serverRecord;
    const storage = new Map();
    f.model.workspaceStorage = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    };
    let pulls = 0;
    const controller = {
      model: f.model,
      view: { showToast() {} },
      planBreakdownDraft: { active: true, planId: "plan-a", snapshot: { goithau: structuredClone(baseline) } },
      backupGoiThauState: structuredClone(baseline),
      updateSyncState() {},
      async forceSyncData(...args) {
        if (++pulls === 1) throw new Error("Temporary canonical fetch failure");
        return forceSyncData.call(this, ...args);
      },
      getStartupReconciliationState() { return getStartupReconciliationState(this); },
    };
    initializeStartupReconciliation(controller);
    transitionStartupReconciliation(controller, "RECONCILING");
    transitionStartupReconciliation(controller, "CONFLICT");
    const failed = await applyFailedPush(controller, { status: 409, data: f.data, snapshot: f.snapshot });
    assert.equal(failed.reloadRequired, true);
    assert.deepEqual(controller._syncConflict.discardedRecords, [{ table: "goithau", id: "package-a" }]);
    const snapshot = { goithau: [...(deleted ? [] : [latest]), { id: "package-b", rowVersion: 3, tenGoiThau: "Other server" }], syncVersion: 9 };
    await withCanonicalPull(snapshot, async () => {
      const recovered = await resolvePendingSyncConflict(controller, failed);
      assert.equal(recovered.serverReloaded, true);
      assert.equal(controller._syncConflict, null);
      assert.equal(getStartupReconciliationState(controller).phase, "RECONCILED");
    });
    for (const rows of [f.model.state.goithau, controller.planBreakdownDraft.snapshot.goithau, controller.backupGoiThauState]) {
      assert.deepEqual(rows.find((row) => row.id === "package-a"), deleted ? undefined : latest);
    }
    assert.equal(f.model.state.goithau.find((row) => row.id === "package-b").tenGoiThau, "Unrelated local");
    assert.equal(f.outbox.snapshot().upserts.goithau["package-b"].tenGoiThau, "Unrelated local");
    assert.equal(f.outbox.snapshot().upserts.goithau["package-a"], undefined);
  });
}
