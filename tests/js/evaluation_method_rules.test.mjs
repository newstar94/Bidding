import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  EVALUATION_METHOD_CODES,
  EVALUATION_METHODS,
  getEvaluationMethods,
  normalizeEvaluationMethod,
  parseTechnicalScore,
  requiresTechnicalScoreInput,
  validateTechnicalScore,
} from "../../frontend/packages/evaluationMethodRules.js";
import { calculateRankings } from "../../frontend/shared/BiddingCalculations.js";

const {
  LOWEST_PRICE,
  EVALUATED_PRICE,
  FIXED_PRICE,
  COMBINED,
  TECHNICAL,
} = EVALUATION_METHODS;

const standard = [LOWEST_PRICE, EVALUATED_PRICE];
const advanced = [LOWEST_PRICE, EVALUATED_PRICE, COMBINED, TECHNICAL];
const domainCases = JSON.parse(await readFile(
  new URL("../fixtures/evaluation_domain_cases.json", import.meta.url),
  "utf8",
));

function methods(linhVuc, hinhThucLuaChon, phuongThucLuaChon) {
  return getEvaluationMethods({ linhVuc, hinhThucLuaChon, phuongThucLuaChon });
}

test("maps one-stage one-envelope packages to price methods", () => {
  for (const field of ["Hàng hóa", "Xây lắp", "Phi tư vấn", "Hỗn hợp"]) {
    assert.deepEqual(methods(field, "Đấu thầu rộng rãi", "Một giai đoạn một túi hồ sơ"), standard);
    assert.deepEqual(methods(field, "Đấu thầu hạn chế", "Một giai đoạn một túi hồ sơ"), standard);
    assert.deepEqual(methods(field, "Chào hàng cạnh tranh", "Một giai đoạn một túi hồ sơ"), standard);
  }
});

test("maps one-stage two-envelope packages using the approved five-rule table", () => {
  for (const field of ["Hàng hóa", "Xây lắp", "Phi tư vấn", "Hỗn hợp"]) {
    const expected = ["Xây lắp", "Hỗn hợp"].includes(field) ? [...standard, COMBINED] : advanced;
    assert.deepEqual(methods(field, "Đấu thầu rộng rãi", "Một giai đoạn hai túi hồ sơ"), expected);
    assert.deepEqual(methods(field, "Đấu thầu hạn chế", "Một giai đoạn hai túi hồ sơ"), expected);
  }
});

test("maps two-stage methods only for goods, construction and mixed packages", () => {
  for (const field of ["Hàng hóa", "Xây lắp", "Hỗn hợp"]) {
    assert.deepEqual(methods(field, "Đấu thầu rộng rãi", "Hai giai đoạn một túi hồ sơ"), standard);
    assert.deepEqual(methods(field, "Đấu thầu hạn chế", "Hai giai đoạn hai túi hồ sơ"), advanced);
  }
  assert.deepEqual(methods("Phi tư vấn", "Đấu thầu rộng rãi", "Hai giai đoạn một túi hồ sơ"), []);
});

test("maps consulting packages to the three approved methods", () => {
  const consulting = [LOWEST_PRICE, COMBINED, TECHNICAL];
  assert.deepEqual(methods("Tư vấn", "Đấu thầu rộng rãi", "Một giai đoạn hai túi hồ sơ"), consulting);
  assert.deepEqual(methods("Tư vấn", "Đấu thầu hạn chế", "Một giai đoạn hai túi hồ sơ"), consulting);
});

test("returns no method for combinations absent from the supplied matrix", () => {
  assert.deepEqual(methods("Tư vấn", "Chào hàng cạnh tranh", "Một giai đoạn hai túi hồ sơ"), []);
  assert.deepEqual(methods("Hàng hóa", "Chào hàng cạnh tranh", "Một giai đoạn hai túi hồ sơ"), []);
});

test("keeps direct appointment selectable through its opening and evaluation workflow", () => {
  for (const field of ["Hàng hóa", "Xây lắp", "Phi tư vấn", "Hỗn hợp"]) {
    assert.deepEqual(methods(field, "Chỉ định thầu", "Một giai đoạn một túi hồ sơ"), standard);
    assert.deepEqual(methods(field, "Chỉ định thầu", "Một giai đoạn hai túi hồ sơ"),
      ["Xây lắp", "Hỗn hợp"].includes(field) ? [...standard, COMBINED] : advanced);
  }
  assert.deepEqual(
    methods("Tư vấn", "Chỉ định thầu", "Một giai đoạn hai túi hồ sơ"),
    [LOWEST_PRICE, COMBINED, TECHNICAL],
  );
});

test("ranks qualified non-consulting bids by technical score", () => {
  const pkg = {
    linhVuc: "Hàng hóa",
    phuongPhapDanhGia: TECHNICAL,
    phanLo: "Không",
  };
  const bids = [
    { id: "a", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "85" },
    { id: "b", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "92" },
    { id: "c", danhGiaKetLuan: "Không đạt", danhGiaKyThuat: "99" },
  ];
  const { rankings } = calculateRankings(pkg, bids);
  assert.deepEqual(rankings, { b: 1, a: 2 });
});

test("combined technical/price evaluation requires a numeric technical score", () => {
  assert.equal(requiresTechnicalScoreInput(COMBINED), true);
  assert.equal(requiresTechnicalScoreInput({ phuongPhapDanhGia: COMBINED }), true);
  assert.equal(parseTechnicalScore("85,5"), 85.5);
  assert.equal(parseTechnicalScore("Đạt"), null);
  assert.equal(validateTechnicalScore("", { required: true }).valid, false);
  assert.equal(validateTechnicalScore("Không đạt", { required: true }).valid, false);
  assert.equal(validateTechnicalScore("85,5", { required: true }).valid, true);
});

test("normalizes canonical evaluation codes and every supported legacy label", () => {
  for (const vector of domainCases.methods) {
    assert.equal(normalizeEvaluationMethod(vector.input), vector.code, vector.input);
  }
  assert.equal(
    EVALUATION_METHOD_CODES.COMBINED_TECHNICAL_PRICE,
    "COMBINED_TECHNICAL_PRICE",
  );
  assert.equal(requiresTechnicalScoreInput("Kết hợp kỹ thuật và giá"), true);
  assert.equal(requiresTechnicalScoreInput("COMBINED_TECHNICAL_PRICE"), true);
});

test("technical score parser follows the shared frontend-backend contract", () => {
  for (const vector of domainCases.scores) {
    const parsed = parseTechnicalScore(vector.input);
    assert.equal(parsed !== null, vector.valid, JSON.stringify(vector.input));
    if (vector.valid) assert.equal(parsed, vector.number, JSON.stringify(vector.input));
  }
});

test("legacy combined wording ranks with canonical combined semantics", () => {
  const bids = [
    { id: "a", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "90", giaXepHang: 200 },
    { id: "b", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "80", giaXepHang: 100 },
  ];
  const canonical = calculateRankings({
    linhVuc: "Hàng hóa",
    phuongPhapDanhGia: "COMBINED_TECHNICAL_PRICE",
    trongSoKyThuat: 30,
    phanLo: "Không",
  }, structuredClone(bids));
  const legacy = calculateRankings({
    linhVuc: "Hàng hóa",
    phuongPhapDanhGia: "Kết hợp kỹ thuật và giá",
    trongSoKyThuat: 30,
    phanLo: "Không",
  }, structuredClone(bids));

  assert.deepEqual(legacy, canonical);
  assert.deepEqual(legacy.rankings, { b: 1, a: 2 });
});

test("combined rankings exclude bids whose technical value is a pass/fail label", () => {
  const pkg = {
    linhVuc: "Hàng hóa",
    phuongPhapDanhGia: COMBINED,
    phanLo: "Không",
  };
  const bids = [
    { id: "legacy", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "Đạt", giaXepHang: 1 },
    { id: "scored", danhGiaKetLuan: "Đạt", danhGiaKyThuat: "85", giaXepHang: 2 },
  ];
  assert.deepEqual(calculateRankings(pkg, bids).rankings, { scored: 1 });
});
