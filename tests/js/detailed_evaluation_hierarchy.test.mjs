import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateDetailedEvaluation,
  aggregateDetailedEvaluationAutomatic,
} from "../../frontend/packages/detailedEvaluationAggregation.js";
import {
  applyHierarchicalDetailedEvaluationResults,
  markHierarchicalDetailedEvaluationCriteria,
} from "../../frontend/packages/detailedEvaluationHierarchy.js";

test("parent criteria aggregate from leaves without double-counting a stored parent score", () => {
  const criteria = markHierarchicalDetailedEvaluationCriteria([
    { id: "parent", group: "technical", stt: "1", resultType: "pass_fail", required: true },
    { id: "child-a", group: "technical", stt: "1.1", parentCriterionId: "parent", resultType: "score", required: true },
    { id: "child-b", group: "technical", stt: "1.2", parentCriterionId: "parent", resultType: "score", required: true },
  ]);
  const report = applyHierarchicalDetailedEvaluationResults({
    id: "report-1",
    chiTietList: [
      { tieuChiDanhGiaId: "parent", ketQua: "pass", diem: 85 },
      { tieuChiDanhGiaId: "child-a", ketQua: "pass", diem: 40 },
      { tieuChiDanhGiaId: "child-b", ketQua: "pass", diem: 45 },
    ],
  }, criteria);

  const aggregate = aggregateDetailedEvaluation({ report, criteria, group: "technical" });
  assert.equal(aggregate.status, "Đạt");
  assert.equal(aggregate.score, 85);
  assert.equal(aggregateDetailedEvaluationAutomatic({ report, criteria, group: "technical" }), "");
});

test("parent result is derived from explicitly linked children even when STT changes", () => {
  const criteria = markHierarchicalDetailedEvaluationCriteria([
    { id: "parent", group: "technical", stt: "9", resultType: "pass_fail", required: true },
    { id: "child", group: "technical", stt: "2.1", parentCriterionId: "parent", resultType: "pass_fail", required: true },
  ]);
  const report = applyHierarchicalDetailedEvaluationResults({
    chiTietList: [{ tieuChiDanhGiaId: "child", ketQua: "fail" }],
  }, criteria);
  assert.equal(report.chiTietList.find((row) => row.tieuChiDanhGiaId === "parent").ketQua, "fail");
});
