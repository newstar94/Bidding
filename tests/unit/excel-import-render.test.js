import assert from "node:assert/strict";
import test from "node:test";

import { renderBasicImportResult } from "../../frontend/documents/ExcelIntegration.js";

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
