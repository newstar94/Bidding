import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { bindAwardResultPanelController } from "../../frontend/packages/detail/AwardResultPanelController.js";

class FakeElement {
  constructor(value = "") {
    this.value = value;
    this.disabled = false;
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  async emit(type, event = {}) {
    return this.listeners.get(type)?.({ target: this, ...event });
  }
}

function emptyRoot(map = {}) {
  return {
    querySelector: (selector) => map[selector] || null,
    querySelectorAll: () => [],
  };
}

function row({ lotCode, status, defaults = {} }) {
  const controls = {
    ".row-status-select": status,
    ".row-ly-do-truot": new FakeElement(""),
    ".row-gia-trung": new FakeElement(""),
    ".row-tg-goithau": new FakeElement(""),
    ".row-tg-hopdong": new FakeElement(""),
  };
  const attrs = {
    "data-default-reason": defaults.reason || "Xếp hạng sau",
    "data-default-price": defaults.price || "1.000",
    "data-default-duration-pkg": defaults.packageDuration || "60 ngày",
    "data-default-duration-ctr": defaults.contractDuration || "90 ngày",
  };
  const result = {
    cells: [{ textContent: lotCode }],
    querySelector: (selector) => controls[selector] || null,
    querySelectorAll: () => [],
    getAttribute: (name) => attrs[name] || "",
  };
  status.closest = (selector) => selector === "tr" ? result : null;
  return { element: result, controls };
}

test("panel controller cancels result editing and persists the cleared state", async () => {
  const cancel = new FakeElement();
  const pkg = {
    id: "pkg-1",
    trangThai: "Đang chấm thầu",
    danhGiaHsdtMetadata: JSON.stringify({ resultEdit: { type: "whole" } }),
  };
  const events = [];
  const view = {
    model: { state: { thongtinmothau: [] } },
    _editingOfficialResultLotBatchId: "batch-1",
    _currentResultLotBatchId: "batch-1",
    _editingWholePackageResult: true,
    _editingWholePackageResultPackageId: "pkg-1",
  };

  bindAwardResultPanelController({
    view,
    root: emptyRoot({ "#btn-cancel-official-result-edit": cancel }),
    pkg,
    viewModel: {},
    approvalPanel: { allBids: [], isDirectOrSpecial: false },
    rerender: () => events.push("rerender"),
    persistEditState: async () => events.push("persist"),
  });
  await cancel.emit("click");

  assert.equal(JSON.parse(pkg.danhGiaHsdtMetadata).resultEdit, undefined);
  assert.equal(view._editingOfficialResultLotBatchId, "");
  assert.equal(view._currentResultLotBatchId, "");
  assert.equal(view._editingWholePackageResult, false);
  assert.equal(view._editingWholePackageResultPackageId, "");
  assert.deepEqual(events, ["rerender", "persist"]);
});

test("panel controller keeps one winner per lot and restores winner defaults", async () => {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule: () => {} } }),
  };
  try {
    const selectedStatus = new FakeElement("trung");
    const otherStatus = new FakeElement("trung");
    const selected = row({
      lotCode: "PL1",
      status: selectedStatus,
      defaults: { price: "2.000", packageDuration: "70 ngày", contractDuration: "100 ngày" },
    });
    const other = row({ lotCode: "PL1", status: otherStatus });
    const rows = [selected.element, other.element];
    const tbody = {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === "tr"
        ? rows
        : selector === ".row-status-select"
          ? [selectedStatus, otherStatus]
          : [],
    };
    const root = emptyRoot({ "#approve-bidders-tbody": tbody });
    const view = { model: { state: { thongtinmothau: [] } } };

    bindAwardResultPanelController({
      view,
      root,
      pkg: { id: "pkg-1", phanLo: "Có" },
      viewModel: {},
      approvalPanel: { allBids: [], isDirectOrSpecial: false },
    });
    await selectedStatus.emit("change");

    assert.equal(otherStatus.value, "truot");
    assert.equal(other.controls[".row-ly-do-truot"].disabled, false);
    assert.equal(other.controls[".row-ly-do-truot"].value, "Xếp hạng sau");
    assert.equal(other.controls[".row-gia-trung"].disabled, true);
    assert.equal(other.controls[".row-gia-trung"].value, "");
    assert.equal(selected.controls[".row-gia-trung"].disabled, false);
    assert.equal(selected.controls[".row-gia-trung"].value, "2.000");
    assert.equal(selected.controls[".row-tg-goithau"].value, "70 ngày");
    assert.equal(selected.controls[".row-tg-hopdong"].value, "100 ngày");
    assert.equal(selected.controls[".row-ly-do-truot"].disabled, true);
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
  }
});

test("adding a bidder preserves lot columns for an empty lot package", async () => {
  const previousSupported = DOMPurify.isSupported;
  const previousSanitize = DOMPurify.sanitize;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  const addButton = new FakeElement();
  const insertedRows = [];
  const tbody = {
    appendChild: (child) => insertedRows.push(child),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const root = emptyRoot({
    "#btn-result-add-bidder": addButton,
    "#approve-bidders-tbody": tbody,
  });
  root.ownerDocument = {
    createElement: () => ({
      setAttribute: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      innerHTML: "",
    }),
  };
  const view = {
    model: {
      state: { thongtinmothau: [] },
      formatVND: (value) => value,
    },
  };

  try {
    bindAwardResultPanelController({
      view,
      root,
      pkg: { id: "pkg-1", phanLo: "Có", phanLoList: [] },
      viewModel: {},
      approvalPanel: { allBids: [], isDirectOrSpecial: false },
    });
    await addButton.emit("click");

    assert.equal(insertedRows.length, 1);
    assert.match(String(insertedRows[0].innerHTML), /row-ma-phan-lo/);
    assert.match(String(insertedRows[0].innerHTML), /row-ten-phan-lo/);
  } finally {
    DOMPurify.isSupported = previousSupported;
    DOMPurify.sanitize = previousSanitize;
  }
});
