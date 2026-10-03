import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceMutationOutbox } from "../../frontend/app/WorkspaceMutationOutbox.js";
import { savePackageInvitationInfo } from "../../frontend/packages/packageInvitation.js";

function invitationScenario({ syncResult = { ok: true }, onSync, onFlush, persistError } = {}) {
  const pkg = {
    id: "package-1", rowVersion: 1, thoiGianDongThau: "2026-08-01T09:00:00",
    giaHanList: [{ id: "old-extension", lyDoGiaHan: "Original" }],
    yeuCauLamRoList: [{ id: "old-request", noiDung: "Original request" }],
    traLoiLamRoList: [{ id: "old-response", noiDung: "Original response" }],
    phanLoList: [{ id: "lot-1", nested: { amount: 100 } }],
  };
  const original = structuredClone(pkg);
  let sequence = 0;
  let durableQueue;
  const outbox = new WorkspaceMutationOutbox({
    store: {
      persist(queue, localDeletions) { durableQueue = structuredClone({ queue, localDeletions }); },
      async flush() { await onFlush?.({ outbox, model, durable, pkg }); },
    },
    getBaseSyncVersion: () => "5",
    createId: () => `mutation-${++sequence}`,
    isSyncedType: () => true,
    normalizeRecord: (record) => structuredClone(record),
    serializeRecord: (record) => structuredClone(record),
  });
  const durable = new Map([[pkg.id, structuredClone(pkg)]]);
  const calls = [];
  const database = {
    stores: ["goithau"],
    async putRecord(table, record) {
      calls.push(["rollback", table, record.id]);
      durable.set(record.id, structuredClone(record));
    },
  };
  const model = {
    state: { goithau: [pkg] }, db: database,
    workspaceScope: { key: "org-a" },
    getWorkspaceToken() { return this.workspaceScope.key; },
    beginWorkspaceMutation() { return { state: this.state, db: this.db, outbox, done: false }; },
    finishWorkspaceMutation(mutation) { mutation.done = true; },
    workspaceMutationUsesCurrentResources(mutation) {
      return mutation.state === this.state && mutation.db === this.db;
    },
    commitLocalMutation(table, { records, baseRecords }) {
      outbox.enqueue({ kind: "upsert", table, records, baseRecords });
    },
    commitWorkspaceMutation(_mutation, table, options) { this.commitLocalMutation(table, options); },
    async persistChanges(table, { upserts }, options) {
      calls.push(["persist", table, options.trackMutation]);
      for (const record of upserts) durable.set(record.id, structuredClone(record));
      if (persistError && options.trackMutation !== false) throw persistError;
    },
    flushMutationOutbox: () => outbox.flush(),
  };
  const controller = {
    model,
    async autoSync() {
      calls.push(["sync"]);
      await onSync?.({ model, outbox, controller, durable, pkg });
      if (syncResult.ok === true && !syncResult.localMutationsPending && !syncResult.requiredActiveRole) {
        outbox.ack(outbox.snapshotForSync(model.state)?.snapshot);
      }
      return syncResult;
    },
    async fetchRecordByLookup(table, id) {
      calls.push(["fetch", table, id]);
      return { ...structuredClone(durable.get(id)), rowVersion: 2 };
    },
  };
  const entered = {
    extensions: [{ id: "extension-1", thoiGianDongThau: "31/08/2026 09:00", lyDoGiaHan: "Entered" }],
    clarificationRequests: [{ id: "request-1", noiDung: "Entered request" }],
    clarificationResponses: [{ id: "response-1", noiDung: "Entered response" }],
    convertDateTime: () => "2026-08-31T09:00:00",
  };
  return { controller, model, pkg, original, outbox, durable, calls, entered, getDurableQueue: () => durableQueue };
}

test("importing partial older extension history cannot rewind the package closing or opening", async () => {
  const scenario = invitationScenario();
  scenario.pkg.thoiGianDongThau = "2026-10-12T09:00:00";
  scenario.pkg.thoiGianMoThau = "2026-10-12T09:30:00";
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered,
    extensions: [{ id: `gh-${"a".repeat(64)}`, thoiGianDongThau: "28/09/2026 10:00", lyDoGiaHan: "Only version 00 available" }],
    preserveCurrentClosingForHistory: true,
    convertDateTime: () => "2026-09-28T10:00:00",
  });
  assert.equal(saved.giaHanList[0].thoiGianDongThau, "28/09/2026 10:00");
  assert.equal(saved.thoiGianDongThau, "2026-10-12T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-10-12T09:30:00");
});

test("saving previously imported partial history again preserves the latest closing without draft metadata", async () => {
  const scenario = invitationScenario();
  scenario.pkg.thoiGianDongThau = "2026-10-12T09:00:00";
  scenario.pkg.thoiGianMoThau = "2026-10-12T09:30:00";
  scenario.pkg.giaHanList = [{ id: `gh-${"a".repeat(64)}`, thoiGianDongThau: "28/09/2026 10:00", lyDoGiaHan: "Saved source history" }];
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered,
    extensions: [{ ...scenario.pkg.giaHanList[0], lyDoGiaHan: "Edited reason" }],
    convertDateTime: () => "2026-09-28T10:00:00",
  });
  assert.equal(saved.thoiGianDongThau, "2026-10-12T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-10-12T09:30:00");
  assert.equal(saved.giaHanList[0].lyDoGiaHan, "Edited reason");
});

test("a later extension in an imported-history draft still advances the package deadline", async () => {
  const scenario = invitationScenario();
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered, preserveCurrentClosingForHistory: true,
  });
  assert.equal(saved.thoiGianDongThau, "2026-08-31T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-08-31T09:00:00");
});

test("all-version source extension history advances the package to the latest new closing", async () => {
  const scenario = invitationScenario();
  scenario.pkg.thoiGianMoThau = "2026-08-01T09:30:00";
  const sourceRow = { ...scenario.entered.extensions[0], id: `gh-${"b".repeat(64)}` };
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered, extensions: [sourceRow], preserveCurrentClosingForHistory: true,
  });
  assert.deepEqual(saved.giaHanList, [sourceRow]);
  assert.equal(saved.thoiGianDongThau, "2026-08-31T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-08-31T09:00:00");
});

test("all-version historical rows can be resaved without deadline metadata", async () => {
  const scenario = invitationScenario();
  scenario.pkg.thoiGianDongThau = "2026-08-31T09:00:00";
  scenario.pkg.thoiGianMoThau = "2026-08-31T09:00:00";
  scenario.pkg.giaHanList = [{ ...scenario.entered.extensions[0], id: `gh-${"b".repeat(64)}` }];
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered, extensions: [{ ...scenario.pkg.giaHanList[0], lyDoGiaHan: "Edited reason" }],
  });
  assert.equal(saved.thoiGianDongThau, "2026-08-31T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-08-31T09:00:00");
  assert.equal(saved.giaHanList[0].lyDoGiaHan, "Edited reason");
});

test("a new manual extension still advances a package with all-version source history", async () => {
  const scenario = invitationScenario();
  const saved = await savePackageInvitationInfo(scenario.controller, scenario.pkg, {
    ...scenario.entered, preserveCurrentClosingForHistory: true,
  });
  assert.equal(saved.thoiGianDongThau, "2026-08-31T09:00:00");
  assert.equal(saved.thoiGianMoThau, "2026-08-31T09:00:00");
});

test("invitation save returns reloaded aggregate only after canonical commit", async () => {
  const scenario = invitationScenario();
  const result = await savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered);
  assert.equal(result.rowVersion, 2);
  assert.deepEqual(result.giaHanList, scenario.entered.extensions);
  assert.equal(result.thoiGianDongThau, "2026-08-31T09:00:00");
  assert.equal(result.thoiGianMoThau, result.thoiGianDongThau);
  assert.deepEqual(scenario.pkg, scenario.original);
  assert.deepEqual(scenario.calls.filter(([kind]) => ["sync", "fetch"].includes(kind)), [
    ["sync"], ["fetch", "goithau", "package-1"],
  ]);
});

for (const [name, result] of [
  ["rejected", { ok: false, code: "SYNC_VALIDATION_FAILED" }],
  ["conflict", { ok: false, status: 409, conflictQuarantined: true }],
  ["remote pending", { ok: true, localMutationsPending: true }],
  ["offline pending", { ok: false, transport: true }],
  ["role switch pending", { ok: true, requiredActiveRole: "employee" }],
]) {
  test(`invitation ${name} throws and restores original without replay`, async () => {
    const scenario = invitationScenario({ syncResult: result });
    const unrelated = { id: "unrelated", rowVersion: 2, notes: "Keep pending" };
    scenario.outbox.enqueue({ kind: "upsert", table: "goithau", records: [unrelated] });
    await assert.rejects(
      savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered),
      (error) => Boolean(error.code && error.syncResult === result),
    );
    assert.deepEqual(scenario.pkg, scenario.original);
    assert.deepEqual(scenario.model.state.goithau, [scenario.original]);
    assert.deepEqual(scenario.durable.get(scenario.pkg.id), scenario.original);
    assert.deepEqual(scenario.outbox.snapshot().upserts.goithau, { unrelated });
    assert.deepEqual(scenario.getDurableQueue().queue.upserts.goithau, { unrelated });
    assert.equal(scenario.calls.some(([kind]) => kind === "fetch"), false);
    assert.equal(scenario.entered.extensions[0].lyDoGiaHan, "Entered");
  });
}

test("invitation local persistence failure retires only failed attempt and restores durable aggregate", async () => {
  const failure = Object.assign(new Error("Storage failed"), { code: "STORAGE_FAILED" });
  const scenario = invitationScenario({ persistError: failure });
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered), failure);
  assert.deepEqual(scenario.pkg, scenario.original);
  assert.deepEqual(scenario.durable.get(scenario.pkg.id), scenario.original);
  assert.equal(scenario.outbox.snapshot().upserts.goithau?.[scenario.pkg.id], undefined);
  assert.equal(scenario.calls.some(([kind]) => kind === "sync"), false);
});

test("invitation failure restores preexisting pending entry for this package", async () => {
  const scenario = invitationScenario({ syncResult: { ok: false } });
  const previousPending = { ...scenario.original, notes: "Previous pending edit" };
  scenario.outbox.enqueue({ kind: "upsert", table: "goithau", records: [previousPending] });
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered));
  assert.deepEqual(scenario.outbox.snapshot().upserts.goithau[scenario.pkg.id], previousPending);
  assert.deepEqual(scenario.pkg, scenario.original);
});

test("invitation failed receipt cannot discard or overwrite newer same-package edit", async () => {
  let newer;
  const scenario = invitationScenario({
    syncResult: { ok: false },
    onSync({ model, outbox, durable, pkg }) {
      newer = { ...structuredClone(pkg), notes: "Newer edit" };
      model.state.goithau = [newer];
      durable.set(pkg.id, structuredClone(newer));
      outbox.enqueue({ kind: "upsert", table: "goithau", records: [newer] });
    },
  });
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered));
  assert.deepEqual(scenario.outbox.snapshot().upserts.goithau[scenario.pkg.id], newer);
  assert.deepEqual(scenario.model.state.goithau, [newer]);
  assert.deepEqual(scenario.durable.get(scenario.pkg.id), newer);
  assert.deepEqual(scenario.pkg, scenario.original);
});

test("invitation checks authoritative boundary before staging and leaves package untouched while awaiting", async () => {
  const scenario = invitationScenario();
  let release;
  const boundary = new Promise((resolve) => { release = resolve; });
  scenario.controller.awaitAuthoritativeMutationBoundary = () => boundary;
  const saving = savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered);
  assert.deepEqual(scenario.pkg, scenario.original);
  assert.deepEqual(scenario.outbox.snapshot().upserts, {});
  scenario.model.state = { goithau: [{ id: "new-workspace-package" }] };
  release();
  await assert.rejects(saving, { code: "WORKSPACE_CHANGED" });
  assert.deepEqual(scenario.model.state.goithau, [{ id: "new-workspace-package" }]);
  assert.equal(scenario.calls.length, 0);
});

test("invitation rollback rechecks target generation after outbox flush", async () => {
  let flushes = 0;
  let newer;
  const scenario = invitationScenario({
    syncResult: { ok: false },
    onFlush({ outbox, model, durable, pkg }) {
      if (++flushes !== 2) return;
      newer = { ...structuredClone(pkg), notes: "Edit during rollback flush" };
      model.state.goithau = [newer];
      durable.set(pkg.id, structuredClone(newer));
      outbox.enqueue({ kind: "upsert", table: "goithau", records: [newer] });
    },
  });
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered));
  assert.deepEqual(scenario.outbox.snapshot().upserts.goithau[scenario.pkg.id], newer);
  assert.deepEqual(scenario.durable.get(scenario.pkg.id), newer);
  assert.deepEqual(scenario.pkg, scenario.original);
});

for (const changedField of [{ rowVersion: 2 }, { rootId: "different-lineage" }]) {
  test(`invitation rejects stale editor after boundary changes ${Object.keys(changedField)[0]}`, async () => {
    const scenario = invitationScenario();
    const current = { ...structuredClone(scenario.pkg), ...changedField };
    scenario.controller.awaitAuthoritativeMutationBoundary = async () => {
      scenario.model.state.goithau = [current];
    };
    await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered), {
      code: "ROW_VERSION_CONFLICT",
    });
    assert.deepEqual(scenario.model.state.goithau, [current]);
    assert.deepEqual(scenario.pkg, scenario.original);
    assert.deepEqual(scenario.outbox.snapshot().upserts, {});
    assert.equal(scenario.calls.length, 0);
  });
}

for (const unavailableMethod of ["autoSync", "fetchRecordByLookup"]) {
  test(`invitation cannot stage without ${unavailableMethod} authority seam`, async () => {
    const scenario = invitationScenario();
    delete scenario.controller[unavailableMethod];
    await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered), {
      code: "INVITATION_SAVE_UNAVAILABLE",
    });
    assert.deepEqual(scenario.outbox.snapshot().upserts, {});
    assert.deepEqual(scenario.pkg, scenario.original);
    assert.equal(scenario.calls.length, 0);
  });
}

test("invitation workspace switch during sync cleans old attempt without writing to new workspace", async () => {
  const newPackage = { id: "new-workspace-package" };
  const scenario = invitationScenario({
    syncResult: { ok: false, code: "WORKSPACE_CHANGED", workspaceChanged: true },
    onSync({ model }) {
      model.state = { goithau: [newPackage] };
      model.db = { async putRecord() { assert.fail("Cannot write into new workspace"); } };
      model.workspaceScope = { key: "org-b" };
    },
  });
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered), {
    code: "WORKSPACE_CHANGED",
  });
  assert.deepEqual(scenario.pkg, scenario.original);
  assert.deepEqual(scenario.model.state.goithau, [newPackage]);
  assert.deepEqual(scenario.durable.get(scenario.pkg.id), scenario.original);
  assert.equal(scenario.outbox.snapshot().upserts.goithau?.[scenario.pkg.id], undefined);
  assert.equal(scenario.calls.some(([kind]) => kind === "fetch"), false);
});

test("invitation reload failure after commit never rolls back a committed server mutation", async () => {
  const scenario = invitationScenario();
  const reloadFailure = Object.assign(new Error("Lookup failed"), { code: "RECORD_LOOKUP_UNCONFIRMED" });
  scenario.controller.fetchRecordByLookup = async () => { throw reloadFailure; };
  await assert.rejects(savePackageInvitationInfo(scenario.controller, scenario.pkg, scenario.entered), reloadFailure);
  assert.equal(reloadFailure.canonicalCommitted, true);
  assert.equal(reloadFailure.syncResult.ok, true);
  assert.deepEqual(scenario.durable.get(scenario.pkg.id).giaHanList, scenario.entered.extensions);
  assert.equal(scenario.calls.some(([kind]) => kind === "rollback"), false);
});
