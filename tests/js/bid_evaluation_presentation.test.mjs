import assert from "node:assert/strict";
import test from "node:test";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { renderBidEvaluationRoundHistory } from "../../frontend/packages/BidEvaluationRoundHistory.js";
import { renderBidEvaluationLotScope } from "../../frontend/packages/BidEvaluationLotScopeController.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      toggle: (name, force) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
      },
      contains: (name) => this.classes.has(name),
    };
    this.textContent = "";
    this.innerHTML = "";
    this.disabled = false;
    this.checked = false;
    this.listeners = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type) {
    return this.listeners.get(type)?.({ target: this });
  }
}

function withDomSupport(run) {
  const originalElement = globalThis.Element;
  const originalDocument = globalThis.document;
  const originalSupported = DOMPurify.isSupported;
  const originalSanitize = DOMPurify.sanitize;
  globalThis.Element = FakeElement;
  globalThis.document = {
    querySelector: () => ({ sheet: { insertRule: () => {} } }),
  };
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => value;
  try {
    return run();
  } finally {
    globalThis.Element = originalElement;
    globalThis.document = originalDocument;
    DOMPurify.isSupported = originalSupported;
    DOMPurify.sanitize = originalSanitize;
  }
}

const LOTS = [
  { id: "lot-1", maPhanLo: "PL1", tenPhanLo: "Phần lô 1" },
  { id: "lot-2", maPhanLo: "PL2", tenPhanLo: "Phần lô 2" },
];

test("round history renders finalized bids and gates continuation", () => withDomSupport(() => {
  const container = new FakeElement();
  const currentRound = new FakeElement();
  const continueButton = new FakeElement();
  container.querySelector = (selector) => (
    selector === "#btn-continue-lot-evaluation" ? continueButton : null
  );
  const view = {
    getActiveElement: (id) => ({
      "danhgiahsdt-round-history": container,
      "danhgiahsdt-current-round": currentRound,
    })[id] || null,
  };
  const model = {
    state: {
      thongtinmothau: [{
        id: "bid-1",
        goiThauId: "pkg-1",
        lotId: "lot-1",
        maPhanLo: "PL1",
        tenNhaThau: "Nhà thầu A",
        danhGiaKetLuan: "Đạt",
        danhGiaTaiChinh: "Xếp hạng 1",
      }],
    },
    formatDate: (value) => `date:${value}`,
    formatDateWithTime: (value) => `datetime:${value}`,
  };
  const pkg = { id: "pkg-1", phanLo: "Có", phanLoList: LOTS };
  const metadataBlock = {
    lotBatches: {
      "batch-1": {
        batchId: "batch-1",
        sequenceNo: 1,
        status: "FINAL",
        saved: true,
        lotIds: ["lot-1"],
        lotCodes: ["PL1"],
        soBaoCao: "01/BC",
        result: { saved: true, soQuyetDinhKetQua: "01/QĐ" },
      },
    },
  };
  let continued = false;

  const waiting = renderBidEvaluationRoundHistory({
    view,
    model,
    pkg,
    metadataBlock,
    onContinue: () => { continued = true; },
  });

  assert.equal(waiting.showCurrentRound, false);
  assert.match(String(container.innerHTML), /Nhà thầu A/);
  assert.match(String(container.innerHTML), /01\/QĐ/);
  assert.match(String(container.innerHTML), /Còn 1 phần lô chưa đánh giá/);
  continueButton.emit("click");
  assert.equal(continued, true);

  const continuing = renderBidEvaluationRoundHistory({
    view,
    model,
    pkg,
    metadataBlock,
    continueRequested: true,
  });
  assert.equal(continuing.showCurrentRound, true);
}));

test("lot scope renders selected lots, disables Excel and emits scope changes", () => withDomSupport(() => {
  const container = new FakeElement();
  const allRadio = new FakeElement();
  const selectedRadio = new FakeElement();
  container.querySelector = (selector) => (
    selector.includes('value="all"') ? allRadio : selectedRadio
  );
  const first = new FakeElement();
  first.checked = true;
  first.setAttribute("data-evaluation-lot-id", "lot-1");
  const second = new FakeElement();
  second.setAttribute("data-evaluation-lot-id", "lot-2");
  const options = new FakeElement();
  options.querySelectorAll = (selector) => (
    selector.endsWith(":checked")
      ? [first, second].filter((item) => item.checked)
      : [first, second]
  );
  const feedback = new FakeElement();
  const badge = new FakeElement();
  const title = new FakeElement();
  const exportButton = new FakeElement();
  const importButton = new FakeElement();
  const elements = {
    "danhgiahsdt-scope-container": container,
    "danhgiahsdt-lot-options": options,
    "danhgiahsdt-scope-feedback": feedback,
    "danhgiahsdt-scope-badge": badge,
    "danhgiahsdt-table-title": title,
    "btn-danhgiahsdt-download-excel": exportButton,
    "btn-danhgiahsdt-import-excel": importButton,
  };
  const changes = [];
  const result = renderBidEvaluationLotScope({
    view: { getActiveElement: (id) => elements[id] || null },
    pkg: { id: "pkg-1", phanLo: "Có", phanLoList: LOTS },
    scope: {
      mode: "selected",
      availableLotIds: ["lot-1", "lot-2"],
      selectedLotIds: ["lot-1"],
    },
    onChange: (scope) => changes.push(scope),
  });

  assert.equal(result.isPartialScope, true);
  assert.equal(selectedRadio.checked, true);
  assert.match(String(options.innerHTML), /PL1/);
  assert.match(feedback.textContent, /1\/2 phần lô/);
  assert.match(title.textContent, /PL1/);
  assert.equal(exportButton.disabled, true);
  assert.equal(importButton.getAttribute("aria-disabled"), "true");

  second.checked = true;
  second.onchange();
  assert.deepEqual(changes.at(-1).selectedLotIds, ["lot-1", "lot-2"]);
  allRadio.onchange();
  assert.equal(changes.at(-1).mode, "all");
}));
