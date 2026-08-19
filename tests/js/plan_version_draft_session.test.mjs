import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlanDraftFinalizePayload,
  createPlanVersionDraftSession,
  finalizePlanVersionDraft,
  hydratePlanVersionDraftSessions,
  refreshPlanVersionDraftSession,
  removePlanVersionDraftSession,
  savePlanVersionDraftSession,
} from "../../frontend/plans/PlanVersionDraftSession.js";
import {
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
  return {
    values,
    async get(key) { return structuredClone(values.get(key)); },
    async set(key, value) { values.set(key, structuredClone(value)); },
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
