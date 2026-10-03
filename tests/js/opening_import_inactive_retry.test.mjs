import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "dompurify";
import { importOpeningFromMuasamcong } from "../../frontend/procurement/OpeningImportWizard.js";

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
