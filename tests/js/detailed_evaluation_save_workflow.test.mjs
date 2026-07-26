import assert from "node:assert/strict";
import test from "node:test";

import { executeDetailedEvaluationSave } from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";

class Control {
  constructor(value = "") {
    this.value = value;
    this.focused = false;
  }

  focus() {
    this.focused = true;
  }
}

function createRow({ criterionId = "criterion-1", result = "pass" } = {}) {
  const selectedResult = {
    getAttribute: (name) => (
      name === "data-detailed-result-value" ? result : ""
    ),
  };
  const resultChoice = { getAttribute: () => "pass" };
  const fields = {
    ketQua: resultChoice,
    diem: new Control(""),
    noiDungHsdt: new Control("Nội dung hồ sơ đáp ứng"),
    nhanXet: new Control("Đáp ứng"),
  };
  return {
    fields,
    getAttribute: (name) => name === "data-detailed-criterion-id" ? criterionId : "",
    querySelector(selector) {
      const config = /data-detailed-config-field="([^"]+)"/.exec(selector)?.[1];
      if (config) return null;
      const field = /data-detailed-field="([^"]+)"/.exec(selector)?.[1];
      if (!field) return null;
      if (selector.endsWith(":checked")) return field === "ketQua" ? selectedResult : null;
      return fields[field] || null;
    },
  };
}

function createContext({ criterionOverrides = {}, result = "pass" } = {}) {
  const criterion = {
    id: "criterion-1",
    code: "VALIDITY_1",
    name: "Tư cách hợp lệ",
    stt: "1",
    group: "validity",
    resultType: "pass_fail",
    required: true,
    order: 0,
    ...criterionOverrides,
  };
  const row = createRow({ result });
  const root = {
    querySelectorAll: (selector) => (
      selector === "[data-detailed-criterion-id]" ? [row] : []
    ),
    querySelector: (selector) => (
      selector.includes('data-detailed-criterion-id="criterion-1"') ? row : null
    ),
  };
  const pkg = {
    id: "pkg-1",
    linhVuc: "Hàng hóa",
    danhGiaHsdtMetadata: "{}",
  };
  const bid = {
    id: "bid-1",
    baoCaoDanhGiaChiTietList: [{ loaiVong: "financial", id: "other-report" }],
  };
  const report = {
    id: "report-1",
    loaiVong: "single",
    trangThai: "draft",
    chiTietList: [],
    extension: { projectionPending: true },
  };
  const state = {
    pkg,
    bid,
    report,
    roundType: "single",
    criteria: [criterion],
    baseCriteria: [criterion],
    criteriaKey: "pkg-1:single",
    draftKey: "pkg-1:bid-1:single",
    context: {
      editableGroups: ["validity"],
      templateId: "bc-dgct-14a",
      templateVersion: 1,
    },
    readOnly: false,
  };
  const alerts = [];
  let renders = 0;
  const appController = {
    _detailedEvaluationCriteriaOverrides: new Map(),
    _detailedEvaluationDrafts: new Map(),
    _detailedEvaluationDirty: true,
    _editingDetailedEvaluationKey: state.draftKey,
    view: {
      customAlert: async (...args) => alerts.push(args),
    },
    renderDetailedEvaluation: () => { renders += 1; },
  };
  return { alerts, appController, bid, criterion, pkg, report, root, row, state, renders: () => renders };
}

test("save workflow completes, projects and commits one atomic report update", async () => {
  const context = createContext();
  const commits = [];
  const saved = await executeDetailedEvaluationSave({
    appController: context.appController,
    state: context.state,
    root: context.root,
    activeGroup: "validity",
    completeReport: true,
    commit: async (controller, tables) => {
      commits.push({ controller, tables });
      return { ok: true };
    },
  });

  assert.equal(saved, true);
  assert.deepEqual(commits[0].tables, ["goithau", "thongtinmothau"]);
  assert.equal(context.bid.baoCaoDanhGiaChiTietList.length, 2);
  const completed = context.bid.baoCaoDanhGiaChiTietList.find(
    (report) => report.loaiVong === "single",
  );
  assert.equal(completed.trangThai, "completed");
  assert.equal(Object.hasOwn(completed.extension, "projectionPending"), false);
  assert.equal(Object.hasOwn(completed, "nguoi_cham_id"), false);
  assert.equal(context.bid.danhGiaHopLe, "Đạt");
  assert.equal(context.bid.danhGiaKetLuan, "Đạt");
  assert.equal(JSON.parse(context.pkg.danhGiaHsdtMetadata).criteria.length, 1);
  assert.equal(context.appController._detailedEvaluationDirty, false);
  assert.equal(context.appController._editingDetailedEvaluationKey, null);
  assert.equal(context.renders(), 1);
  assert.match(context.alerts[0][1], /cập nhật báo cáo tổng quát/);
});

test("invalid custom criterion stops before commit and focuses its field", async () => {
  const context = createContext({ criterionOverrides: { name: "", isCustom: true } });
  const nameField = new Control("");
  context.row.querySelector = (selector) => (
    selector.includes('data-detailed-config-field="name"') ? nameField : null
  );
  let commits = 0;
  const saved = await executeDetailedEvaluationSave({
    appController: context.appController,
    state: context.state,
    root: context.root,
    activeGroup: "validity",
    commit: async () => {
      commits += 1;
      return { ok: true };
    },
  });

  assert.equal(saved, false);
  assert.equal(commits, 0);
  assert.equal(nameField.focused, true);
  assert.equal(context.alerts[0][0], "Tiêu chí chưa hợp lệ");
});

test("failed commit keeps the dirty draft available for retry", async () => {
  const context = createContext();
  const saved = await executeDetailedEvaluationSave({
    appController: context.appController,
    state: context.state,
    root: context.root,
    activeGroup: "validity",
    commit: async () => ({ ok: false }),
  });

  assert.equal(saved, false);
  assert.equal(context.appController._detailedEvaluationDirty, true);
  assert.equal(context.appController._editingDetailedEvaluationKey, context.state.draftKey);
  assert.equal(context.renders(), 0);
  assert.deepEqual(context.alerts, []);
});
