import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptMedicineEvaluationCriteria,
  canSeedMedicineEvaluation,
  createMedicineEvaluationCriteria,
  isMedicineEvaluationPackage,
  isLegacyMedicineTemplateCriteria,
} from "../../frontend/packages/medicineDetailedEvaluation.js";

test("medicine seed is scoped to medicine packages and does not replace saved state", () => {
  const pkg = { id: "p1", isThuoc: 1, danhGiaHsdtMetadata: {} };
  assert.equal(isMedicineEvaluationPackage(pkg), true);
  assert.equal(canSeedMedicineEvaluation(pkg, "single", []), true);
  assert.equal(isMedicineEvaluationPackage({ is_thuoc: 1 }), true);
  assert.equal(canSeedMedicineEvaluation({ ...pkg, danhGiaHsdtMetadata: { criteria: [] } }, "single", []), true);
  assert.equal(canSeedMedicineEvaluation(pkg, "single", [{ baoCaoDanhGiaChiTietList: [{ loaiVong: "single" }] }]), false);
});

test("legacy medicine template criteria are identified for empty-draft migration", () => {
  assert.equal(isLegacyMedicineTemplateCriteria([{ templateId: "bc-dgct-thuoc-v1", code: "MED_ENTITY" }]), true);
  assert.equal(isLegacyMedicineTemplateCriteria([{ templateId: "bc-dgct-thuoc-v1", code: "MED_ORG" }]), false);
});

test("empty saved medicine draft receives criteria without replacing evaluated reports", () => {
  const pkg = { id: "p1", isThuoc: 1, danhGiaHsdtMetadata: { criteria: [] } };
  const draft = { loaiVong: "single", trangThai: "draft", chiTietList: [] };
  assert.equal(canSeedMedicineEvaluation(pkg, "single", [{ baoCaoDanhGiaChiTietList: [draft] }]), true);
  assert.equal(canSeedMedicineEvaluation(pkg, "single", [{ baoCaoDanhGiaChiTietList: [{ ...draft, trangThai: "completed" }] }]), false);
  assert.equal(canSeedMedicineEvaluation(pkg, "single", [{ baoCaoDanhGiaChiTietList: [{ ...draft, chiTietList: [{ nhanXet: "Giữ nguyên" }] }] }]), false);
  assert.equal(canSeedMedicineEvaluation({ ...pkg, isThuoc: 0 }, "single", []), false);
});

test("medicine criteria adapt by bidder kind while preserving saved branch", () => {
  const pkg = { id: "p1", isThuoc: 1 };
  const criteria = createMedicineEvaluationCriteria(pkg, "single", ["validity"]);
  const independent = adaptMedicineEvaluationCriteria(criteria, { loaiNhaThau: "Hộ kinh doanh" }, null);
  assert.equal(independent.some((row) => row.code === "MED_HOUSEHOLD" || row.code === "MED_HOUSEHOLD_REG"), true);
  assert.equal(independent.some((row) => row.code === "MED_JV"), false);
  const saved = { chiTietList: [{ tieuChiDanhGiaId: criteria.find((row) => row.code === "MED_JV").id }] };
  const preserved = adaptMedicineEvaluationCriteria(criteria, { loaiNhaThau: "Hộ kinh doanh" }, saved);
  assert.equal(preserved.some((row) => row.code === "MED_JV"), true);
});
