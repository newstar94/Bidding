import test from "node:test";
import assert from "node:assert/strict";

import {
  findInvalidRequiredTechnicalScore,
  normalizeBidEvaluationSaveMode,
} from "../../frontend/packages/bidEvaluationActions.js";
import { validateEvaluationReportForMode } from "../../frontend/packages/bidEvaluationValidation.js";

function input(value = "") {
  return {
    value,
    disabled: false,
    ownerDocument: { querySelectorAll: () => [] },
    classList: { add() {}, remove() {} },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    removeAttribute() {},
    setCustomValidity() {},
  };
}

function rowWithScore(value) {
  const score = input(value);
  return {
    score,
    row: {
      querySelector: (selector) => selector === ".mt-dg-ky-thuat" ? score : null,
    },
  };
}

test("draft accepts empty official report fields while completion still requires them", () => {
  const reportNumberInput = input("");
  const reportDateInput = input("");

  assert.equal(validateEvaluationReportForMode({
    mode: "draft",
    reportNumberInput,
    reportDateInput,
  }).valid, true);
  assert.equal(validateEvaluationReportForMode({
    mode: "complete",
    reportNumberInput,
    reportDateInput,
  }).valid, false);
});

test("draft rejects a non-empty malformed report date", () => {
  const reportDateInput = input("31/02/2026");
  const result = validateEvaluationReportForMode({
    mode: "draft",
    reportNumberInput: input("D-01"),
    reportDateInput,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errorInputs, [reportDateInput]);
});

test("draft technical score permits empty but rejects invalid non-empty values", () => {
  const pkg = { phuongPhapDanhGia: "Kết hợp giữa kỹ thuật và giá" };
  const empty = rowWithScore("");
  const invalid = rowWithScore("Đạt");
  const valid = rowWithScore("85,5");

  assert.equal(findInvalidRequiredTechnicalScore({
    pkg,
    rows: [empty.row],
    mode: "draft",
  }), null);
  assert.equal(findInvalidRequiredTechnicalScore({
    pkg,
    rows: [invalid.row],
    mode: "draft",
  })?.input, invalid.score);
  assert.equal(findInvalidRequiredTechnicalScore({
    pkg,
    rows: [valid.row],
    mode: "draft",
  }), null);
});

test("save mode is explicit and preserves completion as the compatibility default", () => {
  assert.equal(normalizeBidEvaluationSaveMode(), "complete");
  assert.equal(normalizeBidEvaluationSaveMode({ mode: "draft" }), "draft");
  assert.equal(normalizeBidEvaluationSaveMode({ mode: "complete" }), "complete");
  assert.throws(
    () => normalizeBidEvaluationSaveMode({ mode: "preview" }),
    /Unsupported bid evaluation save mode/u,
  );
});
