import assert from "node:assert/strict";
import test from "node:test";

import { renderBasicImportResult, saveExcelImport } from "../../frontend/documents/ExcelIntegration.js";

test("Excel import loads the required view module and renders imported data immediately", async () => {
  const calls = [];
  const view = {
    async ensureViewModules(tab) {
      calls.push(["ensure", tab]);
    },
    async renderNhaThauTable() {
      calls.push(["render", this === view]);
    }
  };

  await renderBasicImportResult({ view }, "nhathau");

  assert.deepEqual(calls, [
    ["ensure", "nhathau"],
    ["render", true]
  ]);
});

test("Excel import ignores business-only import types in the basic table renderer", async () => {
  let called = false;
  await renderBasicImportResult({
    view: {
      ensureViewModules() {
        called = true;
      }
    }
  }, "mothau");

  assert.equal(called, false);
});

test("Excel import renders the local snapshot when the server is unavailable", async () => {
  const model = { useServerSidePagination: true };
  let paginationModeDuringRender = null;
  await renderBasicImportResult({
    model,
    view: {
      async ensureViewModules() {},
      async renderChuyenGiaTable() {
        paginationModeDuringRender = model.useServerSidePagination;
      }
    }
  }, "chuyengia", { useLocalSnapshot: true });

  assert.equal(paginationModeDuringRender, false);
  assert.equal(model.useServerSidePagination, true);
});

test("basic Excel import refreshes the entity table only after synchronization", async () => {
  const calls = [];
  const controller = {
    _excelImportType: "chuyengia",
    _excelImportData: [{
      hoTen: "Nguyễn Văn A",
      soCCCD: "001234567890",
      soChungChi: "C01.01.00001",
      _valid: true,
      _operation: "create"
    }],
    model: {
      state: { chuyengia: [] },
      currentPage: { chuyengia: 3 },
      useServerSidePagination: true,
      convertDMYToYMD(value) { return value; },
      async persistData(table) { calls.push(`persist:${table}`); }
    },
    view: {
      async ensureViewModules(tab) { calls.push(`ensure:${tab}`); },
      async renderChuyenGiaTable() { calls.push("render"); },
      showToast() {}
    },
    async autoSync() {
      calls.push("sync");
      return { ok: true };
    },
    async closeModal() { calls.push("close"); }
  };

  await saveExcelImport.call(controller);

  assert.equal(controller.model.state.chuyengia.length, 1);
  assert.equal(controller.model.currentPage.chuyengia, 1);
  assert.ok(calls.indexOf("sync") < calls.indexOf("render"));
  assert.deepEqual(calls.slice(-3), ["ensure:chuyengia", "render", "close"]);
});
