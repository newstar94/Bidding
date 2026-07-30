import assert from "node:assert/strict";
import test from "node:test";

import {
  renderTechnicalEvaluationHeader,
  renderTechnicalEvaluationMethodSelector,
  renderTechnicalPassFailRow,
  renderTechnicalScoreRow,
} from "../../frontend/packages/detail/DetailedEvaluationPanel.js";

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
});
