import assert from "node:assert/strict";
import test from "node:test";

import { bindDetailedEvaluationPanelController } from "../../frontend/packages/DetailedEvaluationPanelController.js";

class FakeElement {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = "";
    this.files = [];
    this.checked = false;
    this.disabled = false;
    this.focused = false;
    this.selectorMap = new Map();
    this.selectorLists = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || "";
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async emit(type, event = {}) {
    const payload = { preventDefault() {}, target: this, key: "", ...event };
    for (const listener of this.listeners.get(type) || []) await listener(payload);
  }

  click() {
    return this.emit("click");
  }

  focus() {
    this.focused = true;
  }

  querySelector(selector) {
    return this.selectorMap.get(selector) || null;
  }

  querySelectorAll(selector) {
    return this.selectorLists.get(selector) || [];
  }

  closest() {
    return null;
  }
}

function createRoot({ selectors = {}, lists = {} } = {}) {
  const root = new FakeElement();
  Object.entries(selectors).forEach(([selector, element]) => root.selectorMap.set(selector, element));
  Object.entries(lists).forEach(([selector, elements]) => root.selectorLists.set(selector, elements));
  return root;
}

function createCommands() {
  const calls = [];
  return {
    calls,
    commands: {
      close: () => calls.push(["close"]),
      render: () => calls.push(["render"]),
      save: (options) => calls.push(["save", options]),
      importExcel: async (file) => calls.push(["import", file]),
      addCriterion: () => calls.push(["add"]),
      removeCriterion: (id) => calls.push(["remove", id]),
    },
  };
}

function createController(confirm = true) {
  return {
    selectedEvaluationBidId: "bid-1",
    selectedDetailedEvaluationTab: "validity",
    _detailedEvaluationDirty: false,
    _detailedEvaluationDrafts: new Map(),
    view: {
      customConfirm: async () => confirm,
      createIconsScoped() {},
    },
  };
}

function createState(overrides = {}) {
  return {
    bids: [{ id: "bid-1" }, { id: "bid-2" }],
    criteria: [],
    report: { id: "report-1", trangThai: "draft", chiTietList: [] },
    draftKey: "pkg-1:bid-1:single",
    ...overrides,
  };
}

test("bid navigation respects discard confirmation before changing selection", async () => {
  const select = new FakeElement();
  select.value = "bid-2";
  const root = createRoot({ selectors: { "#detailed-evaluation-bid-select": select } });
  const denied = createController(false);
  denied._detailedEvaluationDirty = true;
  const deniedCommands = createCommands();
  bindDetailedEvaluationPanelController({
    appController: denied,
    root,
    state: createState(),
    commands: deniedCommands.commands,
  });
  await select.onchange();
  assert.equal(denied.selectedEvaluationBidId, "bid-1");
  assert.equal(select.value, "bid-1");
  assert.deepEqual(deniedCommands.calls, []);

  const acceptedSelect = new FakeElement();
  acceptedSelect.value = "bid-2";
  const accepted = createController(true);
  accepted._detailedEvaluationDirty = true;
  const acceptedCommands = createCommands();
  bindDetailedEvaluationPanelController({
    appController: accepted,
    root: createRoot({ selectors: { "#detailed-evaluation-bid-select": acceptedSelect } }),
    state: createState(),
    commands: acceptedCommands.commands,
  });
  await acceptedSelect.onchange();
  assert.equal(accepted.selectedEvaluationBidId, "bid-2");
  assert.equal(accepted._detailedEvaluationDirty, false);
  assert.deepEqual(acceptedCommands.calls, [["render"]]);
});

test("tab keyboard navigation focuses and activates the expected group", async () => {
  const validity = new FakeElement();
  validity.setAttribute("data-detailed-evaluation-group", "validity");
  const technical = new FakeElement();
  technical.setAttribute("data-detailed-evaluation-group", "technical");
  const controller = createController();
  const commandState = createCommands();
  bindDetailedEvaluationPanelController({
    appController: controller,
    root: createRoot({
      lists: { "[data-detailed-evaluation-group]": [validity, technical] },
    }),
    state: createState(),
    commands: commandState.commands,
  });

  await validity.emit("keydown", { key: "End" });
  await Promise.resolve();
  assert.equal(technical.focused, true);
  assert.equal(controller.selectedDetailedEvaluationTab, "technical");
  assert.deepEqual(commandState.calls, [["render"]]);
});

test("panel actions dispatch save, row, reopen and Excel commands", async () => {
  const saveDraft = new FakeElement();
  const completeGroup = new FakeElement();
  const completeReport = new FakeElement();
  const reopen = new FakeElement();
  const add = new FakeElement();
  const remove = new FakeElement();
  remove.setAttribute("data-detailed-remove-criterion", "criterion-1");
  const excelInput = new FakeElement();
  const workbook = { name: "evaluation.xlsx" };
  excelInput.files = [workbook];
  const excelButton = new FakeElement();
  const editableInput = new FakeElement();
  const state = createState({
    report: { id: "report-1", trangThai: "completed", chiTietList: [] },
  });
  const controller = createController();
  const commandState = createCommands();
  bindDetailedEvaluationPanelController({
    appController: controller,
    root: createRoot({
      selectors: {
        "#btn-detailed-evaluation-save-draft": saveDraft,
        "#btn-detailed-evaluation-complete-group": completeGroup,
        "#btn-detailed-evaluation-complete-report": completeReport,
        "#btn-detailed-evaluation-reopen": reopen,
        "#btn-detailed-evaluation-add-row": add,
        "#detailed-evaluation-excel-input": excelInput,
        "#btn-detailed-evaluation-import-excel": excelButton,
      },
      lists: {
        "input, select, textarea": [editableInput],
        "[data-detailed-remove-criterion]": [remove],
      },
    }),
    state,
    commands: commandState.commands,
  });

  await editableInput.emit("input");
  await saveDraft.emit("click");
  await completeGroup.emit("click");
  await completeReport.emit("click");
  await add.emit("click");
  await remove.emit("click");
  await reopen.emit("click");
  await excelInput.emit("change");

  assert.equal(controller._detailedEvaluationDirty, true);
  assert.equal(controller._editingDetailedEvaluationKey, state.draftKey);
  assert.equal(controller._detailedEvaluationDrafts.get(state.draftKey).trangThai, "draft");
  assert.equal(excelButton.disabled, false);
  assert.equal(excelInput.value, "");
  assert.deepEqual(commandState.calls, [
    ["save", undefined],
    ["save", { completeGroup: true }],
    ["save", { completeReport: true }],
    ["add"],
    ["remove", "criterion-1"],
    ["render"],
    ["import", workbook],
  ]);
});
