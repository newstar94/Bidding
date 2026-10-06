import assert from "node:assert/strict";
import test from "node:test";

import { executeDetailedEvaluationSave } from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";

function saveFixture() {
  const criterion = {
    id: "technical", stt: "1", name: "Tiêu chí kỹ thuật",
    group: "technical", resultType: "pass_fail", required: true,
  };
  const report = {
    id: "report", loaiVong: "single", trangThai: "draft",
    chiTietList: [{ id: "row", tieuChiDanhGiaId: criterion.id, ketQua: "pass", diem: null }],
    extension: {},
  };
  const pkg = {
    id: "package", rowVersion: 1, phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá",
    danhGiaHsdtMetadata: "{}",
  };
  const bid = {
    id: "bid", rowVersion: 1, goiThauId: pkg.id, danhGiaKyThuat: "Đạt",
    baoCaoDanhGiaChiTietList: [structuredClone(report)],
  };
  const alerts = [];
  const mutations = [];
  const controller = {
    model: {
      state: { goithau: [pkg], thongtinmothau: [bid], hanghoaduthaunhathau: [] },
      assertStorageTablesWritable() {},
      commitLocalMutation(...args) { mutations.push(args); },
    },
    view: { customAlert: async (...args) => alerts.push(args) },
    _detailedEvaluationCriteriaOverrides: new Map(),
    _detailedEvaluationDrafts: new Map([["package:bid:single", report]]),
    _editingDetailedEvaluationKey: "package:bid:single",
    _detailedEvaluationDirty: true,
    renderDetailedEvaluation: async () => {},
  };
  return {
    alerts, mutations, controller,
    options: {
      appController: controller,
      state: {
        pkg, bid, report, draftKey: "package:bid:single", criteriaKey: "package:single",
        roundType: "single", criteria: [criterion], baseCriteria: [criterion],
        context: { visibleGroups: ["technical"], editableGroups: ["technical"], configuredGroups: ["technical"] },
      },
      root: { querySelectorAll: () => [], querySelector: () => null },
      activeGroup: "technical",
    },
  };
}

for (const completing of ["completeGroup", "completeReport"]) {
  test(`missing technical score during ${completing} leaves the model unchanged before commit`, async () => {
    const { alerts, mutations, controller, options } = saveFixture();
    const before = structuredClone(controller.model.state);
    let commits = 0;
    const result = await executeDetailedEvaluationSave({
      ...options,
      [completing]: true,
      commit: async () => { commits += 1; return { ok: true }; },
    });

    assert.equal(result, false);
    assert.equal(commits, 0);
    assert.deepEqual(mutations, []);
    assert.deepEqual(controller.model.state, before);
    assert.equal(controller._detailedEvaluationDirty, true);
    assert.equal(controller._editingDetailedEvaluationKey, options.state.draftKey);
    assert.match(alerts[0]?.[1] || "", /điểm kỹ thuật bằng số/u);
  });
}

test("validated completion publishes the score and report to the model before staging", async () => {
  const { controller, options } = saveFixture();
  options.state.criteria[0].resultType = "score";
  options.state.criteria[0].minScore = 0;
  options.state.criteria[0].maxScore = 100;
  options.state.report.chiTietList[0].diem = 85;
  let committedBid;
  assert.equal(await executeDetailedEvaluationSave({
    ...options, completeGroup: true,
    commit: async (_controller, _tables, { changes }) => {
      committedBid = changes.upserts.thongtinmothau[0];
      assert.equal(controller.model.state.thongtinmothau[0].danhGiaKyThuat, "85");
      return { ok: true };
    },
  }), true);
  assert.deepEqual(controller.model.state.thongtinmothau[0], committedBid);
  assert.deepEqual(committedBid.baoCaoDanhGiaChiTietList[0].extension.completedGroups, ["technical"]);
});
