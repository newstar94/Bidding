import assert from "node:assert/strict";
import test from "node:test";
import { rebasePlanBreakdownDraftAfterServerMerge, restorePlanBreakdownDraft, pruneRevokedPlanBackupRows } from "../../frontend/plans/planBreakdownDraft.js";
import { dismissRevokedInteractiveState } from "../../frontend/app/SyncRenderCoordinator.js";
import { applyServerSnapshot } from "../../frontend/app/syncMergeUtils.js";
import { ScopedWorkspaceStorage, createWorkspaceScope, purgeWorkspaceLocalData } from "../../frontend/app/workspaceState.js";

test("legacy backup arrays discard revoked committed rows but preserve other rows and new drafts", () => {
  const revoked = { id: "old", rowVersion: 2 };
  const allowed = { id: "allowed", rowVersion: 1 };
  const draft = { id: "new" };
  const controller = { backupKeHoachState: [revoked, allowed, draft], backupGoiThauState: [allowed] };
  pruneRevokedPlanBackupRows(controller, { kehoach: ["old", "new"] });
  assert.deepEqual(controller.backupKeHoachState, [allowed, draft]);
  assert.deepEqual(controller.backupGoiThauState, [allowed]);
});

test("authoritative scope reset must not restore a revoked plan from a dirty breakdown draft", () => {
  const baseline = { id: "revoked-plan", tenKeHoach: "Original", rowVersion: 1 };
  const local = { ...baseline, tenKeHoach: "Unsaved edit" };
  const draft = { active: true, planId: baseline.id, snapshot: { kehoach: [baseline] } };
  const model = { state: { kehoach: [], goithau: [], hopdong: [] } };
  // This is the current full visibility-reset call order: authoritative server
  // state has removed the plan, then local rebase runs before editor dismissal.
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [local] }, new Set(["kehoach"]),
    { revokedIdsByTable: { kehoach: [baseline.id] } });
  const closed = [];
  const elements = new Map([
    ["modal-kehoach", { dataset: {}, classList: { contains: () => true } }],
    ["form-kehoach-id", { value: baseline.id }],
    ["modal-plan-breakdown", { dataset: {}, classList: { contains: () => true } }],
    ["breakdown-plan-id", { value: baseline.id }],
  ]);
  dismissRevokedInteractiveState({ model, view: { closeModal: (id) => closed.push(id) } }, {
    getElementById: (id) => elements.get(id),
  });
  assert.deepEqual(model.state.kehoach, [], "revoked data must stay absent after authoritative reset");
  assert.deepEqual(closed, ["modal-kehoach", "modal-plan-breakdown"]);
  restorePlanBreakdownDraft(model, draft);
  assert.deepEqual(model.state.kehoach, [], "later cancellation must not restore revoked data");
});

test("scope reset preserves independent authorized edits and genuinely new drafts", () => {
  const baseline = { id: "allowed", name: "before", rowVersion: 1 };
  const edited = { ...baseline, name: "local" };
  const fresh = { id: "new", name: "draft" };
  const model = { state: { kehoach: [baseline] } };
  const draft = { active: true, snapshot: { kehoach: [baseline] } };
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [edited, fresh] }, ["kehoach"],
    { revokedIdsByTable: { kehoach: ["other"] } });
  assert.deepEqual(model.state.kehoach, [edited, fresh]);
});

test("full manifest removal supplies revoked IDs to rebase and durable deletion", async () => {
  const old = { id: "revoked", name: "before", rowVersion: 1 };
  const edited = { ...old, name: "local" };
  const persisted = [];
  const model = {
    state: { kehoach: [edited] },
    db: { applySyncChanges: async (changes) => persisted.push(changes) },
  };
  const draft = { active: true, snapshot: { kehoach: [old] } };
  const merge = applyServerSnapshot(model, {
    useServerSidePagination: true, paginatedKeys: ["kehoach"],
    kehoach: [], recordManifest: { kehoach: [] },
  }, { useVersionDelta: false, since: "0" });
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [edited] }, merge.changedKeys,
    { revokedIdsByTable: merge.deletionsByTable });
  await merge.persistencePromise;
  assert.deepEqual(model.state.kehoach, []);
  assert.deepEqual(draft.snapshot.kehoach, []);
  assert.deepEqual(persisted[0].deletions.kehoach, ["revoked"]);
});

test("full non-paginated reset identifies previously visible rows removed by server", () => {
  const old = { id: "revoked", name: "before", rowVersion: 1 };
  const edited = { ...old, name: "local" };
  const model = { state: { kehoach: [edited] } };
  const draft = { active: true, snapshot: { kehoach: [old] } };
  const merge = applyServerSnapshot(model, { kehoach: [], useServerSidePagination: false },
    { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [edited] }, merge.changedKeys,
    { revokedIdsByTable: merge.deletionsByTable });
  assert.deepEqual(model.state.kehoach, []);
});

test("server regrant restores pending edit without carrying revocation across workspace epochs", () => {
  const old = { id: "record", name: "local", rowVersion: 2 };
  let epoch = "workspace-a@1";
  const model = { state: { kehoach: [old] }, getWorkspaceToken: () => epoch,
    getMutationQueue: () => ({ upserts: { kehoach: { record: old } } }) };
  applyServerSnapshot(model, { kehoach: [] }, { since: "0", visibilityScopeChanged: true });
  applyServerSnapshot(model, { kehoach: [{ ...old, name: "server" }] }, { useVersionDelta: true });
  assert.deepEqual(model.state.kehoach, [old]);
  applyServerSnapshot(model, { kehoach: [] }, { since: "0", visibilityScopeChanged: true });
  epoch = "workspace-b@1";
  applyServerSnapshot(model, { kehoach: [] }, { useVersionDelta: true });
  assert.deepEqual(model.state.kehoach, [old]);
});

test("scope reset keeps pending new inserts while discarding revoked update projection", () => {
  const created = { id: "new-local", name: "new" };
  const old = { id: "old", name: "before", rowVersion: 1 };
  const model = {
    state: { kehoach: [old, created] },
    getMutationQueue: () => ({
      upserts: { kehoach: { "new-local": created } },
      patches: { kehoach: { old: { id: "old", changes: { name: "edited" } } } },
    }),
  };
  const result = applyServerSnapshot(model, { kehoach: [], useServerSidePagination: false },
    { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  assert.deepEqual(model.state.kehoach, [created]);
  assert.deepEqual(result.deletionsByTable.kehoach, ["old"]);
  assert.equal(model.getMutationQueue().upserts.kehoach["new-local"], created);
});

for (const paginated of [false, true]) test(`scope reset preserves an uncommitted form draft, paginated=${paginated}`, () => {
  const local = { id: "unsaved-plan", name: "Draft" };
  const model = { state: { kehoach: [local] } };
  const draft = { active: true, snapshot: { kehoach: [] } };
  const result = applyServerSnapshot(model, { kehoach: [], useServerSidePagination: paginated,
    ...(paginated ? { paginatedKeys: ["kehoach"], recordManifest: { kehoach: [] } } : {}) },
    { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [local] }, result.changedKeys,
    { revokedIdsByTable: result.deletionsByTable });
  assert.deepEqual(model.state.kehoach, [local]);
});

test("ordinary synchronization retains the existing dirty-draft preservation contract", () => {
  const baseline = { id: "plan", name: "before", rowVersion: 1 };
  const local = { ...baseline, name: "unsaved" };
  const model = { state: { kehoach: [] } };
  const draft = { active: true, snapshot: { kehoach: [baseline] } };
  rebasePlanBreakdownDraftAfterServerMerge(model, draft, { kehoach: [local] }, ["kehoach"]);
  assert.deepEqual(model.state.kehoach, [local]);
});

for (const paginated of [false, true]) test(`visibility reset removes revoked existing upsert, paginated=${paginated}`, () => {
  const existing = { id: "revoked-upsert", name: "local edit", rowVersion: 2 };
  const queue = { upserts: { kehoach: { [existing.id]: existing } } };
  const model = { state: { kehoach: [existing] }, getMutationQueue: () => queue };
  applyServerSnapshot(model, { kehoach: [], useServerSidePagination: paginated,
    ...(paginated ? { paginatedKeys: ["kehoach"], recordManifest: { kehoach: [] } } : {}) },
    { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  assert.deepEqual(model.state.kehoach, [], "pending update cannot confer read permission");
  assert.equal(queue.upserts.kehoach[existing.id], existing, "projection handling must not silently erase the pending operation");
});

test("manifest revocation removes stale upserts from replacement writes too", async () => {
  const old = { id: "revoked", rowVersion: 2 };
  const visible = { id: "visible", rowVersion: 1 };
  let written;
  const model = { state: { kehoach: [old] },
    getMutationQueue: () => ({ upserts: { kehoach: { revoked: old } } }),
    db: { applySyncChanges: async (changes) => { written = changes; } } };
  const merge = applyServerSnapshot(model, { kehoach: [visible],
    useServerSidePagination: true, paginatedKeys: ["kehoach"],
    recordManifest: { kehoach: ["visible"] } },
  { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  await merge.persistencePromise;
  assert.deepEqual(model.state.kehoach, [visible]);
  assert.deepEqual(written.replacements.kehoach, [visible]);
});

for (const paginated of [false, true]) test(`scope reset retains authorized pending upsert, paginated=${paginated}`, () => {
  const server = { id: "allowed", name: "server", rowVersion: 2 };
  const local = { ...server, name: "local edit" };
  const model = { state: { kehoach: [local] },
    getMutationQueue: () => ({ upserts: { kehoach: { allowed: local } } }) };
  applyServerSnapshot(model, { kehoach: [server], useServerSidePagination: paginated,
    ...(paginated ? { paginatedKeys: ["kehoach"], recordManifest: { kehoach: ["allowed"] } } : {}) },
  { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  assert.deepEqual(model.state.kehoach, [local]);
});

test("a later unchanged-scope pull must not resurrect a previously revoked pending upsert", () => {
  const old = { id: "revoked", name: "local", rowVersion: 2 };
  const model = { state: { kehoach: [old] },
    getMutationQueue: () => ({ upserts: { kehoach: { revoked: old } } }) };
  applyServerSnapshot(model, { kehoach: [], useServerSidePagination: false },
    { useVersionDelta: false, since: "0", visibilityScopeChanged: true });
  assert.deepEqual(model.state.kehoach, []);
  applyServerSnapshot(model, { kehoach: [], useServerSidePagination: false },
    { useVersionDelta: true, since: "later", visibilityScopeChanged: false });
  assert.deepEqual(model.state.kehoach, []);
});

test("revoked upsert projection stays absent after model recreation with workspace storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  const old = { id: "revoked", rowVersion: 2 };
  const makeModel = () => ({ state: { kehoach: [] }, workspaceStorage: storage,
    getWorkspaceToken: () => "user:org@1",
    getMutationQueue: () => ({ upserts: { kehoach: { revoked: old } } }) });
  const first = makeModel();
  first.state.kehoach = [old];
  applyServerSnapshot(first, { kehoach: [] }, { since: "0", visibilityScopeChanged: true });
  const recreated = makeModel();
  applyServerSnapshot(recreated, { kehoach: [] }, { useVersionDelta: true });
  assert.deepEqual(recreated.state.kehoach, []);
  applyServerSnapshot(recreated, { kehoach: [{ ...old, name: "server regrant" }] }, { useVersionDelta: true });
  const afterRegrant = makeModel();
  applyServerSnapshot(afterRegrant, { kehoach: [] }, { useVersionDelta: true });
  assert.deepEqual(afterRegrant.state.kehoach, [old]);
});

test("revocation metadata storage failure is surfaced instead of silently acknowledged", () => {
  const model = { state: { kehoach: [{ id: "old", rowVersion: 1 }] },
    workspaceStorage: { getItem: () => null, setItem: () => { throw new Error("storage unavailable"); } } };
  assert.throws(() => applyServerSnapshot(model, { kehoach: [] },
    { since: "0", visibilityScopeChanged: true }), /storage unavailable/);
});

test("ordinary pulls do not require a metadata write when no revocations exist", () => {
  const model = { state: { kehoach: [] }, workspaceStorage: {
    getItem: () => null, setItem: () => assert.fail("unchanged metadata must not be written"),
  } };
  applyServerSnapshot(model, { kehoach: [] }, { useVersionDelta: true });
});

test("an already-open second model observes persisted revocation before its next pull", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  const old = { id: "revoked", rowVersion: 2 };
  const makeModel = () => ({ state: { kehoach: [old] }, workspaceStorage: storage,
    getWorkspaceToken: () => "user:org@1",
    getMutationQueue: () => ({ upserts: { kehoach: { revoked: old } } }) });
  const first = makeModel();
  const second = makeModel();
  applyServerSnapshot(second, { kehoach: [] }, { useVersionDelta: true });
  applyServerSnapshot(first, { kehoach: [] }, { since: "0", visibilityScopeChanged: true });
  second.state.kehoach = [];
  applyServerSnapshot(second, { kehoach: [] }, { useVersionDelta: true });
  assert.deepEqual(second.state.kehoach, []);
  applyServerSnapshot(first, { kehoach: [old] }, { useVersionDelta: true });
  applyServerSnapshot(second, { kehoach: [] }, { useVersionDelta: true });
  assert.deepEqual(second.state.kehoach, [old], "a server regrant observed by another tab must clear the stale fence");
});

test("persisted revocation metadata is isolated by user and organization", () => {
  const values = new Map();
  const backing = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value) };
  const record = { id: "same-id", rowVersion: 1 };
  const makeModel = (user, org) => ({ state: { kehoach: [record] },
    workspaceScope: createWorkspaceScope(user, org),
    workspaceStorage: new ScopedWorkspaceStorage(createWorkspaceScope(user, org), backing),
    getMutationQueue: () => ({ upserts: { kehoach: { "same-id": record } } }) });
  const original = makeModel("a", "one");
  applyServerSnapshot(original, { kehoach: [] }, { since: "0", visibilityScopeChanged: true });
  for (const [user, org] of [["a", "two"], ["b", "one"]]) {
    const other = makeModel(user, org);
    applyServerSnapshot(other, { kehoach: [] }, { useVersionDelta: true });
    assert.deepEqual(other.state.kehoach, [record]);
  }
});

test("workspace purge removes revocation metadata without clearing another user's namespace", async () => {
  const values = new Map();
  const backing = { getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index], get length() { return values.size; } };
  const scope = createWorkspaceScope("a", "one");
  const own = new ScopedWorkspaceStorage(scope, backing);
  const other = new ScopedWorkspaceStorage(createWorkspaceScope("b", "one"), backing);
  own.setItem("bf_revoked_projection_ids_v1", '[["kehoach",["old"]]]');
  other.setItem("bf_revoked_projection_ids_v1", '[["kehoach",["other"]]]');
  await purgeWorkspaceLocalData(scope, { localStorage: backing, sessionStorage: backing, indexedDB: {} });
  assert.equal(own.getItem("bf_revoked_projection_ids_v1"), null);
  assert.equal(other.getItem("bf_revoked_projection_ids_v1"), '[["kehoach",["other"]]]');
});
