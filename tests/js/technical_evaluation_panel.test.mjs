import assert from "node:assert/strict";
import test from "node:test";

import {
  renderDetailedEvaluationActionButtons,
  renderTechnicalEvaluationHeader,
  renderTechnicalEvaluationMethodSelector,
  renderTechnicalPassFailRow,
  renderTechnicalScoreRow,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";
import {
  bindDetailedEvaluationPanelController,
  collectConfiguredDetailedEvaluationCriteria,
} from "../../frontend/packages/DetailedEvaluationPanelController.js";

const criterion = {
  id: "criterion-1",
  code: "TECH-1",
  name: "Giải pháp kỹ thuật",
  group: "technical",
  required: true,
  maxScore: 100,
  minScore: 70,
  stt: "1",
  isCustom: true,
};

test("unknown technical method shows a radio choice before the detailed table", () => {
  const markup = renderTechnicalEvaluationMethodSelector();
  assert.match(markup, /name="detailed-technical-evaluation-method" value="pass_fail"/);
  assert.match(markup, /name="detailed-technical-evaluation-method" value="score"/);
  assert.equal(renderTechnicalEvaluationHeader(""), "");
});

test("pass-fail technical method renders the matching grouped headers", () => {
  const header = renderTechnicalEvaluationHeader("pass_fail");
  const row = renderTechnicalPassFailRow({ criterion, row: { ketQua: "acceptable" }, index: 0, disabled: false });
  assert.match(header, /<th colspan="3">Kết quả đánh giá của chuyên gia<\/th>/);
  assert.match(header, /<th>Đạt<\/th><th>Chấp nhận được<\/th><th>Không đạt<\/th>/);
  assert.match(header, /<th rowspan="2">Thao tác<\/th>/);
  assert.match(row, /data-detailed-result-value="acceptable"[^>]*checked/);
  assert.equal(renderTechnicalEvaluationMethodSelector({ method: "pass_fail" }), "");
});

test("scoring technical method renders maximum, minimum and evaluated score columns", () => {
  const header = renderTechnicalEvaluationHeader("score");
  const row = renderTechnicalScoreRow({ criterion, row: { diem: 82 }, index: 0, disabled: false });
  assert.match(header, /<th colspan="2">Mức điểm quy định trong E-HSMT<\/th>/);
  assert.match(header, /<th>Điểm tối đa<\/th><th>Điểm tối thiểu<\/th><th>Điểm đánh giá<\/th>/);
  assert.match(row, /data-detailed-config-field="maxScore"/);
  assert.match(row, /data-detailed-config-field="minScore"/);
  assert.match(row, /data-detailed-field="diem"/);
  assert.match(header, /<th>Nhận xét của chuyên gia<\/th>/);
  assert.match(header, /<th rowspan="2">Thao tác<\/th>/);
});

test("technical rows keep STT immutable and expose icon-only criterion actions while editing", () => {
  const customCriterion = {
    ...criterion,
    isCustom: true,
    requirement: "Yêu cầu con",
  };
  const row = renderTechnicalPassFailRow({
    criterion: customCriterion,
    row: { ketQua: "pending" },
    index: 0,
    disabled: false,
    editing: false,
  });

  assert.match(row, /<strong class="detailed-evaluation-stt">1<\/strong>/);
  assert.doesNotMatch(row, /data-detailed-config-field="stt"/);
  assert.doesNotMatch(row, /data-detailed-config-field="name"/);
  assert.doesNotMatch(row, /data-detailed-config-field="requirement"/);
  assert.match(row, /class="detailed-evaluation-requirement"><strong>Yêu cầu:<\/strong> Yêu cầu con/);
  assert.match(row, /detailed-evaluation-criterion-action-add/);
  assert.match(row, /detailed-evaluation-criterion-action-edit/);
  assert.match(row, /detailed-evaluation-criterion-action-remove/);
  for (const action of ["add-child-criterion", "edit-criterion", "remove-criterion"]) {
    assert.match(row, new RegExp(`data-detailed-${action}="criterion-1"`));
    assert.match(row, new RegExp(`<button[^>]*data-detailed-${action}="criterion-1"[^>]*>\\s*<i\\b`));
  }
  assert.doesNotMatch(row, />\s*(Thêm|Sửa|Xóa)\s*</);

  const editingRow = renderTechnicalPassFailRow({
    criterion: customCriterion,
    row: { ketQua: "pending" },
    index: 0,
    disabled: false,
    editing: true,
  });
  assert.match(editingRow, /<strong class="detailed-evaluation-stt">1<\/strong>/);
  assert.doesNotMatch(editingRow, /data-detailed-config-field="stt"/);
  assert.doesNotMatch(editingRow, /data-detailed-config-field="name"[^>]*readonly/);
  assert.doesNotMatch(editingRow, /data-detailed-config-field="requirement"[^>]*readonly/);
});

test("technical display omits an empty optional requirement while edit mode keeps the field available", () => {
  const emptyRequirement = { ...criterion, isCustom: true, requirement: "  " };
  const displayRow = renderTechnicalPassFailRow({
    criterion: emptyRequirement,
    row: { ketQua: "pending" },
    index: 0,
    disabled: false,
    editing: false,
  });
  assert.doesNotMatch(displayRow, /Yêu cầu:/);
  assert.doesNotMatch(displayRow, /data-detailed-config-field="requirement"/);

  const editingRow = renderTechnicalPassFailRow({
    criterion: emptyRequirement,
    row: { ketQua: "pending" },
    index: 0,
    disabled: false,
    editing: true,
  });
  assert.match(editingRow, /data-detailed-config-field="requirement"/);
  assert.match(editingRow, /placeholder="Yêu cầu của tiêu chí \(nếu có\)"/);
});

test("technical read-only rows have no criterion action buttons", () => {
  const row = renderTechnicalPassFailRow({
    criterion: { ...criterion, isCustom: true, requirement: "Yêu cầu" },
    row: { ketQua: "pending" },
    index: 0,
    disabled: true,
    editing: false,
  });
  assert.match(row, /<strong class="detailed-evaluation-stt">1<\/strong>/);
  assert.doesNotMatch(row, /<button\b/);
  assert.doesNotMatch(row, /data-detailed-(?:add-child|edit|remove)-criterion=/);
});

test("technical score limits are read-only until criterion editing starts", () => {
  const scoreRow = renderTechnicalScoreRow({
    criterion: { ...criterion, isCustom: true },
    row: { diem: 82 },
    index: 0,
    disabled: false,
    editing: false,
  });
  assert.match(scoreRow, /data-detailed-config-field="maxScore"[^>]*readonly/);
  assert.match(scoreRow, /data-detailed-config-field="minScore"[^>]*readonly/);
  assert.match(scoreRow, /data-detailed-field="diem"(?![^>]*readonly)(?![^>]*disabled)/);

  const editingRow = renderTechnicalScoreRow({
    criterion: { ...criterion, isCustom: true },
    row: { diem: 82 },
    index: 0,
    disabled: false,
    editing: true,
  });
  assert.doesNotMatch(editingRow, /data-detailed-config-field="maxScore"[^>]*readonly/);
  assert.doesNotMatch(editingRow, /data-detailed-config-field="minScore"[^>]*readonly/);
  for (const action of ["add-child-criterion", "edit-criterion", "remove-criterion"]) {
    assert.match(editingRow, new RegExp(`data-detailed-${action}="criterion-1"`));
  }
});

test("technical configuration preserves the supplied STT while non-technical custom STT remains configurable", () => {
  const criteria = [
    { ...criterion, group: "technical", name: "Kỹ thuật cũ", stt: "1" },
    { ...criterion, id: "validity-1", group: "validity", name: "Hợp lệ cũ", stt: "2" },
  ];
  const values = new Map([
    ["criterion-1", { stt: "9", name: "Kỹ thuật mới", requirement: "Điều kiện mới", maxScore: "90", minScore: "60" }],
    ["validity-1", { stt: "3", name: "Hợp lệ mới", requirement: "Điều kiện hợp lệ", maxScore: "", minScore: "" }],
  ]);
  const container = {
    querySelectorAll: () => criteria.map((item) => ({
      getAttribute: (name) => name === "data-detailed-criterion-id" ? item.id : "",
      querySelector: (selector) => {
        const field = selector.match(/data-detailed-config-field="([^"]+)"/)?.[1];
        const value = values.get(item.id)?.[field];
        return value === undefined ? null : { value };
      },
    })),
  };

  const configured = collectConfiguredDetailedEvaluationCriteria(container, criteria);
  const technical = configured.find((item) => item.id === "criterion-1");
  const validity = configured.find((item) => item.id === "validity-1");
  assert.equal(technical.stt, "1");
  assert.equal(technical.name, "Kỹ thuật mới");
  assert.equal(technical.maxScore, 90);
  assert.equal(technical.minScore, 60);
  assert.equal(validity.stt, "3");
});

test("technical add action passes the parent criterion id to the child-criterion command", () => {
  const listeners = new Map();
  const root = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  const calls = [];
  const appController = {
    selectedDetailedEvaluationTab: "technical",
    view: { createIconsScoped: () => {} },
  };
  const state = {
    readOnly: false,
    bids: [],
    criteria: [{ ...criterion, group: "technical" }],
    context: { editableGroups: ["technical"] },
  };
  bindDetailedEvaluationPanelController({
    appController,
    root,
    state,
    commands: {
      close: () => {},
      render: () => {},
      save: () => {},
      importExcel: () => {},
      addCriterion: (parentId) => calls.push(parentId),
      removeCriterion: () => {},
      setTechnicalMethod: () => {},
    },
  });

  const action = {
    disabled: false,
    getAttribute: (name) => name === "data-detailed-add-child-criterion" ? "criterion-1" : null,
  };
  listeners.get("click")?.({
    target: { closest: () => action },
  });
  assert.deepEqual(calls, ["criterion-1"]);
});

test("rebinding the panel keeps delegated criterion actions single-shot", () => {
  const listeners = new Map();
  const root = {
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, listener) => {
      const bucket = listeners.get(type) || [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type, listener) => {
      const bucket = listeners.get(type) || [];
      const index = bucket.indexOf(listener);
      if (index >= 0) bucket.splice(index, 1);
    },
  };
  const calls = { add: [], remove: [] };
  const appController = {
    selectedDetailedEvaluationTab: "technical",
    view: { createIconsScoped: () => {} },
  };
  const state = {
    readOnly: false,
    bids: [],
    criteria: [{ ...criterion, group: "technical" }],
    context: { editableGroups: ["technical"] },
  };
  const commands = {
    close: () => {},
    render: () => {},
    save: () => {},
    importExcel: () => {},
    addCriterion: (parentId) => calls.add.push(parentId),
    removeCriterion: (criterionId) => calls.remove.push(criterionId),
    setTechnicalMethod: () => {},
  };
  bindDetailedEvaluationPanelController({ appController, root, state, commands });
  bindDetailedEvaluationPanelController({ appController, root, state, commands });

  const addAction = {
    disabled: false,
    getAttribute: (name) => name === "data-detailed-add-child-criterion" ? "criterion-1" : null,
  };
  for (const listener of listeners.get("click") || []) {
    listener({ target: { closest: () => addAction } });
  }
  const removeAction = {
    disabled: false,
    getAttribute: (name) => name === "data-detailed-remove-criterion" ? "criterion-1" : null,
  };
  for (const listener of listeners.get("click") || []) {
    listener({ target: { closest: () => removeAction } });
  }
  assert.deepEqual(calls, { add: ["criterion-1"], remove: ["criterion-1"] });
});

test("financial evaluation offers direct contractor completion without a tab-completion button", () => {
  const actions = renderDetailedEvaluationActionButtons({
    activeGroup: "financial",
    selectedBid: { id: "bid-1", label: "Nhà thầu A" },
    report: { id: "report-1", trangThai: "draft" },
  });
  assert.doesNotMatch(actions, /btn-detailed-evaluation-complete-group/);
  assert.doesNotMatch(actions, /Hoàn thành tab/);
  assert.match(actions, /id="btn-detailed-evaluation-complete-report"/);
  assert.match(actions, /Hoàn thành đánh giá nhà thầu/);
});

test("earlier evaluation tabs keep the tab-completion action for sequential navigation", () => {
  const actions = renderDetailedEvaluationActionButtons({
    activeGroup: "technical",
    selectedBid: { id: "bid-1", label: "Nhà thầu A" },
    report: { id: "report-1", trangThai: "draft" },
  });
  assert.match(actions, /id="btn-detailed-evaluation-complete-group"/);
});
