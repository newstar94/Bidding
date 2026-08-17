import assert from "node:assert/strict";
import test from "node:test";

import {
  renderBidEvaluationLotScope,
} from "../../frontend/packages/BidEvaluationLotScopeController.js";
import { getPackageEvaluationLots } from "../../frontend/packages/lotEvaluationScope.js";

function classList() {
  const values = new Set();
  return {
    add: (...tokens) => tokens.forEach((token) => values.add(token)),
    remove: (...tokens) => tokens.forEach((token) => values.delete(token)),
    toggle: (token, force) => force ? values.add(token) : values.delete(token),
    contains: (token) => values.has(token),
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

test("evaluation lots are always ordered by lot code", () => {
  const lots = getPackageEvaluationLots({
    phanLo: "Có",
    phanLoList: [
      { id: "lot-21", maPhanLo: "PP21", sortOrder: 0 },
      { id: "lot-3", maPhanLo: "PP3", sortOrder: 1 },
      { id: "lot-2", maPhanLo: "PP2", sortOrder: 2 },
    ],
  });

  assert.deepEqual(lots.map((lot) => lot.code), ["PP2", "PP3", "PP21"]);
});

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
  const lotActions = { classList: classList() };
  const selectAllLots = button();
  const clearAllLots = button();
  const title = { textContent: "" };
  const download = button();
  const importExcel = button();
  const changes = [];
  const elements = {
    "danhgiahsdt-scope-container": container,
    "danhgiahsdt-lot-actions": lotActions,
    "danhgiahsdt-select-all-lots": selectAllLots,
    "danhgiahsdt-clear-all-lots": clearAllLots,
    "danhgiahsdt-scope-feedback": feedback,
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
      onChange: (nextScope) => changes.push(nextScope),
    });

    assert.equal(download.disabled, false);
    assert.equal(importExcel.disabled, false);
    assert.equal(download.getAttribute("aria-disabled"), "false");
    assert.equal(importExcel.getAttribute("aria-disabled"), "false");
    assert.equal(title.textContent, "Đánh giá E-HSDT");
    assert.equal(selectAllLots.disabled, false);
    assert.equal(clearAllLots.disabled, false);
    selectAllLots.onclick();
    assert.deepEqual(changes.at(-1).selectedLotIds, ["lot-1", "lot-2"]);
    clearAllLots.onclick();
    assert.deepEqual(changes.at(-1).selectedLotIds, []);
    assert.doesNotMatch(feedback.textContent, /sẽ được mở sau/);
  } finally {
    globalThis.Element = previousElement;
  }
});

test("whole-package evaluation hides individual lot controls", () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class {};
  let optionsMarkup = "existing lot options";
  const options = {
    classList: classList(),
    get innerHTML() { return optionsMarkup; },
    set innerHTML(value) {
      if (typeof value === "string") {
        throw new TypeError("This document requires 'TrustedHTML' assignment.");
      }
      optionsMarkup = String(value);
    },
    replaceChildren() { optionsMarkup = ""; },
    querySelectorAll: () => [],
  };
  const feedback = { textContent: "existing feedback", classList: classList() };
  const lotActions = { classList: classList() };
  const selectAllLots = button();
  const clearAllLots = button();
  const container = {
    classList: classList(),
    querySelector: (selector) => ({ checked: selector.includes('value="all"') }),
  };
  const elements = {
    "danhgiahsdt-scope-container": container,
    "danhgiahsdt-lot-actions": lotActions,
    "danhgiahsdt-select-all-lots": selectAllLots,
    "danhgiahsdt-clear-all-lots": clearAllLots,
    "danhgiahsdt-lot-options": options,
    "danhgiahsdt-scope-feedback": feedback,
  };

  try {
    renderBidEvaluationLotScope({
      view: { getActiveElement: (id) => elements[id] || null },
      pkg: {
        phanLo: "Có",
        phanLoList: [
          { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Lot 1" },
          { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Lot 2" },
        ],
      },
      scope: {
        mode: "all",
        selectedLotIds: ["lot-1", "lot-2"],
        availableLotIds: ["lot-1", "lot-2"],
        batchId: null,
      },
    });

    assert.equal(options.innerHTML, "");
    assert.equal(options.classList.contains("is-hidden"), true);
    assert.equal(lotActions.classList.contains("is-hidden"), true);
    assert.equal(feedback.textContent, "");
    assert.equal(feedback.classList.contains("is-hidden"), true);
  } finally {
    globalThis.Element = previousElement;
  }
});
