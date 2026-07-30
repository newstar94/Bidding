import assert from "node:assert/strict";
import test from "node:test";

import {
  renderBidEvaluationLotScope,
} from "../../frontend/packages/BidEvaluationLotScopeController.js";

function classList() {
  const values = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    toggle: (token, force) => force ? values.add(token) : values.delete(token),
  };
}

function button() {
  const attributes = new Map();
  return {
    disabled: false,
    title: "",
    setAttribute(name, value) { attributes.set(name, value); },
    getAttribute(name) { return attributes.get(name); },
  };
}

test("Excel actions stay enabled when evaluating a selected lot scope", () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class {};
  const allRadio = {};
  const selectedRadio = {};
  const container = {
    classList: classList(),
    style: { setProperty() {} },
    querySelector(selector) {
      return selector.includes('value="all"') ? allRadio : selectedRadio;
    },
  };
  const feedback = { textContent: "", classList: classList() };
  const badge = { textContent: "" };
  const title = { textContent: "" };
  const download = button();
  const importExcel = button();
  const elements = {
    "danhgiahsdt-scope-container": container,
    "danhgiahsdt-scope-feedback": feedback,
    "danhgiahsdt-scope-badge": badge,
    "danhgiahsdt-table-title": title,
    "btn-danhgiahsdt-download-excel": download,
    "btn-danhgiahsdt-import-excel": importExcel,
  };

  try {
    renderBidEvaluationLotScope({
      view: { getActiveElement: (id) => elements[id] || null },
      pkg: {
        phanLo: "Có",
        phanLoList: [
          { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lô 1" },
          { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lô 2" },
        ],
      },
      scope: {
        mode: "selected",
        selectedLotIds: ["lot-1"],
        availableLotIds: ["lot-1", "lot-2"],
        batchId: null,
      },
    });

    assert.equal(download.disabled, false);
    assert.equal(importExcel.disabled, false);
    assert.equal(download.getAttribute("aria-disabled"), "false");
    assert.equal(importExcel.getAttribute("aria-disabled"), "false");
    assert.doesNotMatch(feedback.textContent, /sẽ được mở sau/);
  } finally {
    globalThis.Element = previousElement;
  }
});
