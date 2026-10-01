import assert from "node:assert/strict";
import { test } from "node:test";

import { prepareExportSnapshot, runManualSyncRetry } from "../../frontend/app/SyncCoordinator.js";
import { applyFailedPush, autoSync } from "../../frontend/app/SyncPushService.js";
import { fetchRecordByLookup, forceSyncData } from "../../frontend/app/SyncPullService.js";
import { DraftRecoveryStore } from "../../frontend/shared/DraftRecoveryStore.js";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { mutationQueueHasChanges } from "../../frontend/app/mutationQueue.js";

function durableOutboxScenario() {
  let persisted = { queue: {}, localDeletions: [] };
  let sequence = 0;
  const writes = [];
  const values = new Map([["bf_last_sync_version", "17"]]);
  const databaseValues = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  const makeOutbox = () => new WorkspaceMutationOutbox({
    store: {
      persist: (queue, localDeletions) => { persisted = structuredClone({ queue, localDeletions }); },
      flush: async () => {},
      hydrate: async () => structuredClone(persisted),
    },
    getBaseSyncVersion: () => "17",
    createId: () => `mutation-${++sequence}`,
    isSyncedType: () => true,
    normalizeRecord: (row) => structuredClone(row),
    serializeRecord: (row) => structuredClone(row),
    resolveServerTable: (table) => table === "nha_thau" ? "nhathau" : table,
  });
  let outbox = makeOutbox();
  const base = { id: "existing", rowVersion: 4, tenNhaThau: "Committed base" };
  const entered = { ...base, tenNhaThau: "Rejected entered content", diaChi: "Rejected address" };
  const model = {
    workspaceScope: { key: "user:org-a", organizationId: "org-a" },
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    workspaceStorage: storage,
    state: { nhathau: [entered] },
    getMutationQueue: () => outbox.snapshot(),
    hasPendingMutationOutboxChanges: () => mutationQueueHasChanges(outbox.snapshot()),
    buildMutationSyncPayload: () => outbox.snapshotForSync(model.state),
    discardRejectedMutations: (errors, receipt, options) => outbox.reject(receipt, errors, { ...options, state: model.state }),
    flushMutationOutbox: () => outbox.flush(),
    clearCommittedMutationBatch: (receipt) => outbox.ack(receipt),
    db: {
      get: async (key) => structuredClone(databaseValues.get(key) ?? null),
      set: async (key, value) => { databaseValues.set(key, structuredClone(value)); },
      update: async (key, update) => { databaseValues.set(key, structuredClone(update(databaseValues.get(key) ?? null))); },
      putRecord: async (table, row) => { writes.push(["put", table, structuredClone(row)]); },
      deleteRecord: async (table, id) => { writes.push(["delete", table, id]); },
    },
  };
  const controller = {
    model, autoSync, fetchRecordByLookup,
    updateSyncState() {},
    forceSyncData: async () => ({ ok: true, data: { nhathau: [], paginatedKeys: ["nhathau"], useServerSidePagination: true } }),
  };
  return {
    model, controller, storage, entered, base, writes, databaseValues,
    enqueue: (command) => outbox.enqueue(command),
    async reload() { outbox = makeOutbox(); await outbox.hydrate(); },
    savePrepared(receipt) {
      new DraftRecoveryStore(storage, { storageKey: "bf_rejected_mutation_drafts_v1" }).save(receipt.id, {
        workspaceKey: "user:org-a", phase: "prepared", snapshot: receipt,
        validationErrors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }],
      }, { pendingServerSync: false });
    },
  };
}

for (const variant of ["unchanged", "same-row-correction", "unrelated-newer"]) {
  test(`prepared rejection reconciles real hydrated generations without replay: ${variant}`, async () => {
    const previousFetch = globalThis.fetch;
    const previousDocument = globalThis.document;
    const scenario = durableOutboxScenario();
    const posts = [];
    let watchdog;
    globalThis.document = { cookie: "csrf_token=test", getElementById: () => null };
    globalThis.fetch = async (url, options) => {
      if (options?.method === "POST") {
        posts.push(JSON.parse(options.body));
        return new Response(JSON.stringify({ status: "success", syncVersion: 18 }), { status: 200 });
      }
      return new Response(JSON.stringify({ item: { ...scenario.base, rowVersion: 5, tenNhaThau: "Canonical", diaChi: "Canonical address" } }), { status: 200 });
    };
    try {
      scenario.enqueue({ kind: "upsert", table: "nhathau", records: [{ ...scenario.entered, tenNhaThau: "Earlier input" }], baseRecords: [scenario.base] });
      scenario.enqueue({ kind: "upsert", table: "nhathau", records: [scenario.entered], baseRecords: [scenario.base] });
      const oldReceipt = scenario.model.buildMutationSyncPayload().snapshot;
      scenario.savePrepared(oldReceipt);
      if (variant === "same-row-correction") {
        const correction = { ...scenario.entered, tenNhaThau: "New correction" };
        scenario.enqueue({ kind: "upsert", table: "nhathau", records: [correction] });
        scenario.model.state.nhathau = [correction];
      } else if (variant === "unrelated-newer") {
        const unrelated = { id: "unrelated", rowVersion: 2, tenNhaThau: "Unrelated correction" };
        scenario.enqueue({ kind: "upsert", table: "nhathau", records: [unrelated] });
        scenario.model.state.nhathau.push(unrelated);
      }
      await scenario.reload();
      const result = await Promise.race([
        autoSync.call(scenario.controller),
        new Promise((resolve, reject) => { watchdog = setTimeout(() => reject(new Error("Archive recovery waited on its own read owner")), 150); }),
      ]);
      assert.equal(result.ok, true, JSON.stringify(result, (key, value) => value instanceof Error ? String(value) : value));
      assert.equal((await autoSync.call(scenario.controller)).ok, true);
      assert.equal(posts.some((payload) => (payload.nhathau || []).some((row) => row.tenNhaThau === scenario.entered.tenNhaThau)), false);
      if (variant === "unchanged") assert.equal(posts.length, 0);
      else {
        assert.equal(posts.length, 1);
        assert.deepEqual(posts[0].nhathau.map((row) => row.id), [variant === "same-row-correction" ? "existing" : "unrelated"]);
      }
      assert.equal(scenario.model.hasPendingMutationOutboxChanges(), false);
    } finally {
      clearTimeout(watchdog);
      if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
      if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    }
  });
}

test("prepared rejected insert preserves a newer same-row correction in queue, projection and cache", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const scenario = durableOutboxScenario();
  const entered = { id: "existing", tenNhaThau: "Rejected fresh insert" };
  const correction = { ...entered, tenNhaThau: "Corrected fresh insert" };
  const posts = [];
  globalThis.document = { cookie: "csrf_token=test", getElementById: () => null };
  globalThis.fetch = async (url, options) => {
    assert.equal(options?.method, "POST", "a rejected unsaved insert has no canonical row to read");
    posts.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ status: "success", syncVersion: 18 }), { status: 200 });
  };
  try {
    scenario.model.state.nhathau = [entered];
    scenario.enqueue({ kind: "upsert", table: "nhathau", records: [entered] });
    scenario.savePrepared(scenario.model.buildMutationSyncPayload().snapshot);
    scenario.enqueue({ kind: "upsert", table: "nhathau", records: [correction] });
    scenario.model.state.nhathau = [correction];
    await scenario.reload();
    assert.equal((await autoSync.call(scenario.controller)).ok, true);
    assert.deepEqual(scenario.model.state.nhathau, [correction]);
    assert.equal(scenario.writes.some(([kind]) => kind === "delete"), false);
    assert.deepEqual(posts[0].nhathau, [correction]);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

test("legacy prepared delete with changed batch identity remains pending across two hydrated sync attempts", async () => {
  const previousFetch = globalThis.fetch;
  const scenario = durableOutboxScenario();
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("Ambiguous rejected delete must not replay"); };
  try {
    scenario.enqueue({ kind: "delete", table: "nhathau", records: [scenario.base] });
    scenario.savePrepared(scenario.model.buildMutationSyncPayload().snapshot);
    scenario.enqueue({ kind: "delete", table: "nhathau", records: [{ ...scenario.base, rowVersion: 5 }] });
    const unrelated = { id: "unrelated", rowVersion: 2, tenNhaThau: "Unrelated correction" };
    scenario.enqueue({ kind: "upsert", table: "nhathau", records: [unrelated] });
    await scenario.reload();
    const before = scenario.model.getMutationQueue();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal((await autoSync.call(scenario.controller)).restorationPending, true);
      assert.deepEqual(scenario.model.getMutationQueue(), before);
    }
    assert.equal(requests, 0);
    assert.equal(new DraftRecoveryStore(scenario.storage, { storageKey: "bf_rejected_mutation_drafts_v1" })
      .readAll()[Object.keys(JSON.parse(scenario.storage.getItem("bf_rejected_mutation_drafts_v1")))[0]].payload.phase, "prepared");
  } finally { if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch; }
});

for (const kind of ["upsert", "patch", "delete"]) {
  for (const status of kind === "delete" ? [200, 500] : [200]) {
    test(`canonical recovery preserves a ${kind} staged during real GET (${status}) in state, cache and outbox`, async () => {
      const previousFetch = globalThis.fetch;
      const previousConsoleError = console.error;
      const scenario = durableOutboxScenario();
      console.error = () => {};
      let resolveLookup;
      let markStarted;
      const started = new Promise((resolve) => { markStarted = resolve; });
      const lookup = new Promise((resolve) => { resolveLookup = resolve; });
      globalThis.fetch = async () => { markStarted(); return lookup; };
      try {
        scenario.enqueue({ kind: "upsert", table: "nhathau", records: [scenario.entered], baseRecords: [scenario.base] });
        const pending = applyFailedPush(scenario.controller, {
          status: 400, snapshot: scenario.model.buildMutationSyncPayload().snapshot,
          data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
        });
        await started;
        const newer = { ...scenario.base, tenNhaThau: "New correction" };
        const record = kind === "patch" ? { id: "existing", rowVersion: 4, tenNhaThau: "New correction" } : newer;
        scenario.enqueue({ kind, table: "nhathau", records: [record], baseRecords: [scenario.base] });
        const canonical = { ...scenario.base, rowVersion: 5, diaChi: "Canonical address", tenNhaThau: "Canonical" };
        resolveLookup(new Response(JSON.stringify({ item: status === 200 ? canonical : null }), { status }));
        const result = await pending;
        if (kind === "delete") {
          assert.deepEqual(scenario.model.state.nhathau, []);
          assert.equal(scenario.writes.some(([operation]) => operation === "put"), false);
          assert.deepEqual(scenario.writes.filter(([operation]) => operation === "delete"), [["delete", "nhathau", "existing"]]);
          assert.equal(scenario.model.getMutationQueue().deletes[0].id, "existing");
          assert.equal(result.restorationPending === true, status === 500);
        } else {
          const expected = kind === "patch" ? { ...canonical, tenNhaThau: "New correction", referenceOnly: false } : newer;
          assert.deepEqual(scenario.model.state.nhathau, [expected]);
          assert.deepEqual(scenario.writes.filter(([operation]) => operation === "put"), [["put", "nhathau", expected]]);
          assert.deepEqual(scenario.model.getMutationQueue()[kind === "patch" ? "patches" : "upserts"].nhathau.existing, record);
        }
      } finally {
        console.error = previousConsoleError;
        if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
      }
    });
  }
}

for (const storeResult of [false, true]) {
  test(`strict canonical lookup normalizes full authorized fields and ${storeResult ? "persists" : "does not persist"} read-only data`, async () => {
    const previousFetch = globalThis.fetch;
    const scenario = durableOutboxScenario();
    const original = structuredClone(scenario.model.state.nhathau);
    const canonical = { id: "existing", rowVersion: 5, ten_nha_thau: "Canonical", cccd: "authorized-identity", soTaiKhoan: "authorized-account", chuKy: "authorized-signature" };
    scenario.model.normalizeRecordKeys = (row, table) => {
      assert.equal(table, "nhathau");
      const normalized = { ...row, tenNhaThau: row.ten_nha_thau };
      delete normalized.ten_nha_thau;
      return normalized;
    };
    globalThis.fetch = async () => new Response(JSON.stringify({ item: canonical }), { status: 200 });
    try {
      const record = await fetchRecordByLookup.call(scenario.controller, "nhathau", "existing", { requireCanonicalOutcome: true, storeResult });
      assert.equal(record.tenNhaThau, "Canonical");
      assert.equal(record.referenceOnly, false);
      for (const field of ["cccd", "soTaiKhoan", "chuKy"]) assert.equal(record[field], canonical[field]);
      if (storeResult) {
        assert.deepEqual(scenario.model.state.nhathau, [record]);
        assert.deepEqual(scenario.writes, [["put", "nhathau", record]]);
      } else {
        assert.deepEqual(scenario.model.state.nhathau, original);
        assert.deepEqual(scenario.writes, []);
      }
    } finally { if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch; }
  });
}

test("older database prepared archive cannot override a locally completed restoration", async () => {
  const previousFetch = globalThis.fetch;
  const scenario = durableOutboxScenario();
  const draft = { payload: { workspaceKey: "user:org-a", phase: "prepared", snapshot: { id: "receipt-old" } }, savedAt: 500, pendingServerSync: false };
  scenario.databaseValues.set("bf_rejected_mutation_drafts_v1", { "receipt-old": draft });
  scenario.storage.setItem("bf_rejected_mutation_drafts_v1", JSON.stringify({ "receipt-old": { ...draft, savedAt: 100, payload: { ...draft.payload, phase: "restored" } } }));
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("A restored disposition has no active mutation"); };
  try {
    assert.equal((await autoSync.call(scenario.controller)).ok, true);
    assert.equal(requests, 0);
    assert.deepEqual(scenario.writes, []);
  } finally { if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch; }
});

test("late recovery archive read cannot apply or submit input in another workspace", async () => {
  const scenario = durableOutboxScenario();
  let resolveArchive;
  const archive = new Promise((resolve) => { resolveArchive = resolve; });
  scenario.model.db.get = () => archive;
  let token = "user:org-a@1";
  scenario.model.getWorkspaceToken = () => token;
  scenario.model.isWorkspaceCurrent = (candidate) => token === candidate;
  const pending = autoSync.call(scenario.controller);
  await new Promise((resolve) => setImmediate(resolve));
  token = "user:org-b@2";
  scenario.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  const nextWorkspace = { id: "org-b-row", tenNhaThau: "Workspace B" };
  scenario.model.state = { nhathau: [nextWorkspace] };
  resolveArchive({});
  assert.equal((await pending).workspaceChanged, true);
  assert.deepEqual(scenario.model.state.nhathau, [nextWorkspace]);
  assert.deepEqual(scenario.writes, []);
});

test("incomplete full pull cannot confirm absence of a rejected unsupported-table row", async () => {
  const scenario = durableOutboxScenario();
  const entered = { id: "existing", rowVersion: 4, userId: "member", targetId: "Rejected" };
  scenario.model.state.assignments = [entered];
  scenario.enqueue({ kind: "upsert", table: "assignments", records: [entered] });
  const receipt = scenario.model.buildMutationSyncPayload().snapshot;
  new DraftRecoveryStore(scenario.storage, { storageKey: "bf_rejected_mutation_drafts_v1" }).save(receipt.id, {
    workspaceKey: "user:org-a", phase: "prepared", snapshot: receipt,
    validationErrors: [{ table: "assignments", id: "existing", code: "INVALID", message: "Rejected" }],
  }, { pendingServerSync: false });
  scenario.controller.forceSyncData = async () => ({ ok: true, data: { assignments: [], paginatedKeys: ["assignments"], useServerSidePagination: true } });
  await scenario.reload();
  assert.equal((await autoSync.call(scenario.controller)).restorationPending, true);
  assert.deepEqual(scenario.model.state.assignments, [entered]);
  assert.equal(scenario.writes.some(([operation]) => operation === "delete"), false);
  assert.equal(scenario.model.hasPendingMutationOutboxChanges(), false);
});

test("archive hydration preserves an explicit deferred post-commit render", async () => {
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  const scenario = durableOutboxScenario();
  let renders = 0;
  scenario.model.state.activetab = "dashboard";
  scenario.controller.view = { renderDashboard: () => { renders += 1; } };
  scenario.controller._deferPostCommitRender = true;
  scenario.enqueue({ kind: "upsert", table: "nhathau", records: [scenario.entered] });
  globalThis.document = { cookie: "csrf_token=test", getElementById: (id) => id === "tab-dashboard" ? {} : null };
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "success", syncVersion: 18 }), { status: 200 });
  try {
    assert.equal((await autoSync.call(scenario.controller)).ok, true);
    assert.equal(renders, 0);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch; else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  }
});

function exportController(result, { pending = false, sendable = null } = {}) {
  return {
    model: {
      workspaceStorage: { getItem: () => "17" },
      buildMutationSyncPayload: () => sendable,
      hasPendingMutationOutboxChanges: () => pending,
    },
    autoSync: async () => result,
  };
}

test("official export rejects an ok sync result that still has unsendable local changes", async () => {
  const controller = exportController({ ok: true, skipped: true, localMutationsPending: true });
  await assert.rejects(prepareExportSnapshot.call(controller), /chưa.*máy chủ|chưa.*đồng bộ/i);
});

test("official export rejects changes waiting for a manager persona", async () => {
  const controller = exportController({
    ok: true, skipped: true, localMutationsPending: true, requiredActiveRole: "manager",
  });
  await assert.rejects(prepareExportSnapshot.call(controller), /Quản lý/);
});

test("official export rejects a mutation staged after the sync receipt was committed", async () => {
  const controller = exportController({ ok: true, data: { syncVersion: 18 } }, { pending: true });
  await assert.rejects(prepareExportSnapshot.call(controller), /chưa.*máy chủ|chưa.*đồng bộ/i);
});

test("official export preserves stored-version fallback when no local mutations remain", async () => {
  const controller = exportController({ ok: true, skipped: true });
  assert.equal(await prepareExportSnapshot.call(controller), "17");
});

test("official export returns the committed version instead of an older cursor", async () => {
  const controller = exportController({ ok: true, data: { syncVersion: 18 } });
  assert.equal(await prepareExportSnapshot.call(controller), "18");
});

test("official export rejects a workspace change during synchronization", async () => {
  let token = "user:org-a@1";
  const controller = exportController({ ok: true, data: { syncVersion: 18 } });
  controller.model.workspaceScope = { key: "user:org-a", organizationId: "org-a" };
  controller.model.getWorkspaceToken = () => token;
  controller.model.isWorkspaceCurrent = (candidate) => candidate === token;
  controller.autoSync = async () => {
    token = "user:org-b@2";
    return { ok: true, data: { syncVersion: 18 } };
  };
  await assert.rejects(prepareExportSnapshot.call(controller), /workspace|không gian|tổ chức/i);
});

for (const status of [429, 500, 503]) {
  test(`strict canonical lookup does not classify HTTP ${status} as absent`, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Temporary failure" }), {
      status,
      headers: { "Content-Type": "application/json", "Retry-After": "120" },
    });
    const model = { state: { nhathau: [] } };
    try {
      await assert.rejects(
        fetchRecordByLookup.call({ model }, "nhathau", "existing", { requireCanonicalOutcome: true }),
        (error) => error.status === status && error.code === "RECORD_LOOKUP_UNCONFIRMED",
      );
      assert.deepEqual(model.state.nhathau, []);
    } finally {
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    }
  });
}

for (const status of [401, 403, 404]) {
  test(`strict canonical lookup preserves authoritative HTTP ${status} scope/absence result`, async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ item: null }), { status });
    try {
      assert.equal(await fetchRecordByLookup.call({ model: { state: {} } }, "nhathau", "existing", {
        requireCanonicalOutcome: true,
      }), null);
    } finally {
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    }
  });
}

test("ordinary lookup keeps the existing null result for non-success responses", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("Temporary failure", { status: 500 });
  try {
    assert.equal(await fetchRecordByLookup.call({ model: { state: {} } }, "nhathau", "existing"), null);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("rejected update does not delete an existing projection when canonical lookup throws", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const record = { id: "contractor-existing", rowVersion: 4, tenNhaThau: "Existing" };
  const deleted = [];
  const calls = [];
  const controller = {
    model: {
      workspaceScope: { key: "user:org-a", organizationId: "org-a" },
      getWorkspaceToken: () => "user:org-a@1",
      isWorkspaceCurrent: (token) => token === "user:org-a@1",
      state: { nhathau: [record] },
      discardRejectedMutations() {
        calls.push("discard");
        return [{ type: "nhathau", id: record.id, operation: "upsert", newInsert: false }];
      },
      async flushMutationOutbox() { calls.push("flush"); },
      db: { async deleteRecord(...args) { deleted.push(args); } },
    },
    async fetchRecordByLookup() { throw new TypeError("Network interrupted"); },
    updateSyncState() {},
  };
  try {
    const result = await applyFailedPush(controller, {
      status: 400,
      data: { status: "error", errors: [{ table: "nha_thau", id: record.id, code: "INVALID", message: "Rejected" }] },
      snapshot: { id: "receipt-update" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.validation, true);
    assert.deepEqual(calls, ["discard", "flush"], "the rejected batch is not left available for replay");
    assert.deepEqual(deleted, [], "network failure does not prove deletion or visibility revocation");
    assert.deepEqual(controller.model.state.nhathau, [record]);
  } finally {
    console.error = originalConsoleError;
  }
});

function rejectedUpdateScenario({ base = null, failStorage = false, databaseRecovery = false } = {}) {
  const values = new Map([["bf_last_sync_version", "17"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failStorage) throw new Error("Storage unavailable");
      values.set(key, String(value));
    },
    removeItem: (key) => values.delete(key),
  };
  const entered = { id: "existing", rowVersion: 4, tenNhaThau: "Rejected entered content" };
  const snapshot = {
    id: "rejected-receipt:1",
    upserts: { nhathau: { existing: 1 } },
    recordSnapshots: { upserts: { nhathau: { existing: entered } }, patches: {} },
    baseSnapshots: base ? { nhathau: { existing: base } } : {},
  };
  let active = true;
  const writes = [];
  const databaseValues = new Map();
  const model = {
    workspaceScope: { key: "user:org-a", userId: "user", organizationId: "org-a" },
    workspaceStorage: storage,
    getWorkspaceToken: () => "user:org-a@1",
    isWorkspaceCurrent: (token) => token === "user:org-a@1",
    state: { nhathau: [entered] },
    discardRejectedMutations() {
      writes.push(["discard"]);
      active = false;
      return [{ type: "nhathau", id: "existing", operation: "upsert", newInsert: false }];
    },
    async flushMutationOutbox() { writes.push(["flush"]); },
    hasPendingMutationOutboxChanges: () => active,
    buildMutationSyncPayload: () => active ? { snapshot, payload: { nhathau: [entered] } } : null,
    db: {
      async deleteRecord(...args) { writes.push(["delete", ...args]); },
      async putRecord(...args) { writes.push(["put", ...args]); },
      ...(databaseRecovery ? {
        async get(key) { writes.push(["get-recovery", key]); return structuredClone(databaseValues.get(key) ?? null); },
        async set(key, value) { databaseValues.set(key, structuredClone(value)); },
        async update(key, update) {
          const next = update(structuredClone(databaseValues.get(key) ?? null));
          databaseValues.set(key, structuredClone(next));
          return next;
        },
      } : {}),
    },
  };
  const controller = {
    model, autoSync,
    async fetchRecordByLookup() { throw new TypeError("Network interrupted"); },
    updateSyncState(state) { writes.push(["state", state.phase]); },
  };
  return { controller, model, snapshot, storage, writes, entered, databaseValues };
}

test("terminal rejection preserves receipt input durably and restores its trusted base without replay", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const base = { id: "existing", rowVersion: 4, tenNhaThau: "Committed base" };
  const scenario = rejectedUpdateScenario({ base });
  try {
    const result = await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    assert.equal(result.restorationPending, true, "the base is not a fresh authoritative lookup");
    assert.deepEqual(scenario.model.state.nhathau, [base]);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
    assert.equal(scenario.writes.some(([kind]) => kind === "put"), true);
    const reloadedDraftStore = new DraftRecoveryStore(scenario.storage, {
      storageKey: "bf_rejected_mutation_drafts_v1",
    });
    const draft = reloadedDraftStore.restore(scenario.snapshot.id);
    assert.equal(draft.pendingServerSync, false, "recovery is not a replay queue");
    assert.equal(draft.payload.workspaceKey, "user:org-a");
    assert.deepEqual(draft.payload.snapshot.recordSnapshots.upserts.nhathau.existing, scenario.entered);
  } finally { console.error = originalConsoleError; }
});

test("missing base leaves unresolved projection intact and blocks export until canonical recovery", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  try {
    const result = await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    assert.equal(result.restorationPending, true);
    assert.deepEqual(scenario.model.state.nhathau, [scenario.entered]);
    await assert.rejects(prepareExportSnapshot.call(scenario.controller));
    const canonical = { id: "existing", rowVersion: 5, tenNhaThau: "Canonical" };
    scenario.controller.fetchRecordByLookup = async () => {
      scenario.model.state.nhathau = [canonical];
      return canonical;
    };
    assert.equal(await prepareExportSnapshot.call(scenario.controller), "17");
    assert.deepEqual(scenario.model.state.nhathau, [canonical]);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
    assert.equal(scenario.writes.filter(([kind]) => kind === "discard").length, 1);
  } finally { console.error = originalConsoleError; }
});

test("failed recovery-draft storage does not discard entered input or allow background replay", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario({ failStorage: true });
  try {
    const result = await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    assert.equal(result.draftRecoveryFailed, true);
    assert.equal(scenario.writes.some(([kind]) => kind === "discard"), false);
    assert.deepEqual(scenario.model.state.nhathau, [scenario.entered]);
    const retry = await autoSync.call(scenario.controller);
    assert.equal(retry.draftRecoveryFailed, true);
    assert.equal(scenario.writes.some(([kind]) => kind === "discard"), false);
  } finally { console.error = originalConsoleError; }
});

test("pending canonical restoration survives controller reload without replaying rejected input", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  try {
    await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    const freshController = {
      model: scenario.model, autoSync,
      fetchRecordByLookup: scenario.controller.fetchRecordByLookup,
      updateSyncState() {},
    };
    const pending = await autoSync.call(freshController);
    assert.equal(pending.restorationPending, true);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
    assert.equal(scenario.writes.filter(([kind]) => kind === "discard").length, 1);
  } finally { console.error = originalConsoleError; }
});

test("manual retry attempts pending canonical restoration before showing original validation errors", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  try {
    await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    const canonical = { id: "existing", rowVersion: 5, tenNhaThau: "Canonical" };
    scenario.controller.fetchRecordByLookup = async () => {
      scenario.model.state.nhathau = [canonical];
      return canonical;
    };
    await runManualSyncRetry(scenario.controller);
    assert.deepEqual(scenario.model.state.nhathau, [canonical]);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
  } finally { console.error = originalConsoleError; }
});

test("canonical restoration uses full reconciliation instead of overwriting newer pending edits", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  try {
    await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    const newer = { id: "existing", rowVersion: 4, tenNhaThau: "New correction" };
    scenario.model.state.nhathau = [newer];
    scenario.model.hasPendingMutationOutboxChanges = () => true;
    scenario.model.getMutationQueue = () => ({ upserts: { nhathau: { existing: newer } } });
    let pulls = 0;
    let lookups = 0;
    scenario.controller.forceSyncData = async (...args) => {
      assert.deepEqual(args, [false, true, false]);
      pulls += 1;
      return { ok: true };
    };
    scenario.controller.fetchRecordByLookup = async () => {
      lookups += 1;
      return { id: "existing", rowVersion: 5, tenNhaThau: "Canonical" };
    };
    const result = await autoSync.call(scenario.controller);
    assert.equal(pulls, 1);
    assert.equal(lookups, 1, "a full pull does not prove heavy-record canonical hydration");
    assert.equal(result.localMutationsPending, true);
    assert.deepEqual(scenario.model.state.nhathau, [newer]);
  } finally { console.error = originalConsoleError; }
});

test("rejected tables without record lookup support recover through full canonical reconciliation", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  const canonical = { id: "assignment-existing", userId: "member", targetId: "package" };
  let pulls = 0;
  scenario.model.state.assignments = [{ ...canonical, targetId: "Rejected" }];
  scenario.model.discardRejectedMutations = () => [{
    type: "assignments", id: canonical.id, operation: "upsert", newInsert: false,
  }];
  scenario.controller.forceSyncData = async (...args) => {
    assert.deepEqual(args, [false, true, false]);
    pulls += 1;
    scenario.model.state.assignments = [canonical];
    return { ok: true, data: { assignments: [canonical], paginatedKeys: ["nhathau"], useServerSidePagination: true } };
  };
  try {
    const result = await applyFailedPush(scenario.controller, {
      status: 400, snapshot: { id: "assignment-receipt" },
      data: { errors: [{ table: "phan_cong", id: canonical.id, code: "INVALID", message: "Rejected" }] },
    });
    assert.equal(pulls, 1);
    assert.notEqual(result.restorationPending, true);
    assert.deepEqual(scenario.model.state.assignments, [canonical]);
  } finally { console.error = originalConsoleError; }
});

for (const status of [403, 404, 500]) {
  test(`rejected update handles real canonical HTTP ${status} without confusing failure with revocation`, async () => {
    const previousFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    console.error = () => {};
    globalThis.fetch = async () => new Response(JSON.stringify({ item: null }), { status });
    const base = { id: "existing", rowVersion: 4, tenNhaThau: "Committed base" };
    const scenario = rejectedUpdateScenario({ base });
    scenario.controller.fetchRecordByLookup = fetchRecordByLookup;
    try {
      const result = await applyFailedPush(scenario.controller, {
        status: 400, snapshot: scenario.snapshot,
        data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
      });
      if (status === 500) {
        assert.equal(result.restorationPending, true);
        assert.deepEqual(scenario.model.state.nhathau, [base]);
        assert.equal(scenario.writes.some(([kind]) => kind === "delete"), false);
      } else {
        assert.notEqual(result.restorationPending, true);
        assert.deepEqual(scenario.model.state.nhathau, []);
        assert.equal(scenario.writes.some(([kind]) => kind === "delete"), true);
      }
    } finally {
      console.error = originalConsoleError;
      if (previousFetch === undefined) delete globalThis.fetch;
      else globalThis.fetch = previousFetch;
    }
  });
}

test("strict canonical lookup rejects a malformed success payload before touching the projection", async () => {
  const previousFetch = globalThis.fetch;
  const record = { id: "existing", rowVersion: 4 };
  const model = { state: { nhathau: [record] } };
  try {
    for (const item of [undefined, [], {}, "unexpected"]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ item }), { status: 200 });
      await assert.rejects(fetchRecordByLookup.call({ model }, "nhathau", "existing", {
        requireCanonicalOutcome: true,
      }), (error) => error.code === "RECORD_LOOKUP_UNCONFIRMED");
      assert.deepEqual(model.state.nhathau, [record]);
    }
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("workspace change during failed canonical lookup cannot roll a base into the next workspace", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const base = { id: "existing", rowVersion: 4, tenNhaThau: "Committed base" };
  const scenario = rejectedUpdateScenario({ base });
  let token = "user:org-a@1";
  let rejectLookup;
  const lookup = new Promise((resolve, reject) => { rejectLookup = reject; });
  scenario.model.getWorkspaceToken = () => token;
  scenario.model.isWorkspaceCurrent = (candidate) => candidate === token;
  scenario.controller.fetchRecordByLookup = () => lookup;
  try {
    const pending = applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    await new Promise((resolve) => setImmediate(resolve));
    token = "user:org-b@2";
    scenario.model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    const recordB = { id: "existing-b", tenNhaThau: "Workspace B" };
    scenario.model.state = { nhathau: [recordB] };
    rejectLookup(new TypeError("Lookup failed late"));
    const result = await pending;
    assert.equal(result.workspaceChanged, true);
    assert.deepEqual(scenario.model.state.nhathau, [recordB]);
    assert.equal(scenario.writes.some(([kind]) => ["delete", "put"].includes(kind)), false);
  } finally { console.error = originalConsoleError; }
});

test("concurrent canonical recovery retries share one workspace-bound lookup", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  try {
    await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    let resolveLookup;
    const lookup = new Promise((resolve) => { resolveLookup = resolve; });
    let lookups = 0;
    scenario.controller.fetchRecordByLookup = async () => {
      lookups += 1;
      const canonical = await lookup;
      scenario.model.state.nhathau = [canonical];
      return canonical;
    };
    const first = autoSync.call(scenario.controller);
    const second = autoSync.call(scenario.controller);
    assert.equal(first, second);
    resolveLookup({ id: "existing", rowVersion: 5, tenNhaThau: "Canonical" });
    assert.equal((await first).ok, true);
    assert.equal(lookups, 1);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
  } finally { console.error = originalConsoleError; }
});

test("terminal rejection cannot wait for a canonical pull that is itself waiting for the active push", async () => {
  const previousFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario();
  let active = true;
  let pulls = 0;
  let watchdog;
  const rejected = { type: "assignments", id: "existing", operation: "upsert", newInsert: false };
  scenario.model.buildMutationSyncPayload = () => active ? {
    snapshot: scenario.snapshot, payload: { assignments: [{ id: "existing", targetId: "package" }] },
  } : null;
  scenario.model.hasPendingMutationOutboxChanges = () => active;
  scenario.model.discardRejectedMutations = () => { active = false; return [rejected]; };
  scenario.controller.forceSyncData = forceSyncData;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/sync") && !String(url).includes("?")) {
      return new Response(JSON.stringify({ status: "error", errors: [{
        table: "phan_cong", id: "existing", code: "INVALID", message: "Rejected",
      }] }), { status: 400 });
    }
    pulls += 1;
    throw new Error("Full pull must run after the rejected push completes");
  };
  try {
    const result = await Promise.race([
      autoSync.call(scenario.controller),
      new Promise((resolve, reject) => {
        watchdog = setTimeout(() => reject(new Error("The rejected push waited on itself")), 100);
      }),
    ]);
    assert.equal(result.restorationPending, true);
    assert.equal(pulls, 0);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
  } finally {
    clearTimeout(watchdog);
    console.error = originalConsoleError;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("IndexedDB retains rejected receipt disposition when localStorage fails, including after reload", async () => {
  const previousFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  console.error = () => {};
  const scenario = rejectedUpdateScenario({ failStorage: true, databaseRecovery: true });
  let posts = 0;
  globalThis.fetch = async () => {
    posts += 1;
    return new Response(JSON.stringify({ status: "success", syncVersion: 18 }), { status: 200 });
  };
  try {
    const result = await applyFailedPush(scenario.controller, {
      status: 400, snapshot: scenario.snapshot,
      data: { errors: [{ table: "nha_thau", id: "existing", code: "INVALID", message: "Rejected" }] },
    });
    assert.notEqual(result.draftRecoveryFailed, true);
    assert.equal(result.restorationPending, true);
    assert.equal(scenario.model.buildMutationSyncPayload(), null);
    const persisted = scenario.databaseValues.get("bf_rejected_mutation_drafts_v1")[scenario.snapshot.id];
    assert.equal(persisted.pendingServerSync, false);
    assert.equal(persisted.payload.phase, "rejected");
    assert.deepEqual(persisted.payload.snapshot.recordSnapshots.upserts.nhathau.existing, scenario.entered);
    const freshController = {
      model: scenario.model, autoSync,
      fetchRecordByLookup: scenario.controller.fetchRecordByLookup,
      updateSyncState() {},
    };
    const reloadedResult = await autoSync.call(freshController);
    assert.equal(reloadedResult.restorationPending, true);
    assert.equal(posts, 0, "a fresh controller reads durable rejection disposition before any POST");
  } finally {
    console.error = originalConsoleError;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});
