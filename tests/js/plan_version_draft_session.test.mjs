import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanDraftFinalizePayload,
  createPlanVersionDraftSession,
  finalizePlanVersionDraft,
  hydratePlanVersionDraftSessions,
  reapplyPlanVersionDraftSessions,
  refreshPlanVersionDraftSession,
  removePlanVersionDraftSession,
  savePlanVersionDraftSession,
  validatePlanVersionDraftSession,
} from "../../frontend/plans/PlanVersionDraftSession.js";
import {
  handleKeHoachSubmit,
  saveIntermediatePlanVersion,
  savePlanBreakdown,
} from "../../frontend/plans/KeHoachWorkflow.js";

function draftState() {
  return {
    chudautu: [{ id: "investor-1", tenChuDauTu: "Chủ đầu tư A" }],
    chuyengia: [{ id: "expert-1", hoTen: "E1" }, { id: "expert-2", hoTen: "E2" }],
    nhathau: [],
    kehoach: [{
      id: "plan-00", rootId: "plan-00", phienBan: "00", isLatest: 1,
      chuDauTuId: "investor-1", tenKeHoach: "Kế hoạch nháp",
    }],
    goithau: [{
      id: "package-00", rootId: "package-00", keHoachId: "plan-00",
      phienBan: "00", isLatest: 1, tenGoiThau: "A",
      toChuyenGia: [{ chuyenGiaId: "expert-1" }], toThamDinh: [],
    }],
    goithauhanghoa: [{ id: "goods-00", goiThauId: "package-00", tenHangHoa: "HH A" }],
    thongtinmothau: [],
    hanghoaduthaunhathau: [],
    assignments: [
      { id: "plan-assignment-00", targetId: "plan-00", type: "kehoach", empId: "employee-1" },
      { id: "package-assignment-00", targetId: "package-00", type: "goithau", empId: "employee-1" },
    ],
  };
}

function memoryDb() {
  const values = new Map();
  let queue = Promise.resolve();
  return {
    values,
    async get(key) { return structuredClone(values.get(key)); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    update(key, updater) {
      const operation = queue.then(() => {
        const next = updater(structuredClone(values.get(key) ?? null));
        values.set(key, structuredClone(next));
        return structuredClone(next);
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function workspaceModel({ token = "user:org-a@1", state = draftState(), db = memoryDb() } = {}) {
  const storage = {
    values: new Map(),
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
  };
  return {
    token,
    state,
    db,
    workspaceStorage: storage,
    workspaceScope: { key: token.split("@")[0], organizationId: "org-a" },
    getWorkspaceToken() { return this.token; },
    isWorkspaceCurrent(candidate) { return candidate === this.token; },
    normalizeRecordKeys: (row) => row,
    beginWorkspaceMutation() {
      return { state: this.state, db: this.db, storage: this.workspaceStorage, done: false };
    },
    workspaceMutationUsesCurrentResources(mutation) {
      return !mutation.done && mutation.state === this.state
        && mutation.db === this.db && mutation.storage === this.workspaceStorage;
    },
    finishWorkspaceMutation(mutation) { mutation.done = true; },
  };
}

test("draft sessions recover only from the active workspace database", async () => {
  const stateA = draftState();
  const dbA = memoryDb();
  const modelA = { state: stateA, db: dbA };
  const session = createPlanVersionDraftSession(stateA, "plan-00", "2026-08-19T10:00:00Z");
  await savePlanVersionDraftSession(modelA, session);

  const reloadedA = { state: draftState(), db: dbA };
  reloadedA.state.kehoach = [];
  reloadedA.state.goithau = [];
  reloadedA.state.assignments = [];
  await hydratePlanVersionDraftSessions(reloadedA);
  assert.deepEqual(reloadedA.state.kehoach.map((row) => row.id), ["plan-00"]);
  assert.deepEqual(reloadedA.state.goithau.map((row) => row.id), ["package-00"]);

  const modelB = { state: { kehoach: [], goithau: [] }, db: memoryDb() };
  await hydratePlanVersionDraftSessions(modelB);
  assert.deepEqual(modelB.planVersionDraftSessions, []);
  assert.deepEqual(modelB.state.kehoach, []);
});

test("intermediate save snapshots the complete aggregate and performs no server write", async () => {
  const previousDocument = globalThis.document;
  const state = draftState();
  const db = memoryDb();
  const calls = [];
  const elements = new Map([
    ["breakdown-plan-id", { value: "plan-00" }],
    ["tbody-breakdown-dathuchien", { querySelectorAll: () => [] }],
    ["tbody-breakdown-khongapdung", { querySelectorAll: () => [] }],
    ["tbody-breakdown-chuadudieuKien", { querySelectorAll: () => [] }],
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  const model = {
    state, db,
    getCurrentDateTimeString: () => "2026-08-19 10:00:00",
    normalizeRecordKeys: (row) => row,
  };
  const session = createPlanVersionDraftSession(state, "plan-00", "2026-08-19T10:00:00Z");
  await savePlanVersionDraftSession(model, session);
  const controller = {
    model,
    planBreakdownDraft: { active: true, action: "create", planId: "plan-00" },
    tempPlanAction: "create",
    loadBreakdownPackageDetails: async () => {},
    openPlanBreakdownModal: async (id) => calls.push(["open", id]),
    updateBreakdownTotal() {},
    recalculatePlanTotal() {},
    view: { renderKeHoachTable() {}, renderGoiThauTable() {} },
    autoSync: async () => calls.push(["sync"]),
    createAggregateVersion: async () => calls.push(["versioning"]),
    finalizePlanDraft: async () => calls.push(["finalize"]),
  };

  try {
    const result = await saveIntermediatePlanVersion.call(controller);
    assert.equal(result.version, "01");
    assert.deepEqual(calls, [["open", result.planId]]);
    assert.deepEqual(state.kehoach.map((row) => row.phienBan), ["00", "01"]);
    assert.deepEqual(state.kehoach.map((row) => row.isLatest), [0, 1]);
    assert.deepEqual(state.goithau.map((row) => row.tenGoiThau), ["A", "A"]);
    assert.equal(state.goithau[0].isLatest, 0);
    assert.equal(state.goithau[1].isLatest, 1);
    assert.notEqual(state.goithau[0].id, state.goithau[1].id);
    assert.equal(state.goithauhanghoa.length, 2);
    assert.equal(state.assignments.filter((row) => row.type === "kehoach").length, 2);
    assert.equal(model.planVersionDraftSessions[0].versions.join(","), "00,01");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("successive local versions freeze package A/B/C and E1 to E1+E2 to E2", async () => {
  const previousDocument = globalThis.document;
  const state = draftState();
  const db = memoryDb();
  const planControl = { value: "plan-00" };
  const elements = new Map([
    ["breakdown-plan-id", planControl],
    ["tbody-breakdown-dathuchien", { querySelectorAll: () => [] }],
    ["tbody-breakdown-khongapdung", { querySelectorAll: () => [] }],
    ["tbody-breakdown-chuadudieuKien", { querySelectorAll: () => [] }],
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  const model = {
    state, db,
    getCurrentDateTimeString: () => "2026-08-19 10:00:00",
    normalizeRecordKeys: (row) => row,
    workspaceStorage: { getItem: () => "0" },
  };
  const session = createPlanVersionDraftSession(state, "plan-00", "2026-08-19T10:00:00Z");
  await savePlanVersionDraftSession(model, session);
  const controller = {
    model,
    planBreakdownDraft: { active: true, action: "create", planId: "plan-00" },
    tempPlanAction: "create",
    loadBreakdownPackageDetails: async () => {},
    openPlanBreakdownModal: async (id) => { planControl.value = id; },
    view: { renderKeHoachTable() {}, renderGoiThauTable() {} },
  };

  try {
    const version01 = await saveIntermediatePlanVersion.call(controller);
    const package01 = state.goithau.find((row) => row.keHoachId === version01.planId);
    package01.tenGoiThau = "B";
    state.assignments.push({
      id: "package-assignment-01-e2", targetId: package01.id,
      type: "goithau", empId: "employee-2",
    });

    const version02 = await saveIntermediatePlanVersion.call(controller);
    const package02 = state.goithau.find((row) => row.keHoachId === version02.planId);
    package02.tenGoiThau = "C";
    state.assignments = state.assignments.filter((row) => !(
      row.type === "goithau"
      && row.targetId === package02.id
      && row.empId === "employee-1"
    ));
    refreshPlanVersionDraftSession(session, state, version02.planId);
    const payload = buildPlanDraftFinalizePayload(model, session);

    assert.deepEqual(payload.goithau.map((row) => row.tenGoiThau), ["A", "B", "C"]);
    const assigneesByPackage = Object.fromEntries(payload.goithau.map((pkg) => [
      pkg.tenGoiThau,
      payload.assignments
        .filter((row) => row.type === "goithau" && row.targetId === pkg.id)
        .map((row) => row.empId)
        .sort(),
    ]));
    assert.deepEqual(assigneesByPackage, {
      A: ["employee-1"],
      B: ["employee-1", "employee-2"],
      C: ["employee-2"],
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("final payload contains every immutable version snapshot and stable idempotency key", async () => {
  const state = draftState();
  const model = {
    state,
    db: memoryDb(),
    normalizeRecordKeys: (row) => row,
    workspaceStorage: { getItem: () => "17" },
  };
  const session = createPlanVersionDraftSession(state, "plan-00", "2026-08-19T10:00:00Z");
  state.kehoach[0].isLatest = 0;
  state.goithau[0].isLatest = 0;
  state.kehoach.push({
    ...structuredClone(state.kehoach[0]), id: "plan-01", rootId: "plan-00",
    phienBan: "01", isLatest: 1,
  });
  state.goithau.push({
    ...structuredClone(state.goithau[0]), id: "package-01", rootId: "package-00",
    keHoachId: "plan-01", tenGoiThau: "B", isLatest: 1,
  });
  refreshPlanVersionDraftSession(session, state, "plan-01");

  const payload = buildPlanDraftFinalizePayload(model, session);
  assert.deepEqual(payload.versions.map((item) => item.version), [0, 1]);
  assert.deepEqual(payload.kehoach.map((row) => row.id), ["plan-00", "plan-01"]);
  assert.deepEqual(payload.goithau.map((row) => row.tenGoiThau), ["A", "B"]);
  assert.equal(payload.clientMutationId, session.finalizeMutationId);
  assert.equal(payload.baseSyncVersion, "17");

  await savePlanVersionDraftSession(model, session);
  await removePlanVersionDraftSession(model, session.draftId);
  assert.deepEqual(model.planVersionDraftSessions, []);
});

test("failed final save keeps the recoverable draft and successful retry clears it", async () => {
  const state = draftState();
  const db = memoryDb();
  const model = {
    state, db,
    normalizeRecordKeys: (row) => row,
    workspaceStorage: { values: new Map(), getItem: () => "0", setItem(key, value) { this.values.set(key, value); } },
  };
  const session = createPlanVersionDraftSession(state, "plan-00", "2026-08-19T10:00:00Z");
  await savePlanVersionDraftSession(model, session);

  await assert.rejects(
    finalizePlanVersionDraft({ model }, session, {
      send: async () => { throw new Error("network down"); },
    }),
    /network down/,
  );
  assert.equal(model.planVersionDraftSessions.length, 1);
  assert.equal(state.kehoach[0].rowVersion, undefined);
  const offlineReload = { state: draftState(), db };
  await hydratePlanVersionDraftSessions(offlineReload);
  assert.equal(offlineReload.planVersionDraftSessions.length, 1);
  assert.equal(offlineReload.planVersionDraftSessions[0].draftId, session.draftId);

  const response = await finalizePlanVersionDraft({ model }, session, {
    send: async () => ({
      status: "success", syncVersion: 21,
      rowVersions: [
        { table: "kehoach", id: "plan-00", rowVersion: 1 },
        { table: "goithau", id: "package-00", rowVersion: 1 },
      ],
    }),
  });
  assert.equal(response.syncVersion, 21);
  assert.equal(state.kehoach[0].rowVersion, 1);
  assert.equal(state.goithau[0].rowVersion, 1);
  assert.deepEqual(model.planVersionDraftSessions, []);
  assert.equal(model.workspaceStorage.values.get("bf_last_sync_version"), "21");
});

test("reload after server commit durably cleans the acknowledged draft without refinalizing", async () => {
  const state = draftState();
  const db = memoryDb();
  const model = { state, db };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const reloadedState = draftState();
  reloadedState.kehoach[0].rowVersion = 3;
  const reloaded = { state: reloadedState, db };

  await hydratePlanVersionDraftSessions(reloaded);
  assert.deepEqual(reloaded.planVersionDraftSessions, []);
  assert.deepEqual(db.values.get("plan_version_drafts_v1").sessions, []);
});

test("reapply cleanup revision check preserves a newer concurrent draft snapshot", async () => {
  const state = draftState();
  const db = memoryDb();
  const model = { state, db };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  model.state.kehoach[0].rowVersion = 4;
  const baseUpdate = db.update.bind(db);
  let updateCount = 0;
  db.update = (key, updater) => baseUpdate(key, (current) => {
    updateCount += 1;
    if (updateCount === 1) {
      const newer = structuredClone(current);
      newer.sessions[0].revision = session.revision + 1;
      newer.sessions[0].aggregate.kehoach[0].tenKeHoach = "concurrent newer";
      db.values.set(key, newer);
      return updater(newer);
    }
    return updater(current);
  });

  model.planVersionDraftSessions = [structuredClone(session)];
  await assert.rejects(reapplyPlanVersionDraftSessions(model), /stale/i);
  assert.equal(db.values.get("plan_version_drafts_v1").sessions[0].aggregate.kehoach[0].tenKeHoach, "concurrent newer");
});

test("final plan action sends the whole draft chain only to the finalize endpoint", async () => {
  const previousDocument = globalThis.document;
  const state = draftState();
  const db = memoryDb();
  const elements = new Map([
    ["breakdown-plan-id", { value: "plan-00" }],
    ["tbody-breakdown-dathuchien", { querySelectorAll: () => [] }],
    ["tbody-breakdown-khongapdung", { querySelectorAll: () => [] }],
    ["tbody-breakdown-chuadudieuKien", { querySelectorAll: () => [] }],
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  const requests = [];
  const model = {
    state, db,
    normalizeRecordKeys: (row) => row,
    getCurrentDateTimeString: () => "2026-08-19 10:00:00",
    workspaceStorage: { getItem: () => "0", setItem() {} },
  };
  const session = createPlanVersionDraftSession(state, "plan-00", "2026-08-19T10:00:00Z");
  await savePlanVersionDraftSession(model, session);
  const controller = {
    model,
    tempPlanAction: "create",
    tempPlanData: state.kehoach[0],
    backupKeHoachState: structuredClone(state.kehoach),
    backupGoiThauState: structuredClone(state.goithau),
    planBreakdownDraft: {
      active: true, action: "create", planId: "plan-00", snapshot: draftState(),
    },
    loadBreakdownPackageDetails: async () => {},
    updateBreakdownTotal() {},
    recalculatePlanTotal() {},
    finalizePlanDraft: async (payload) => {
      requests.push(["/api/plans/finalize-draft", payload]);
      return {
        status: "success", syncVersion: 1,
        rowVersions: [
          { table: "kehoach", id: "plan-00", rowVersion: 1 },
          { table: "goithau", id: "package-00", rowVersion: 1 },
        ],
      };
    },
    closeModal: async () => {},
    view: {
      renderKeHoachTable: async () => {}, renderGoiThauTable: async () => {},
      customAlert: async () => {},
    },
  };

  try {
    const result = await savePlanBreakdown.call(controller);
    assert.equal(result, undefined);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0][1].versions, [{ id: "plan-00", version: 0 }]);
    assert.deepEqual(requests[0][1].goithau.map((row) => row.id), ["package-00"]);
    assert.deepEqual(model.planVersionDraftSessions, []);
    assert.equal(state.kehoach[0].rowVersion, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("workspace_change_during_plan_draft_finalize_cannot_mutate_new_workspace", async () => {
  const response = deferred();
  const model = workspaceModel();
  const sessionA = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, sessionA);
  const stateB = draftState();
  stateB.kehoach[0].id = "plan-b";
  stateB.kehoach[0].rootId = "plan-b";
  stateB.goithau = [];
  stateB.assignments = [];
  const dbB = memoryDb();
  const storageB = { values: new Map(), getItem: () => null, setItem(key, value) { this.values.set(key, value); } };
  const draftB = { draftId: "draft-b", rootId: "plan-b", aggregate: { kehoach: stateB.kehoach } };
  const applied = [];
  model.applyCommittedRowVersions = async (rows) => applied.push(rows);

  const pending = finalizePlanVersionDraft({ model }, sessionA, {
    send: async () => response.promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  model.token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model.state = stateB;
  model.db = dbB;
  model.workspaceStorage = storageB;
  model.planVersionDraftSessions = [draftB];
  response.resolve({
    status: "success", syncVersion: 41,
    rowVersions: [{ table: "kehoach", id: "plan-00", rowVersion: 1 }],
  });

  const result = await pending;
  assert.equal(result.workspaceChanged, true);
  assert.deepEqual(applied, []);
  assert.equal(storageB.values.has("bf_last_sync_version"), false);
  assert.deepEqual(model.planVersionDraftSessions, [draftB]);
  assert.equal(stateB.kehoach[0].rowVersion, undefined);
});

test("same_org_new_epoch_rejects_late_plan_draft_finalize_response", async () => {
  const response = deferred();
  const model = workspaceModel();
  const session = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const pending = finalizePlanVersionDraft({ model }, session, {
    send: async () => response.promise,
  });
  await new Promise((resolve) => setImmediate(resolve));
  model.token = "user:org-a@2";
  model.state = { ...draftState(), kehoach: [{ id: "new-epoch-plan" }] };
  model.db = memoryDb();
  model.workspaceStorage = { getItem: () => null, setItem() { throw new Error("must not write"); } };
  model.planVersionDraftSessions = [{ draftId: "new-epoch-draft", aggregate: { kehoach: [] } }];
  response.resolve({ status: "success", syncVersion: 9, rowVersions: [] });

  const result = await pending;
  assert.equal(result.code, "WORKSPACE_CHANGED");
  assert.deepEqual(model.state.kehoach, [{ id: "new-epoch-plan" }]);
  assert.equal(model.planVersionDraftSessions[0].draftId, "new-epoch-draft");
});

test("workspace_change_after_server_commit_during_canonical_apply_returns_stale_without_mutating_b", async () => {
  const writeStarted = deferred();
  const releaseWrite = deferred();
  const dbA = memoryDb();
  dbA.stores = ["kehoach"];
  dbA.putRecord = async () => {
    writeStarted.resolve();
    await releaseWrite.promise;
  };
  const model = workspaceModel({ db: dbA });
  const stateA = model.state;
  const storageA = model.workspaceStorage;
  const session = createPlanVersionDraftSession(stateA, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const pending = finalizePlanVersionDraft({ model }, session, {
    send: async () => ({
      status: "success",
      syncVersion: 22,
      rowVersions: [{ table: "kehoach", id: "plan-00", rowVersion: 1 }],
    }),
  });
  await writeStarted.promise;
  const stateB = { ...draftState(), kehoach: [{ id: "plan-b" }] };
  const draftB = { draftId: "draft-b", rootId: "plan-b", aggregate: { kehoach: [] } };
  model.token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model.state = stateB;
  model.db = memoryDb();
  model.workspaceStorage = { getItem: () => null, setItem() { throw new Error("must not write B"); } };
  model.planVersionDraftSessions = [draftB];
  releaseWrite.resolve();

  const result = await pending;
  assert.equal(result.code, "WORKSPACE_CHANGED");
  assert.equal(stateA.kehoach[0].rowVersion, undefined);
  assert.deepEqual(stateB.kehoach, [{ id: "plan-b" }]);
  assert.deepEqual(model.planVersionDraftSessions, [draftB]);
  assert.equal(storageA.getItem("bf_last_sync_version"), null);
});

test("finalize response rebases captured workspace outbox row versions", async () => {
  const model = workspaceModel();
  const enqueued = [];
  model._getMutationOutbox = () => ({
    enqueue(command) {
      enqueued.push(structuredClone(command));
      return true;
    },
  });
  const session = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, session);

  await finalizePlanVersionDraft({ model }, session, {
    send: async () => ({
      status: "success",
      syncVersion: 24,
      rowVersions: [{ table: "kehoach", id: "plan-00", rowVersion: 7 }],
    }),
  });

  assert.deepEqual(enqueued, [{
    kind: "server-row-version",
    entries: [{ table: "kehoach", id: "plan-00", rowVersion: 7 }],
  }]);
});

test("workspace_change_before_plan_draft_cleanup_cannot_remove_new_workspace_session", async () => {
  const removeStarted = deferred();
  const releaseRemove = deferred();
  const dbA = memoryDb();
  const atomicUpdate = dbA.update.bind(dbA);
  let updateCount = 0;
  dbA.update = async (key, updater) => {
    updateCount += 1;
    if (updateCount === 3) {
      removeStarted.resolve();
      await releaseRemove.promise;
    }
    return atomicUpdate(key, updater);
  };
  const model = workspaceModel({ db: dbA });
  const session = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const pending = finalizePlanVersionDraft({ model }, session, {
    send: async () => ({ status: "success", syncVersion: 23, rowVersions: [] }),
  });
  await removeStarted.promise;
  const draftB = { draftId: "draft-b", rootId: "plan-b", aggregate: { kehoach: [] } };
  model.token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model.state = { kehoach: [{ id: "plan-b" }] };
  model.db = memoryDb();
  model.workspaceStorage = { getItem: () => null, setItem() {} };
  model.planVersionDraftSessions = [draftB];
  releaseRemove.resolve();

  const result = await pending;
  assert.equal(result.code, "WORKSPACE_CHANGED");
  assert.deepEqual(model.planVersionDraftSessions, [draftB]);
});

test("workspace_b_does_not_reuse_workspace_a_finalize_promise_or_session", async () => {
  const responseA = deferred();
  const model = workspaceModel();
  const sessionA = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, sessionA);
  const finalizeA = finalizePlanVersionDraft({ model }, sessionA, {
    send: async () => responseA.promise,
  });
  await new Promise((resolve) => setImmediate(resolve));

  const stateB = draftState();
  stateB.kehoach[0].id = "plan-b";
  stateB.kehoach[0].rootId = "plan-b";
  stateB.goithau[0].keHoachId = "plan-b";
  stateB.assignments.find((row) => row.type === "kehoach").targetId = "plan-b";
  const dbB = memoryDb();
  model.token = "user:org-b@2";
  model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
  model.state = stateB;
  model.db = dbB;
  model.workspaceStorage = { getItem: () => "0", setItem() {} };
  model.planVersionDraftSessions = [];
  const sessionB = createPlanVersionDraftSession(stateB, "plan-b");
  await savePlanVersionDraftSession(model, sessionB);
  const finalizeB = finalizePlanVersionDraft({ model }, sessionB, {
    send: async () => ({ status: "success", syncVersion: 2, rowVersions: [] }),
  });
  responseA.resolve({ status: "success", syncVersion: 1, rowVersions: [] });

  const [resultA, resultB] = await Promise.all([finalizeA, finalizeB]);
  assert.equal(resultA.code, "WORKSPACE_CHANGED");
  assert.equal(resultB.status, "success");
  assert.deepEqual(model.planVersionDraftSessions, []);
  assert.deepEqual(dbB.values.get("plan_version_drafts_v1").sessions, []);
});

test("late_finalize_success_from_a_cannot_close_show_success_pull_or_clear_workspace_b_edit_state", async () => {
  const previousDocument = globalThis.document;
  const response = deferred();
  const model = workspaceModel();
  const sessionA = createPlanVersionDraftSession(model.state, "plan-00");
  await savePlanVersionDraftSession(model, sessionA);
  const elements = new Map([
    ["breakdown-plan-id", { value: "plan-00" }],
    ["tbody-breakdown-dathuchien", { querySelectorAll: () => [] }],
    ["tbody-breakdown-khongapdung", { querySelectorAll: () => [] }],
    ["tbody-breakdown-chuadudieuKien", { querySelectorAll: () => [] }],
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  const effects = { alerts: 0, closes: 0, pulls: 0, renders: 0 };
  const controller = {
    model,
    tempPlanAction: "create",
    tempPlanData: model.state.kehoach[0],
    backupKeHoachState: structuredClone(model.state.kehoach),
    backupGoiThauState: structuredClone(model.state.goithau),
    planBreakdownDraft: {
      active: true, action: "create", planId: "plan-00", snapshot: draftState(),
    },
    loadBreakdownPackageDetails: async () => {},
    updateBreakdownTotal() {},
    recalculatePlanTotal() {},
    finalizePlanDraft: async () => response.promise,
    forceSyncData: async () => { effects.pulls += 1; return { ok: true }; },
    closeModal: async () => { effects.closes += 1; },
    view: {
      renderKeHoachTable: async () => { effects.renders += 1; },
      renderGoiThauTable: async () => { effects.renders += 1; },
      customAlert: async () => { effects.alerts += 1; },
    },
  };

  try {
    const pending = savePlanBreakdown.call(controller);
    await new Promise((resolve) => setImmediate(resolve));
    const stateB = draftState();
    stateB.kehoach[0] = { id: "plan-b", rootId: "plan-b", phienBan: "00" };
    stateB.goithau = [];
    stateB.assignments = [];
    model.token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b", organizationId: "org-b" };
    model.state = stateB;
    model.db = memoryDb();
    model.workspaceStorage = { getItem: () => "70", setItem() {} };
    model.planVersionDraftSessions = [{ draftId: "draft-b", rootId: "plan-b", aggregate: { kehoach: [] } }];
    controller.tempPlanAction = "edit-b";
    controller.tempPlanData = { id: "plan-b" };
    controller.planBreakdownDraft = { active: true, action: "edit", planId: "plan-b", snapshot: {} };
    response.resolve({ status: "success", syncVersion: 11, rowVersions: [] });

    const result = await pending;
    assert.equal(result.code, "WORKSPACE_CHANGED");
    assert.deepEqual(effects, { alerts: 0, closes: 0, pulls: 0, renders: 0 });
    assert.equal(controller.tempPlanAction, "edit-b");
    assert.deepEqual(controller.tempPlanData, { id: "plan-b" });
    assert.equal(controller.planBreakdownDraft.planId, "plan-b");
    assert.equal(model.planVersionDraftSessions[0].draftId, "draft-b");
  } finally {
    response.resolve({ status: "success", rowVersions: [] });
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("intermediate_version_storage_failure_rolls_back_all_in_memory_changes", async () => {
  const previousDocument = globalThis.document;
  const state = draftState();
  state.selectedPlanVersion = { "plan-00": "plan-00" };
  state.selectedPackageVersion = { "package-00": "package-00" };
  state.selectedPackageVersionIntent = { "package-00": "latest" };
  const db = memoryDb();
  const model = workspaceModel({ state, db });
  model.getCurrentDateTimeString = () => "2026-08-19 10:00:00";
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const durableUpdate = db.update.bind(db);
  db.update = async () => { throw new Error("quota exceeded"); };
  const before = structuredClone({
    state,
    sessions: model.planVersionDraftSessions,
  });
  const elements = new Map([
    ["breakdown-plan-id", { value: "plan-00" }],
    ["tbody-breakdown-dathuchien", { querySelectorAll: () => [] }],
    ["tbody-breakdown-khongapdung", { querySelectorAll: () => [] }],
    ["tbody-breakdown-chuadudieuKien", { querySelectorAll: () => [] }],
  ]);
  globalThis.document = { getElementById: (id) => elements.get(id) || null };
  const controller = {
    model,
    planBreakdownDraft: { active: true, action: "create", planId: "plan-00" },
    tempPlanAction: "create",
    tempPlanData: { id: "plan-00" },
    loadBreakdownPackageDetails: async () => {},
    openPlanBreakdownModal: async () => { throw new Error("must not open"); },
    view: { renderKeHoachTable() {}, renderGoiThauTable() {} },
  };

  try {
    await assert.rejects(saveIntermediatePlanVersion.call(controller), /quota exceeded/);
    assert.deepEqual(state, before.state);
    assert.deepEqual(model.planVersionDraftSessions, before.sessions);
    assert.equal(controller.planBreakdownDraft.planId, "plan-00");
    assert.deepEqual(controller.tempPlanData, { id: "plan-00" });
    let opened = 0;
    db.update = durableUpdate;
    controller.openPlanBreakdownModal = async () => { opened += 1; };
    const retry = await saveIntermediatePlanVersion.call(controller);
    assert.equal(retry.ok, true);
    assert.equal(state.kehoach.filter((row) => row.phienBan === "01").length, 1);
    assert.equal(opened, 1);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("initial_plan_draft_storage_failure_does_not_leave_ephemeral_plan", async () => {
  const previousDocument = globalThis.document;
  const state = {
    chudautu: [], chuyengia: [], nhathau: [], kehoach: [], goithau: [],
    goithauhanghoa: [], thongtinmothau: [], hanghoaduthaunhathau: [], assignments: [],
    selectedPlanVersion: {}, selectedPackageVersion: {}, selectedPackageVersionIntent: {},
  };
  const db = memoryDb();
  db.update = async () => { throw new Error("indexeddb unavailable"); };
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: "",
        dataset: {},
        getAttribute: () => "",
        closest: () => null,
      });
    }
    return elements.get(id);
  };
  element("kh-loaihinh").value = "Dự toán mua sắm";
  element("kh-pheduyet").value = "Kế hoạch";
  globalThis.document = { getElementById: element };
  const effects = { closed: 0, opened: 0 };
  const controller = {
    model: {
      state, db,
      getCurrentDateTimeString: () => "2026-08-19 10:00:00",
      convertDMYHMSToYMDHMS: (value) => value,
      convertDMYToYMD: (value) => value,
      parseVND: () => 0,
    },
    tempPlanData: null,
    tempPlanAction: null,
    planBreakdownDraft: null,
    backupKeHoachState: null,
    backupGoiThauState: null,
    view: {
      validateForm: () => true,
      closeModal: () => { effects.closed += 1; },
      renderKeHoachTable: () => {},
      renderGoiThauTable: () => {},
    },
    openPlanBreakdownModal: async () => { effects.opened += 1; },
  };

  try {
    await assert.rejects(
      handleKeHoachSubmit.call(controller, { preventDefault() {} }),
      /indexeddb unavailable/,
    );
    assert.deepEqual(state.kehoach, []);
    assert.deepEqual(controller.model.planVersionDraftSessions, []);
    assert.equal(controller.tempPlanData, null);
    assert.equal(controller.tempPlanAction, null);
    assert.equal(controller.planBreakdownDraft, null);
    assert.deepEqual(effects, { closed: 0, opened: 0 });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("draft save without a durable database fails and does not publish memory state", async () => {
  const state = draftState();
  const model = { state, db: null, planVersionDraftSessions: [] };
  const session = createPlanVersionDraftSession(state, "plan-00");

  await assert.rejects(savePlanVersionDraftSession(model, session), /durable|lưu bền vững/i);
  assert.deepEqual(model.planVersionDraftSessions, []);
});

test("draft removal storage failure retains the recoverable in-memory session", async () => {
  const state = draftState();
  const db = memoryDb();
  const model = { state, db };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  const before = structuredClone(model.planVersionDraftSessions);
  db.update = async () => { throw new Error("remove durability failed"); };

  await assert.rejects(
    removePlanVersionDraftSession(model, session.draftId),
    /remove durability failed/,
  );
  assert.deepEqual(model.planVersionDraftSessions, before);
});

test("authoritative shared references are not overwritten by draft reapply", async () => {
  const state = draftState();
  state.chudautu[0].rowVersion = 2;
  state.chuyengia[0].rowVersion = 2;
  state.nhathau = [{ id: "contractor-1", tenNhaThau: "Old", rowVersion: 2 }];
  state.thongtinmothau = [{ id: "opening-1", goiThauId: "package-00", nhaThauId: "contractor-1" }];
  const model = { state, db: memoryDb() };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  model.state.chudautu[0] = { id: "investor-1", tenChuDauTu: "Server investor", rowVersion: 3 };
  model.state.chuyengia[0] = { id: "expert-1", hoTen: "Server expert", rowVersion: 3 };
  model.state.nhathau[0] = { id: "contractor-1", tenNhaThau: "Server contractor", rowVersion: 3 };

  await hydratePlanVersionDraftSessions(model);
  assert.equal(model.state.chudautu[0].tenChuDauTu, "Server investor");
  assert.equal(model.state.chuyengia[0].hoTen, "Server expert");
  assert.equal(model.state.nhathau[0].tenNhaThau, "Server contractor");
});

test("authoritative removal of a clean shared reference is not resurrected by draft reapply", async () => {
  const state = draftState();
  state.chuyengia[0].rowVersion = 5;
  const model = { state, db: memoryDb() };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  model.state.chuyengia = model.state.chuyengia.filter((row) => row.id !== "expert-1");

  await hydratePlanVersionDraftSessions(model);
  assert.equal(model.state.chuyengia.some((row) => row.id === "expert-1"), false);
});

test("new local shared reference is reapplied and clean server reference is omitted from final payload", async () => {
  const state = draftState();
  state.chudautu[0].rowVersion = 4;
  state.chuyengia[0].rowVersion = 4;
  state.chuyengia.push({ id: "expert-local", hoTen: "Local expert" });
  state.goithau[0].toChuyenGia.push({ chuyenGiaId: "expert-local" });
  const model = { state, db: memoryDb(), normalizeRecordKeys: (row) => row };
  const session = createPlanVersionDraftSession(state, "plan-00");
  await savePlanVersionDraftSession(model, session);
  model.state.chuyengia = [];
  await hydratePlanVersionDraftSessions(model);
  assert.equal(model.state.chuyengia.some((row) => row.id === "expert-local"), true);
  const payload = buildPlanDraftFinalizePayload(model, session);
  assert.deepEqual(payload.chudautu, []);
  assert.deepEqual(payload.chuyengia.map((row) => row.id), ["expert-local"]);
});

test("explicitly dirty shared reference preserves expected row version", () => {
  const state = draftState();
  state.chuyengia[0].rowVersion = 8;
  const model = { state, normalizeRecordKeys: (row) => row };
  const session = createPlanVersionDraftSession(state, "plan-00");
  session.dirtyRelatedRecords.chuyengia = ["expert-1"];

  const payload = buildPlanDraftFinalizePayload(model, session);
  assert.equal(payload.chuyengia.length, 1);
  assert.equal(payload.chuyengia[0].id, "expert-1");
  assert.equal(payload.chuyengia[0].expectedVersion, 8);
});

test("concurrent tabs preserve distinct drafts and reject stale same-draft writes", async () => {
  const db = memoryDb();
  const modelA = { state: draftState(), db };
  const stateB = draftState();
  stateB.kehoach[0].id = "plan-other";
  stateB.kehoach[0].rootId = "plan-other";
  stateB.goithau = [];
  stateB.assignments = [];
  const modelB = { state: stateB, db };
  const draftA = createPlanVersionDraftSession(modelA.state, "plan-00");
  const draftB = createPlanVersionDraftSession(modelB.state, "plan-other");
  await Promise.all([
    savePlanVersionDraftSession(modelA, draftA),
    savePlanVersionDraftSession(modelB, draftB),
  ]);
  const envelope = db.values.get("plan_version_drafts_v1");
  assert.deepEqual(envelope.sessions.map((row) => row.draftId).sort(), [draftA.draftId, draftB.draftId].sort());

  const stale = structuredClone(draftA);
  draftA.aggregate.kehoach[0].tenKeHoach = "Newer";
  await savePlanVersionDraftSession(modelA, draftA);
  stale.aggregate.kehoach[0].tenKeHoach = "Stale";
  await assert.rejects(savePlanVersionDraftSession(modelB, stale), /stale/i);
  assert.equal(
    db.values.get("plan_version_drafts_v1").sessions
      .find((row) => row.draftId === draftA.draftId).aggregate.kehoach[0].tenKeHoach,
    "Newer",
  );
});

test("concurrent same-draft save has one deterministic winner", async () => {
  const db = memoryDb();
  const modelA = { state: draftState(), db };
  const modelB = { state: draftState(), db };
  const session = createPlanVersionDraftSession(modelA.state, "plan-00");
  await savePlanVersionDraftSession(modelA, session);
  const editA = structuredClone(session);
  const editB = structuredClone(session);
  editA.aggregate.kehoach[0].tenKeHoach = "Tab A";
  editB.aggregate.kehoach[0].tenKeHoach = "Tab B";

  const results = await Promise.allSettled([
    savePlanVersionDraftSession(modelA, editA),
    savePlanVersionDraftSession(modelB, editB),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.match(results.find((result) => result.status === "rejected").reason.message, /stale/i);
  assert.equal(
    db.values.get("plan_version_drafts_v1").sessions[0].aggregate.kehoach[0].tenKeHoach,
    "Tab A",
  );
});

test("concurrent remove and stale save cannot resurrect a draft after reload", async () => {
  const db = memoryDb();
  const modelA = { state: draftState(), db };
  const modelB = { state: draftState(), db };
  const session = createPlanVersionDraftSession(modelA.state, "plan-00");
  await savePlanVersionDraftSession(modelA, session);
  const stale = structuredClone(session);

  const [removed, saved] = await Promise.allSettled([
    removePlanVersionDraftSession(modelA, session.draftId),
    savePlanVersionDraftSession(modelB, stale),
  ]);
  assert.equal(removed.status, "fulfilled");
  assert.equal(saved.status, "rejected");
  assert.match(saved.reason.message, /stale/i);
  const reloaded = { state: draftState(), db };
  await hydratePlanVersionDraftSessions(reloaded);
  assert.deepEqual(reloaded.planVersionDraftSessions, []);
});

test("stale same-draft remove cannot delete a newer tab snapshot", async () => {
  const db = memoryDb();
  const modelA = { state: draftState(), db };
  const modelB = { state: draftState(), db };
  const session = createPlanVersionDraftSession(modelA.state, "plan-00");
  await savePlanVersionDraftSession(modelA, session);
  const staleRevision = session.revision;
  const newer = structuredClone(session);
  newer.aggregate.kehoach[0].tenKeHoach = "newer tab";
  await savePlanVersionDraftSession(modelB, newer);

  await assert.rejects(
    removePlanVersionDraftSession(modelA, session.draftId, { expectedRevision: staleRevision }),
    /stale/i,
  );
  assert.equal(
    db.values.get("plan_version_drafts_v1").sessions[0].aggregate.kehoach[0].tenKeHoach,
    "newer tab",
  );
});

test("strict frontend validation rejects malformed versions and unknown assignment types", () => {
  for (const invalidVersion of ["abc", -1, null]) {
    const state = draftState();
    state.kehoach[0].phienBan = invalidVersion;
    assert.throws(
      () => createPlanVersionDraftSession(state, "plan-00"),
      /phiên bản/i,
    );
  }
  const state = draftState();
  const session = createPlanVersionDraftSession(state, "plan-00");
  session.aggregate.assignments[0].type = "unknown";
  assert.throws(() => validatePlanVersionDraftSession(session), /phân công/i);
  const chained = draftState();
  chained.kehoach.push({ ...structuredClone(chained.kehoach[0]), id: "plan-01", phienBan: "abc" });
  assert.throws(() => createPlanVersionDraftSession(chained, "plan-00"), /phiên bản/i);
});

test("draft capture ignores unrelated assignment types even when target IDs collide", () => {
  const state = draftState();
  state.assignments.push({
    id: "unrelated-assignment",
    type: "other-module",
    targetId: "plan-00",
  });

  const session = createPlanVersionDraftSession(state, "plan-00");

  assert.deepEqual(
    session.aggregate.assignments.map((assignment) => assignment.id),
    ["plan-assignment-00", "package-assignment-00"],
  );
});

test("frontend rejects persisted or malformed plan and package row versions", () => {
  for (const [table, invalid] of [
    ["kehoach", "abc"],
    ["kehoach", -1],
    ["goithau", "abc"],
    ["goithau", 2],
  ]) {
    const state = draftState();
    const session = createPlanVersionDraftSession(state, "plan-00");
    session.aggregate[table][0].rowVersion = invalid;
    assert.throws(() => validatePlanVersionDraftSession(session), /bản nháp|gói thầu/i);
  }
});

test("frontend rejects malformed child and shared reference row versions", () => {
  for (const [table, invalid] of [
    ["goithauhanghoa", "abc"],
    ["chuyengia", -1],
  ]) {
    const state = draftState();
    const session = createPlanVersionDraftSession(state, "plan-00");
    session.aggregate[table][0].rowVersion = invalid;
    assert.throws(() => validatePlanVersionDraftSession(session), /phiên bản bản ghi/i);
  }
});
