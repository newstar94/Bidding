import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "dompurify";
import { importOpeningFromMuasamcong } from "../../frontend/procurement/OpeningImportWizard.js";

async function withSharedOpeningImport(run) {
  const previousDocument = globalThis.document;
  const previousSanitize = DOMPurify.sanitize;
  const previousSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true; DOMPurify.sanitize = (value) => value;
  const select = { value: "package-a" };
  let buttonLabel = "Lấy dữ liệu";
  const button = {
    dataset: {}, disabled: false,
    get innerHTML() { return buttonLabel; },
    set innerHTML(value) { buttonLabel = String(value); },
    get textContent() { return buttonLabel; },
    set textContent(value) { buttonLabel = String(value); },
    setAttribute() {}, removeAttribute() {},
  };
  const pane = {
    querySelector: (selector) => selector === "#mothau-goithau-select" ? select
      : selector === "#btn-mothau-import-msc" ? button : null,
    contains: (element) => [select, button].includes(element),
  };
  select.closest = () => pane; button.closest = () => pane;
  globalThis.document = {
    querySelector: () => pane,
    getElementById: (id) => pane.querySelector(`#${id}`),
  };
  const alerts = [], writes = [];
  const controller = {
    model: {
      state: { goithau: [
        { id: "package-a", rootId: "root-a", rowVersion: 3, maGoiThau: "IB2600000001" },
        { id: "package-b", rootId: "root-b", rowVersion: 7, maGoiThau: "IB2600000002" },
      ] },
      db: {}, workspaceStorage: {}, getWorkspaceToken: () => "workspace-a@1",
    },
    view: { async customAlert(...args) { alerts.push(args); }, createIconsScoped() {} },
    addMoThauRow(...args) { writes.push(args); },
  };
  try {
    await run({ controller, select, button, alerts, writes });
  } finally {
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    DOMPurify.sanitize = previousSanitize; DOMPurify.isSupported = previousSupported;
  }
}

test("discarding an opening import after leaving its retained route allows retry on return", async () => {
  const previousDocument = globalThis.document;
  const previousSanitize = DOMPurify.sanitize;
  const previousSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true; DOMPurify.sanitize = (value) => value;
  let resolvePrepare;
  const prepareReply = new Promise((done) => { resolvePrepare = done; });
  const select = { value: "package-a" };
  const button = { dataset: {}, innerHTML: "Lấy dữ liệu", textContent: "Lấy dữ liệu", disabled: false,
    setAttribute() {}, removeAttribute() {} };
  const pane = {
    querySelector: (selector) => selector === "#mothau-goithau-select" ? select
      : selector === "#btn-mothau-import-msc" ? button : null,
    contains: (element) => [select, button].includes(element),
  };
  select.closest = () => pane; button.closest = () => pane;
  let activePane = pane;
  globalThis.document = {
    querySelector: () => activePane,
    getElementById: (id) => pane.querySelector(`#${id}`),
  };
  const alerts = [], writes = [];
  const controller = {
    model: {
      state: { goithau: [{ id: "package-a", rootId: "root-a", rowVersion: 3, maGoiThau: "IB2600000001" }] },
      db: {}, workspaceStorage: {}, getWorkspaceToken: () => "workspace-a@1",
    },
    view: { async customAlert(...args) { alerts.push(args); }, createIconsScoped() {} },
    addMoThauRow(...args) { writes.push(args); },
  };
  let prepareCalls = 0;
  const client = {
    async prepareOpening() { prepareCalls += 1; return await prepareReply; },
    async applyOpening() { assert.fail("inactive route must not apply source data"); },
  };
  try {
    const pending = importOpeningFromMuasamcong.call(controller, { client });
    assert.equal(prepareCalls, 1);
    activePane = { querySelector: () => null };
    resolvePrepare({ previewId: "preview-a", package: { id: "package-a", rowVersion: 3 } });
    await pending;
    assert.deepEqual(writes, []); assert.deepEqual(alerts, []);
    activePane = pane;
    assert.equal(button.disabled, false, "returning to the retained route must not leave the old import busy");
    assert.equal(button.dataset.loading, undefined);
    assert.equal(String(button.innerHTML), "Lấy dữ liệu");
    const retry = await importOpeningFromMuasamcong.call(controller, { client: {
      async prepareOpening() { prepareCalls += 1; throw new Error("retry transport failure"); },
    } });
    assert.equal(retry, undefined);
    assert.equal(prepareCalls, 2, "returned route must allow a new import operation");
  } finally {
    resolvePrepare?.({});
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    DOMPurify.sanitize = previousSanitize; DOMPurify.isSupported = previousSupported;
  }
});

test("changing the package on a retained opening form releases the old import button for retry", async () => {
  await withSharedOpeningImport(async ({ controller, select, button, alerts, writes }) => {
    let resolvePrepare;
    const prepareReply = new Promise((done) => { resolvePrepare = done; });
    const pending = importOpeningFromMuasamcong.call(controller, { client: {
      async prepareOpening() { return await prepareReply; },
      async applyOpening() { assert.fail("a response for the previous package must not apply"); },
    } });
    select.value = "package-b";
    assert.equal(button.textContent, "Đang lấy dữ liệu…", "the button still belongs to A's pending operation");
    assert.equal(button.dataset.loading, "true");
    resolvePrepare({ previewId: "preview-a", package: { id: "package-a", rowVersion: 3 } });
    await pending;
    assert.deepEqual(writes, []);
    assert.deepEqual(alerts, []);
    assert.equal(button.disabled, false, "selecting B must not leave the shared import button busy forever");
    assert.equal(button.dataset.loading, undefined);
    assert.equal(button.textContent, "Lấy dữ liệu");
    let retryCalls = 0;
    await importOpeningFromMuasamcong.call(controller, { client: {
      async prepareOpening({ packageId }) {
        retryCalls += 1;
        assert.equal(packageId, "package-b");
        throw new Error("controlled retry transport failure");
      },
    } });
    assert.equal(retryCalls, 1, "the newly selected package must allow a fresh import");
  });
});

test("a completed old import cannot reset a newer operation on the same retained button", async () => {
  await withSharedOpeningImport(async ({ controller, select, button, alerts, writes }) => {
    let resolveA, resolveB;
    const replyA = new Promise((done) => { resolveA = done; });
    const replyB = new Promise((done) => { resolveB = done; });
    const pendingA = importOpeningFromMuasamcong.call(controller, { client: {
      async prepareOpening() { return await replyA; },
      async applyOpening() { assert.fail("old A must not apply after B starts"); },
    } });
    select.value = "package-b";
    delete button.dataset.loading;
    button.disabled = false;
    button.innerHTML = "Lấy dữ liệu gói B";
    let callsB = 0;
    const pendingB = importOpeningFromMuasamcong.call(controller, { client: {
      async prepareOpening({ packageId }) {
        callsB += 1;
        assert.equal(packageId, "package-b");
        return await replyB;
      },
      async applyOpening() { throw new Error("controlled B apply failure"); },
    } });
    try {
      assert.equal(callsB, 1, "B must have acquired a new operation identity on the shared button");
      resolveA({ previewId: "preview-a", package: { id: "package-a", rowVersion: 3 } });
      await pendingA;
      assert.deepEqual(alerts, []);
      assert.deepEqual(writes, []);
      assert.equal(button.dataset.loading, "true", "old A must not release B's operation");
      assert.equal(button.disabled, true);
      assert.equal(button.textContent, "Đang lấy dữ liệu…");
      resolveB({ previewId: "preview-b", package: { id: "package-b", rowVersion: 7 } });
      await pendingB;
      assert.equal(button.disabled, false);
      assert.equal(button.dataset.loading, undefined);
      assert.equal(button.textContent, "Lấy dữ liệu gói B", "B must restore its own original label");
    } finally {
      resolveA({}); resolveB({});
      await Promise.allSettled([pendingA, pendingB]);
    }
  });
});
