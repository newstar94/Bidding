import assert from "node:assert/strict";
import test from "node:test";
import { saveThongTinMoThau } from "../../frontend/packages/BidProcessWorkflow.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withOpeningSave(run, { lookupPending = true } = {}) {
  const original = { document: globalThis.document, fetch: globalThis.fetch, Element: globalThis.Element };
  const lookupStarted = deferred();
  const lookupReply = deferred();
  const syncStarted = deferred();
  const syncReply = deferred();
  const fields = new Map([
    [".mt-ma-nha-thau", { value: "vn0100000001" }],
    [".mt-ten-nha-thau", { value: "Nhà thầu nguồn A" }],
    [".mt-gia-du-thau", { value: "1250000" }],
    [".mt-gia-sau-giam-gia", { value: "1250000" }],
    [".mt-loai-nha-thau", { value: "Độc lập" }],
  ]);
  const row = {
    dataset: {}, isConnected: true,
    getAttribute: (name) => name === "data-id" ? "opening-a" : null,
    querySelector: (selector) => fields.get(selector) || null,
    classList: { add() {}, remove() {} },
  };
  const button = {
    dataset: {}, textContent: "Lưu thông tin mở thầu", disabled: false,
    setAttribute() {}, removeAttribute() {},
  };
  const select = { value: "package-a" };
  let bodyRows = [row];
  const body = { isConnected: true, querySelectorAll: () => [...bodyRows], contains: (item) => bodyRows.includes(item) };
  let formControls = { select, body, button };
  const pane = {
    classList: { contains: (name) => name === "active" },
    querySelector: (selector) => selector === "#mothau-goithau-select" ? formControls.select
      : selector === "#mothau-table-tbody" ? formControls.body
        : selector === "#btn-mothau-save" ? formControls.button : null,
    contains: (element) => [select, body, button, row].includes(element),
  };
  let activePane = pane;
  const pkg = { id: "package-a", rootId: "package-a", trangThai: "Đã mở thầu", rowVersion: 3,
    tenGoiThau: "Gói A", thoiGianDongThau: "2026-09-01T09:00:00", thoiGianMoThau: "2026-09-01T09:30:00" };
  const secondPkg = { ...pkg, id: "package-b", rootId: "package-b", tenGoiThau: "Gói B" };
  let workspace = "workspace-a@1";
  const state = { goithau: [pkg, secondPkg], thongtinmothau: [], nhathau: lookupPending ? [] : [{
    id: "contractor-a", rootId: "contractor-a", maNhaThau: "vn0100000001", tenNhaThau: "Nhà thầu nguồn A",
    nguoiDaiDien: "Người đại diện", isLatest: 1,
  }] };
  const staged = [], persisted = [], alerts = [], navigations = [], renders = [];
  const model = {
    state, workspaceStorage: {}, db: {}, getWorkspaceToken: () => workspace,
    isWorkspaceCurrent: (token) => token === workspace,
    getLatestPackage: (id) => model.state.goithau.find((record) => record.id === id),
    getLatestNhaThau: () => [...model.state.nhathau],
    parseVND: (value) => Number(String(value || "").replace(/[^0-9]/gu, "")),
    formatDateWithTime: (value) => value, getCurrentDateTimeString: () => pkg.thoiGianMoThau,
    replaceTableState(table, records) { this.state[table] = records; },
    commitLocalMutation(table, changes) { staged.push({ table, changes: structuredClone(changes) }); },
    async persistChanges(table, changes) { persisted.push({ table, changes: structuredClone(changes) }); },
    async flushMutationOutbox() {}, markDeleted() {},
  };
  const view = {
    _editingState: {}, _currentWorkflowPackageId: pkg.id, _currentWorkflowTab: "opening",
    async customAlert(...args) { alerts.push(args); }, renderGoiThauTable() { renders.push("list"); },
    async showPackageDetails(id) { navigations.push(id); },
  };
  const controller = { model, view,
    renderMoThauPanel() { renders.push("opening"); },
    async autoSync() { syncStarted.resolve(); return await syncReply.promise; },
  };
  globalThis.Element = class Element {};
  globalThis.document = {
    querySelector: (selector) => selector === ".tab-pane.active" ? activePane : null,
    getElementById: (id) => id === "tab-goithau-detail" ? activePane
      : pane.querySelector(`#${id}`),
  };
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("/api/lookup-tax-code")) {
      lookupStarted.resolve();
      await lookupReply.promise;
      return Response.json({ found: true, name: "Nhà thầu nguồn A", org_code: "vn0100000001", representative_name: "Người đại diện" });
    }
    return Response.json({ violationStatus: "NO_ACTIVE_VIOLATION" });
  };
  try {
    await run({ controller, model, view, pkg, secondPkg, staged, persisted, alerts, navigations, renders,
      lookupStarted, lookupReply, syncStarted, syncReply,
      switchPackage() {
        const secondSelect = { value: secondPkg.id };
        activePane = { ...pane, querySelector: (selector) => selector === "#mothau-goithau-select" ? secondSelect : null };
        view._currentWorkflowPackageId = secondPkg.id;
        view._currentWorkflowTab = "opening";
      },
      switchWorkspace() {
        workspace = "workspace-b@2";
        model.state = { goithau: [secondPkg], thongtinmothau: [], nhathau: [] };
        model.workspaceStorage = {}; model.db = {};
      },
      replaceSamePackageForm() {
        formControls = { select: { value: pkg.id }, body: { ...body }, button: { ...button } };
      },
      removeRowsFromSameBody() {
        bodyRows = []; row.isConnected = false;
      },
    });
  } finally {
    lookupReply.resolve(); syncReply.resolve({ ok: true });
    // The save starts a display-only risk refresh. Let its continuation settle
    // before removing the route/document owned by this fixture.
    await new Promise((done) => setImmediate(done));
    for (const [name, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
}

test("opening save cannot stage old rows into a workspace selected during contractor lookup", async () => {
  await withOpeningSave(async (fixture) => {
    const saving = saveThongTinMoThau.call(fixture.controller);
    await fixture.lookupStarted.promise;
    fixture.switchWorkspace();
    const expectedState = structuredClone(fixture.model.state);
    fixture.syncReply.resolve({ ok: true }); fixture.lookupReply.resolve();
    await saving;
    assert.deepEqual(fixture.model.state, expectedState, "old opening rows contaminated the new workspace");
    assert.deepEqual(fixture.staged, []);
    assert.deepEqual(fixture.persisted, []);
    assert.equal(fixture.alerts.some(([title]) => title === "Lưu thành công"), false);
  });
});

test("opening save stops if another package replaces its form during contractor lookup", async () => {
  await withOpeningSave(async (fixture) => {
    const saving = saveThongTinMoThau.call(fixture.controller);
    await fixture.lookupStarted.promise;
    fixture.switchPackage();
    fixture.syncReply.resolve({ ok: true }); fixture.lookupReply.resolve();
    await saving;
    assert.equal(fixture.pkg.trangThai, "Đã mở thầu", "detached form still committed");
    assert.deepEqual(fixture.staged, []);
    assert.deepEqual(fixture.persisted, []);
    assert.deepEqual(fixture.navigations, []);
    assert.equal(fixture.view._currentWorkflowPackageId, fixture.secondPkg.id);
  });
});

test("opening acknowledgement cannot redirect a newer package selection", async () => {
  await withOpeningSave(async (fixture) => {
    const saving = saveThongTinMoThau.call(fixture.controller);
    await fixture.syncStarted.promise;
    fixture.switchPackage();
    fixture.syncReply.resolve({ ok: true });
    await saving;
    assert.ok(fixture.persisted.length > 0, "the originating save reached persistence");
    assert.equal(fixture.view._currentWorkflowPackageId, fixture.secondPkg.id, "old ACK reopened package A");
    assert.deepEqual(fixture.navigations, []);
    assert.deepEqual(fixture.renders, [], "old ACK repainted the new package's opening draft");
  }, { lookupPending: false });
});

test("opening acknowledgement still advances when canonical sync repaints the same package form", async () => {
  await withOpeningSave(async (fixture) => {
    const saving = saveThongTinMoThau.call(fixture.controller);
    await fixture.syncStarted.promise;
    fixture.replaceSamePackageForm();
    fixture.syncReply.resolve({ ok: true });
    await saving;
    assert.ok(fixture.persisted.length > 0);
    assert.equal(fixture.view._currentWorkflowTab, "eval_tech", "same-package canonical repaint suppressed navigation");
    assert.deepEqual(fixture.navigations, [fixture.pkg.id]);
    assert.equal(fixture.alerts.some(([title]) => title === "Lưu thành công"), true);
  }, { lookupPending: false });
});

test("opening save stops when captured rows are removed from the same tbody during lookup", async () => {
  await withOpeningSave(async (fixture) => {
    const saving = saveThongTinMoThau.call(fixture.controller);
    await fixture.lookupStarted.promise;
    fixture.removeRowsFromSameBody();
    fixture.syncReply.resolve({ ok: true }); fixture.lookupReply.resolve();
    await saving;
    assert.equal(fixture.pkg.trangThai, "Đã mở thầu", "detached rows from an overwritten draft were committed");
    assert.deepEqual(fixture.staged, []);
    assert.deepEqual(fixture.persisted, []);
  });
});
