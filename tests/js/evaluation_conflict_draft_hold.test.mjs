import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { autoSync } from "../../frontend/app/SyncPushService.js";
import { fetchRecordByLookup } from "../../frontend/app/SyncPullService.js";
import { retainedConflictRecord } from "../../frontend/shared/conflictProjection.js";
import { invalidateServerCapabilities } from "../../frontend/auth/serverCapabilities.js";
import { executeDetailedEvaluationSave } from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";
import { detailedEvaluationAutosaveFor } from "../../frontend/packages/DetailedEvaluationDraftAutosave.js";
import { resolveDetailedEvaluationState } from "../../frontend/packages/DetailedEvaluationState.js";

const originalGlobals = new Map(["fetch", "document", "window", "history", "requestAnimationFrame", "sessionStorage"]
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => {
  invalidateServerCapabilities();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

async function actualModelFixture() {
  const f = fixture();
  const values = new Map([["bf_last_sync_version", "17"], ["bf_active_org", "org-a"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    readJson(key, fallback) { return JSON.parse(values.get(key) ?? JSON.stringify(fallback)); },
    writeJson(key, value) { values.set(key, JSON.stringify(value)); },
  };
  const tables = new Map();
  const kv = new Map();
  const table = (key) => {
    if (!tables.has(key)) tables.set(key, new Map());
    return tables.get(key);
  };
  const db = {
    stores: ["goithau", "thongtinmothau", "hanghoaduthaunhathau"],
    get: async (key) => structuredClone(kv.get(key) ?? null),
    set: async (key, value) => { kv.set(key, structuredClone(value)); },
    update: async (key, updater) => {
      const next = updater(structuredClone(kv.get(key) ?? null));
      kv.set(key, structuredClone(next));
      return structuredClone(next);
    },
    getTableData: async (key) => structuredClone([...table(key).values()]),
    putRecord: async (key, row) => { table(key).set(String(row.id), structuredClone(row)); },
    async putRecords(key, rows) { for (const row of rows) await this.putRecord(key, row); },
    putTableData: async (key, rows) => { tables.set(key, new Map(rows.map((row) => [String(row.id), structuredClone(row)]))); },
    deleteRecord: async (key, id) => { table(key).delete(String(id)); },
    async applySyncChanges({ replacements = {}, upserts = {}, deletions = {} }) {
      for (const [key, rows] of Object.entries(replacements)) await this.putTableData(key, rows);
      for (const [key, rows] of Object.entries(upserts)) await this.putRecords(key, rows);
      for (const [key, ids] of Object.entries(deletions)) for (const id of ids) await this.deleteRecord(key, id);
    },
  };
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a", userId: "user", organizationId: "org-a" };
  model.workspaceStorage = storage;
  model.db = db;
  model._workspaceEpoch = 1;
  model.state.activerole = "manager";
  model.state.goithau = [{ ...f.state.pkg, rowVersion: 4 }];
  model.state.thongtinmothau = [{ ...f.state.bid, rowVersion: 4 }];
  model.state.hanghoaduthaunhathau = [];
  await model.hydrateMutationOutbox();
  f.controller.model = model;
  f.controller.autoSync = autoSync;
  f.controller.updateSyncState = () => {};
  f.controller.renderDetailedEvaluation = async () => {};
  f.state.pkg = model.state.goithau[0];
  f.state.bid = model.state.thongtinmothau[0];
  f.controller._detailedEvaluationAutosave = null;
  f.autosave = detailedEvaluationAutosaveFor(f.controller);
  f.autosave.save(f.state.draftKey, f.state.report);
  globalThis.document = { cookie: "csrf_token=test", getElementById: () => null, querySelector: () => null,
    querySelectorAll: () => [], documentElement: { dataset: {} } };
  globalThis.window = { location: { pathname: "/dashboard", search: "", hash: "" } };
  globalThis.history = { replaceState() {} };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  globalThis.sessionStorage = storage;
  return { ...f, storage, db, model };
}

test("real detailed default stages exact outbox and waits for the server ACK before success", async () => {
  const f = await actualModelFixture();
  const posts = [];
  let acknowledge;
  const ack = new Promise((resolve) => { acknowledge = resolve; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/sync");
    posts.push(JSON.parse(options.body));
    await ack;
    return Response.json({ status: "success", syncVersion: 18 });
  };
  f.model.state.goithau.push({ id: "unrelated-package", rowVersion: 7 });
  f.model.state.thongtinmothau.push({ id: "unrelated-bid", goiThauId: "other", rowVersion: 8 });
  const pending = executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(posts.length, 1);
  assert.equal(f.controller._detailedEvaluationDirty, true);
  assert.equal(f.alerts.some(([title]) => title === "Lưu thành công"), false);
  assert.deepEqual(posts[0].goithau.map((row) => row.id), ["pkg"]);
  assert.deepEqual(posts[0].thongtinmothau.map((row) => row.id), ["bid"]);
  assert.equal(posts[0].thongtinmothau[0].expectedVersion, 4);
  acknowledge();
  assert.equal(await pending, true);
  assert.equal(f.model.buildMutationSyncPayload(), null);
  assert.equal(f.controller._detailedEvaluationDirty, false);
  assert.equal(f.alerts.at(-1)[0], "Lưu thành công");
});

test("real detailed conflict keeps original expectedVersion through authority and never reloads rejected input", async () => {
  const f = await actualModelFixture();
  const posts = [];
  f.controller.awaitAuthoritativeMutationBoundary = async () => {
    f.model.state.goithau = [{ ...f.state.pkg, rowVersion: 8, serverOnly: "Fresh package field" }];
    f.model.state.thongtinmothau = [{ ...f.state.bid, rowVersion: 9, serverOnly: "Fresh bid field",
      baoCaoDanhGiaChiTietList: [{ ...f.state.bid.baoCaoDanhGiaChiTietList[0], ketLuan: "Another user's report" }] }];
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/sync");
    posts.push(JSON.parse(options.body));
    return Response.json({ status: "conflict", currentSyncVersion: 18,
      errors: [{ code: "ROW_VERSION_CONFLICT", table: "thong_tin_mo_thau", id: "bid", expectedVersion: 4, actualVersion: 9 }] }, { status: 409 });
  };
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity" }), false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].goithau[0].expectedVersion, 4);
  assert.equal(posts[0].thongtinmothau[0].expectedVersion, 4);
  assert.equal(f.model.getMutationQueue().baseSnapshots?.thongtinmothau?.bid, undefined);
  assert.equal(f.autosave.restore(f.state.draftKey).report.ketLuan, "Local input");
  assert.equal(f.autosave.restore(f.state.draftKey).sessionOnly, true);
  const freshController = { model: { workspaceStorage: f.storage } };
  assert.equal(detailedEvaluationAutosaveFor(freshController).restore(f.state.draftKey), null);
  assert.equal(f.controller._detailedEvaluationDirty, true);
  assert.equal(f.alerts.some(([title]) => title === "Lưu thành công"), false);
  assert.equal(f.model.getMutationQueue().upserts?.thongtinmothau?.bid, undefined);
});

test("real detailed completion conflict restores official scalars in retained projection until canonical F5 read", async () => {
  const f = await actualModelFixture();
  const criterion = { id: "criterion", stt: "1", name: "Criterion", group: "validity", required: true, resultType: "pass_fail" };
  f.state.criteria = [criterion];
  f.state.baseCriteria = [criterion];
  f.state.report = { ...f.state.report, trangThai: "draft", hoanThanhLuc: null,
    extension: { completedGroups: [], groupResults: {} },
    chiTietList: [{ id: "row", tieuChiDanhGiaId: criterion.id, ketQua: "pass", nhanXet: "Entered input" }] };
  f.state.bid.danhGiaHopLe = "Prior official conclusion";
  const canonical = structuredClone(f.state.bid);
  canonical.rowVersion = 5;
  f.controller.fetchRecordByLookup = fetchRecordByLookup;
  let posts = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/sync") {
      posts += 1;
      return Response.json({ status: "conflict", currentSyncVersion: 18,
        errors: [{ code: "ROW_VERSION_CONFLICT", table: "thong_tin_mo_thau", id: "bid", expectedVersion: 4, actualVersion: 5 }] }, { status: 409 });
    }
    assert.equal(String(url).startsWith("/api/record?"), true);
    assert.notEqual(options.method, "POST");
    return Response.json({ item: canonical });
  };
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity", completeReport: true }), false);
  const retained = retainedConflictRecord(f.model, "thongtinmothau", "bid");
  assert.equal(retained.danhGiaHopLe, "Prior official conclusion");
  assert.equal(Object.hasOwn(retained, "diemDanhGia"), false);
  assert.equal(Object.hasOwn(retained, "danhGiaKetLuan"), false);
  assert.equal(retained.baoCaoDanhGiaChiTietList[0].trangThai, "draft");
  assert.equal(retained.baoCaoDanhGiaChiTietList[0].hoanThanhLuc, null);
  assert.deepEqual(retained.baoCaoDanhGiaChiTietList[0].extension.completedGroups, []);
  assert.equal(retained.baoCaoDanhGiaChiTietList[0].chiTietList[0].nhanXet, "Entered input");
  const visible = await f.controller.fetchRecordByLookup("thongtinmothau", "bid", { requireCanonicalOutcome: true });
  assert.equal(visible.baoCaoDanhGiaChiTietList[0].chiTietList[0].nhanXet, "Entered input");
  const freshModel = new BiddingModel();
  freshModel.workspaceScope = f.model.workspaceScope;
  freshModel.workspaceStorage = f.storage;
  freshModel.db = f.db;
  freshModel._workspaceEpoch = 1;
  await freshModel.hydrateMutationOutbox();
  const fresh = await fetchRecordByLookup.call({ model: freshModel }, "thongtinmothau", "bid", { requireCanonicalOutcome: true });
  assert.equal(fresh.baoCaoDanhGiaChiTietList[0].id, "canonical");
  assert.equal(detailedEvaluationAutosaveFor({ model: freshModel }).restore(f.state.draftKey), null);
  assert.equal(posts, 1);
  assert.equal(f.alerts.some(([title]) => title === "Lưu thành công"), false);
});

function fixture() {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const canonical = { id: "canonical", loaiVong: "single", trangThai: "draft", chiTietList: [], extension: {} };
  const entered = { ...canonical, id: "entered", ketLuan: "Local input" };
  const pkg = { id: "pkg", phanLo: "Không", phuongThucLuaChon: "Một giai đoạn một túi hồ sơ", trangThai: "Đang chấm thầu", danhGiaHsdtMetadata: { criteria: [] } };
  const bid = { id: "bid", goiThauId: "pkg", baoCaoDanhGiaChiTietList: [canonical] };
  const alerts = [];
  const freshController = () => ({
    currentDanhGiaTab: "unified", selectedEvaluationBidId: "bid", selectedDetailedEvaluationTab: "validity",
    model: { workspaceStorage: storage, state: { goithau: [structuredClone(pkg)], thongtinmothau: [structuredClone(bid)], hanghoaduthaunhathau: [], activeuser: { id: "user" } }, hasPermission: () => true },
    view: { _editingState: {}, getActiveElement: (id) => id === "danhgiahsdt-goithau-select" ? { value: "pkg" } : null, customAlert: async (...args) => { alerts.push(args); } },
  });
  const controller = freshController();
  controller._detailedEvaluationDrafts = new Map([["pkg:bid:single", entered]]);
  controller._detailedEvaluationCriteriaOverrides = new Map();
  controller._detailedEvaluationDirty = true;
  controller._editingDetailedEvaluationKey = "pkg:bid:single";
  const state = {
    pkg: controller.model.state.goithau[0], bid: controller.model.state.thongtinmothau[0], report: entered,
    draftKey: "pkg:bid:single", criteriaKey: "pkg:single", roundType: "single", criteria: [], baseCriteria: [],
    context: { visibleGroups: ["validity"], editableGroups: ["validity"], configuredGroups: ["validity"] },
  };
  const autosave = detailedEvaluationAutosaveFor(controller);
  autosave.save(state.draftKey, entered);
  autosave.save("pkg:unrelated:single", { ...entered, id: "unrelated" });
  const callbacks = [];
  autosave.scheduleTimer = (callback) => { callbacks.push(callback); return callbacks.length; };
  autosave.cancelTimer = () => {};
  autosave.schedule(state.draftKey, () => ({ ...entered, id: "late rejected timer" }));
  return { controller, state, autosave, callbacks, freshController, alerts, storage };
}

for (const errorField of ["errors", "fields"]) {
  test(`actual detailed failed save suppresses only confirmed ${errorField} conflict draft after reload`, async () => {
    const f = fixture();
    const errors = [{ code: "ROW_VERSION_CONFLICT", table: "thong_tin_mo_thau", id: "bid" }];
    const data = errorField === "errors" ? { errors } : { fields: { errors } };
    assert.equal(await executeDetailedEvaluationSave({
      appController: f.controller, state: f.state, root: { querySelectorAll: () => [] }, activeGroup: "validity",
      commit: async () => ({ ok: false, status: 409, data }),
    }), false);
    f.callbacks[0]();
    const fresh = f.freshController();
    assert.equal(resolveDetailedEvaluationState(fresh).report.id, "canonical");
    assert.equal(detailedEvaluationAutosaveFor(fresh).restore(f.state.draftKey), null);
    assert.equal(detailedEvaluationAutosaveFor(fresh).restore("pkg:unrelated:single").report.id, "unrelated");
    assert.equal(f.autosave.restore(f.state.draftKey).sessionOnly, true);
    assert.equal(f.controller._detailedEvaluationDirty, true);
    assert.equal(f.controller._editingDetailedEvaluationKey, f.state.draftKey);
    assert.equal(f.alerts.some(([title]) => title === "Lưu thành công"), false);
  });
}

for (const result of [{ ok: false, transport: true }, { ok: false, status: 409, data: { code: "IDEMPOTENCY_KEY_REUSED" } }]) {
  test(`detailed non-confirmed failure keeps ordinary durable draft: ${JSON.stringify(result)}`, async () => {
    const f = fixture();
    assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
      root: { querySelectorAll: () => [] }, activeGroup: "validity", commit: async () => result }), false);
    assert.equal(resolveDetailedEvaluationState(f.freshController()).report.id, "entered");
  });
}

for (const completion of ["completeGroup", "completeReport"]) {
  test(`confirmed detailed ${completion} conflict retains input but does not complete report or navigate`, async () => {
    const f = fixture();
    f.state.bid.danhGiaHopLe = "Prior official conclusion";
    const criterion = { id: "criterion", stt: "1", name: "Criterion", group: "validity", required: true, resultType: "pass_fail" };
    f.state.criteria = [criterion];
    f.state.baseCriteria = [criterion];
    f.state.report = { ...f.state.report, hoanThanhLuc: null, extension: { completedGroups: [], groupResults: {} }, chiTietList: [{ id: "row", tieuChiDanhGiaId: criterion.id, ketQua: "pass", nhanXet: "Entered input" }] };
    f.controller._detailedEvaluationDrafts.set(f.state.draftKey, f.state.report);
    assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
      root: { querySelectorAll: () => [] }, activeGroup: "validity", [completion]: true,
      commit: async () => ({ ok: false, data: { errors: [{ code: "ROW_VERSION_CONFLICT", table: "thong_tin_mo_thau", id: "bid" }] } }) }), false);
    const retained = f.controller._detailedEvaluationDrafts.get(f.state.draftKey);
    assert.equal(retained.trangThai, "draft");
    assert.equal(retained.hoanThanhLuc, null);
    assert.deepEqual(retained.extension.completedGroups, []);
    assert.deepEqual(retained.extension.groupResults, {});
    assert.equal(retained.chiTietList[0].nhanXet, "Entered input");
    const projectedReport = f.state.bid.baoCaoDanhGiaChiTietList.find((report) => report.id === retained.id);
    assert.equal(projectedReport.trangThai, "draft");
    assert.equal(projectedReport.hoanThanhLuc, null);
    assert.deepEqual(projectedReport.extension.completedGroups, []);
    assert.equal(f.state.bid.danhGiaHopLe, "Prior official conclusion");
    assert.equal(Object.prototype.hasOwnProperty.call(f.state.bid, "diemDanhGia"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(f.state.bid, "danhGiaKetLuan"), false);
    assert.equal(f.controller._detailedEvaluationDirty, true);
    assert.equal(f.controller.selectedDetailedEvaluationTab, "validity");
    assert.equal(f.alerts.some(([title]) => title === "Lưu thành công"), false);
    assert.equal(resolveDetailedEvaluationState(f.freshController()).report.id, "canonical");
  });
}

test("detailed cleanup failure is reported as unsafe storage and keeps same-tab input", async () => {
  const f = fixture();
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity", commit: async () => {
      f.storage.setItem = () => { throw new Error("Storage cleanup denied"); };
      return { ok: false, data: { errors: [{ code: "ROW_VERSION_CONFLICT", id: "bid" }] } };
    } }), false);
  assert.equal(f.autosave.restore(f.state.draftKey).sessionOnly, true);
  assert.match(f.alerts.at(-1)[1], /giữ tab mở.*khôi phục bộ nhớ/i);
  assert.equal(f.autosave.durability, "degraded");
});

test("a late detailed conflict result cannot hold the same draft key in a replacement workspace", async () => {
  const f = fixture();
  let token = "org-a@1";
  f.controller.model.getWorkspaceToken = () => token;
  f.controller.model.isWorkspaceCurrent = (candidate) => token === candidate;
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity", commit: async () => {
      token = "org-b@2";
      return { ok: false, data: { errors: [{ code: "ROW_VERSION_CONFLICT", id: "bid" }] } };
    } }), false);
  assert.notEqual(f.autosave.restore(f.state.draftKey).sessionOnly, true);
  assert.equal(resolveDetailedEvaluationState(f.freshController()).report.id, "entered");
});

test("production detailed default save reaches explicit persistence and handles confirmed conflict", async () => {
  const f = fixture();
  const persisted = [];
  let requests = 0;
  f.controller.model.persistChanges = async (table, changes) => { persisted.push([table, structuredClone(changes)]); };
  f.controller.model.flushMutationOutbox = async () => {};
  f.controller.autoSync = async () => { requests += 1; return { ok: false, data: { errors: [{ code: "ROW_VERSION_CONFLICT", table: "thong_tin_mo_thau", id: "bid" }] } }; };
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity" }), false);
  assert.deepEqual(persisted.map(([table]) => table), ["goithau", "thongtinmothau"]);
  assert.equal(requests, 1);
  assert.equal(resolveDetailedEvaluationState(f.freshController()).report.id, "canonical");
});

test("production detailed default save commits exact changed records after authority without losing entered rows", async () => {
  const f = fixture();
  let releaseAuthority;
  const authority = new Promise((resolve) => { releaseAuthority = resolve; });
  const persisted = [];
  f.controller.awaitAuthoritativeMutationBoundary = () => authority;
  f.controller.model.persistChanges = async (table, changes) => { persisted.push([table, structuredClone(changes)]); };
  f.controller.model.flushMutationOutbox = async () => {};
  f.controller.autoSync = async () => ({ ok: true, status: 200, data: { syncVersion: 18 } });
  f.controller.renderDetailedEvaluation = async () => {};
  const criterion = { id: "criterion", stt: "1", name: "Criterion", group: "validity", resultType: "pass_fail" };
  f.state.criteria = [criterion];
  f.state.baseCriteria = [criterion];
  const input = { value: "Entered before authority" };
  const element = { getAttribute: () => criterion.id, querySelector: (selector) => selector === '[data-detailed-field="nhanXet"]' ? input : null };
  const pending = executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [element] }, activeGroup: "validity" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(persisted, []);
  input.value = "Server re-render changed controls";
  f.controller.model.state.goithau = [{ ...f.state.pkg, rowVersion: 8, serverOnly: "Fresh package field" }];
  f.controller.model.state.thongtinmothau = [{ ...f.state.bid, rowVersion: 9, serverOnly: "Fresh bidder field" }];
  releaseAuthority();
  assert.equal(await pending, true);
  const packageRow = persisted.find(([table]) => table === "goithau")[1].upserts[0];
  const bidRow = persisted.find(([table]) => table === "thongtinmothau")[1].upserts[0];
  assert.equal(packageRow.rowVersion, 8);
  assert.equal(packageRow.serverOnly, "Fresh package field");
  assert.equal(bidRow.rowVersion, 9);
  assert.equal(bidRow.serverOnly, "Fresh bidder field");
  assert.equal(bidRow.baoCaoDanhGiaChiTietList[0].chiTietList[0].nhanXet, "Entered before authority");
  assert.equal(f.controller._detailedEvaluationDirty, false);
  assert.equal(f.autosave.restore(f.state.draftKey), null);
  assert.equal(f.alerts.at(-1)[0], "Lưu thành công");
});

test("production detailed invalidation persists only this bidder's changed goods", async () => {
  const f = fixture();
  const persisted = [];
  f.state.context.configuredGroups = ["validity", "bidder_goods"];
  f.controller.model.state.hanghoaduthaunhathau = [{ id: "mine", thongTinMoThauId: "bid", trangThaiUuDai: "ready" }, { id: "other", thongTinMoThauId: "other-bid", trangThaiUuDai: "ready" }];
  f.controller.model.persistChanges = async (table, changes) => { persisted.push([table, structuredClone(changes)]); };
  f.controller.model.flushMutationOutbox = async () => {};
  f.controller.autoSync = async () => ({ ok: true });
  f.controller.renderDetailedEvaluation = async () => {};
  assert.equal(await executeDetailedEvaluationSave({ appController: f.controller, state: f.state,
    root: { querySelectorAll: () => [] }, activeGroup: "validity" }), true);
  assert.deepEqual(persisted.find(([table]) => table === "hanghoaduthaunhathau")[1].upserts,
    [{ id: "mine", thongTinMoThauId: "bid", trangThaiUuDai: "stale" }]);
  assert.equal(f.controller.model.state.hanghoaduthaunhathau.find((row) => row.id === "other").trangThaiUuDai, "ready");
});
