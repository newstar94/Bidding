import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { bindBidEvaluationPanelController } from "../../frontend/packages/BidEvaluationPanelController.js";
import { buildEvaluationProgressMarkup } from "../../frontend/packages/BidEvaluationProgressView.js";

DOMPurify.isSupported = true;
DOMPurify.sanitize = (value) => String(value);

function button() {
  return {
    hidden: false,
    disabled: false,
    className: "",
    innerHTML: "",
    onclick: null,
    setAttribute(name) { if (name === "disabled") this.disabled = true; },
    removeAttribute(name) { if (name === "disabled") this.disabled = false; },
  };
}

function bindActions(actionMode) {
  const draft = button();
  const complete = button();
  const calls = [];
  const controls = new Map([
    ["btn-danhgiahsdt-save-draft", draft],
    ["btn-danhgiahsdt-save", complete],
  ]);
  const appController = {
    model: { state: { thongtinmothau: [] } },
    view: {
      getActiveElement: (id) => controls.get(id) || null,
      isGoiThauDetailTabActive: () => false,
    },
    saveDanhGiaHsdt: (options) => calls.push(options),
  };
  const context = {
    appController,
    pkg: {
      id: "pkg-1",
      linhVuc: "Tư vấn",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
    },
    panelState: {
      actionMode,
      activeMeta: {},
      isReadOnly: actionMode !== "save",
      isTwoEnvelope: false,
      stepKey: "eval_tech",
    },
    onRerender() {},
  };
  bindBidEvaluationPanelController(context);
  return { draft, complete, calls, context };
}

test("draft and completion actions are distinct, keyboard-native, and do not duplicate handlers", () => {
  const fixture = bindActions("save");
  bindBidEvaluationPanelController(fixture.context);

  assert.equal(fixture.draft.hidden, false);
  assert.equal(fixture.complete.hidden, false);
  fixture.draft.onclick();
  fixture.complete.onclick();
  assert.deepEqual(fixture.calls, [{ mode: "draft" }, { mode: "complete" }]);

  const fullPage = readFileSync("views/tabs/tab_danhgiahsdt.html", "utf8");
  const detail = readFileSync("frontend/packages/detail/EvaluationPanel.js", "utf8");
  assert.match(fullPage, /type="button"[^>]+id="btn-danhgiahsdt-save-draft"/u);
  assert.match(detail, /type="button"[^>]+id="btn-danhgiahsdt-save-draft"/u);
});

test("draft action is unavailable in read-only or locked action mode", () => {
  const fixture = bindActions("hidden");
  assert.equal(fixture.draft.hidden, true);
  assert.equal(fixture.draft.disabled, true);
  assert.equal(fixture.draft.onclick, null);
});

test("progress markup exposes numeric and textual status without changing table structure", () => {
  const markup = buildEvaluationProgressMarkup({
    percent: 31,
    stages: [
      { label: "Hợp lệ", completed: 20, applicable: 20 },
      { label: "Năng lực", completed: 8, applicable: 15 },
    ],
  });
  assert.match(markup, /role="progressbar"/u);
  assert.match(markup, /aria-valuenow="31"/u);
  assert.match(markup, /aria-label="Tiến độ đánh giá"/u);
  assert.match(markup, /31%/u);
  assert.match(markup, /Hợp lệ 20\/20/u);
  assert.doesNotMatch(markup, /<(?:table|thead|tbody|tr|td|th)\b/u);
});
