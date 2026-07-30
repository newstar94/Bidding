import assert from "node:assert/strict";
import test from "node:test";

import {
  TECHNICAL_EVALUATION_METHODS,
  applyTechnicalEvaluationMethod,
  resolveTechnicalEvaluationMethod,
} from "../../frontend/packages/technicalEvaluationMethod.js";
import {
  collectActiveGroupRows,
  collectConfiguredDetailedEvaluationCriteria,
} from "../../frontend/packages/DetailedEvaluationPanelController.js";
import { validateDetailedEvaluationRow } from "../../frontend/packages/detailedEvaluationValidation.js";

const { PASS_FAIL, SCORE } = TECHNICAL_EVALUATION_METHODS;

test("technical evaluation method is forced when package rules determine it", () => {
  assert.equal(resolveTechnicalEvaluationMethod({ pkg: { linhVuc: "Tư vấn" } }), SCORE);
  assert.equal(resolveTechnicalEvaluationMethod({
    pkg: { linhVuc: "Tư vấn", hinhThucLuaChon: "Chỉ định thầu" },
  }), SCORE);
  assert.equal(resolveTechnicalEvaluationMethod({
    pkg: { linhVuc: "Hàng hóa", phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá" },
  }), SCORE);
  for (const hinhThucLuaChon of [
    "Chào hàng cạnh tranh",
    "Chỉ định thầu",
    "Chỉ định thầu rút gọn",
    "Lựa chọn nhà thầu trong trường hợp đặc biệt",
  ]) {
    assert.equal(resolveTechnicalEvaluationMethod({ pkg: { hinhThucLuaChon } }), PASS_FAIL);
  }
});

test("technical evaluation method remains unknown when package information is insufficient", () => {
  assert.equal(resolveTechnicalEvaluationMethod({
    pkg: {
      linhVuc: "Hàng hóa",
      hinhThucLuaChon: "Đấu thầu rộng rãi",
      phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
      phuongPhapDanhGia: "Giá thấp nhất",
    },
  }), "");
});

test("technical evaluation method uses draft, stored metadata and imported Excel evidence", () => {
  assert.equal(resolveTechnicalEvaluationMethod({ draftMethod: SCORE }), SCORE);
  assert.equal(resolveTechnicalEvaluationMethod({
    pkg: { danhGiaHsdtMetadata: JSON.stringify({ technicalEvaluationMethod: PASS_FAIL }) },
  }), PASS_FAIL);
  assert.equal(resolveTechnicalEvaluationMethod({
    criteria: [{ group: "technical", source: "muasamcong", resultType: "score" }],
  }), SCORE);
});

test("applying a technical method only changes technical criterion result types", () => {
  const criteria = [
    { id: "technical", group: "technical", resultType: "pass_fail" },
    { id: "validity", group: "validity", resultType: "pass_fail" },
  ];
  const applied = applyTechnicalEvaluationMethod(criteria, SCORE);
  assert.equal(applied[0].resultType, "score");
  assert.equal(applied[1].resultType, "pass_fail");
});

test("acceptable is a valid completed technical result", () => {
  assert.equal(validateDetailedEvaluationRow(
    { ketQua: "acceptable" },
    { id: "technical-1", resultType: "pass_fail", required: true },
    { completing: true },
  ).valid, true);
});

test("scoring criteria require valid score limits when completing", () => {
  const invalidRange = validateDetailedEvaluationRow(
    { ketQua: "pass", diem: 80 },
    {
      id: "technical-1",
      resultType: "score",
      required: true,
      minScore: 110,
      maxScore: 100,
    },
    { completing: true },
  );
  assert.equal(invalidRange.valid, false);
  assert.equal(invalidRange.errors.some((item) => item.field === "minScore"), true);

  const missingLimits = validateDetailedEvaluationRow(
    { ketQua: "pass", diem: 80 },
    { id: "technical-2", resultType: "score", required: true },
    { completing: true },
  );
  assert.equal(missingLimits.errors.some((item) => item.field === "maxScore"), true);
  assert.equal(missingLimits.errors.some((item) => item.field === "minScore"), true);
});

test("technical score rows derive pass-fail status from the minimum score", () => {
  const criterion = {
    id: "technical-1",
    group: "technical",
    resultType: "score",
    minScore: 70,
    maxScore: 100,
  };
  const element = {
    getAttribute: () => "technical-1",
    querySelector(selector) {
      if (selector === '[data-detailed-field="diem"]') return { value: "65" };
      return null;
    },
  };
  const container = { querySelectorAll: () => [element] };
  const [row] = collectActiveGroupRows(container, { id: "report-1", chiTietList: [] }, [criterion]);
  assert.equal(row.diem, 65);
  assert.equal(row.ketQua, "fail");
});

test("score limits are collected for configured and imported criteria", () => {
  const criterion = { id: "technical-1", group: "technical", resultType: "score", isCustom: false };
  const element = {
    getAttribute: () => "technical-1",
    querySelector(selector) {
      if (selector === '[data-detailed-config-field="maxScore"]') return { value: "100" };
      if (selector === '[data-detailed-config-field="minScore"]') return { value: "70" };
      return null;
    },
  };
  const [configured] = collectConfiguredDetailedEvaluationCriteria(
    { querySelectorAll: () => [element] },
    [criterion],
  );
  assert.equal(configured.maxScore, 100);
  assert.equal(configured.minScore, 70);
});
