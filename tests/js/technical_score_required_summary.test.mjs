import assert from "node:assert/strict";
import test from "node:test";

import {
  TECHNICAL_EVALUATION_METHODS,
  configureBidTechnicalScoreInputs,
  resolveTechnicalEvaluationMethod,
} from "../../frontend/packages/technicalEvaluationMethod.js";
import { validateRequiredEvaluationReportFields } from "../../frontend/packages/bidEvaluationValidation.js";

const { SCORE } = TECHNICAL_EVALUATION_METHODS;

function fakeInput(value = "", { ownerDocument = null, disabled = false } = {}) {
  const attributes = new Map();
  const listeners = new Map();
  return {
    value,
    disabled,
    ownerDocument,
    type: "text",
    placeholder: "",
    id: "",
    attributes,
    customValidity: "",
    closest: () => null,
    setAttribute(name, nextValue) {
      attributes.set(name, String(nextValue));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    setCustomValidity(message) {
      this.customValidity = message;
    },
    addEventListener(name, handler) {
      listeners.set(name, handler);
    },
    removeEventListener(name, handler) {
      if (listeners.get(name) === handler) listeners.delete(name);
    },
  };
}

test("combined technical-price wording without 'giữa' forces technical scoring", () => {
  assert.equal(resolveTechnicalEvaluationMethod({
    pkg: {
      linhVuc: "Hàng hóa",
      hinhThucLuaChon: "Đấu thầu rộng rãi",
      phuongPhapDanhGia: "Kết hợp kỹ thuật và giá",
    },
  }), SCORE);
});

test("combined technical-price summary uses a required numeric technical score input", () => {
  const input = fakeInput("Đạt");
  const root = {
    querySelectorAll(selector) {
      assert.equal(selector, "input.mt-dg-ky-thuat");
      return [input];
    },
  };

  assert.equal(configureBidTechnicalScoreInputs(root, {
    linhVuc: "Hàng hóa",
    hinhThucLuaChon: "Đấu thầu rộng rãi",
    phuongPhapDanhGia: "Kết hợp kỹ thuật và giá",
  }), true);
  assert.equal(input.type, "number");
  assert.equal(input.value, "");
  assert.equal(input.placeholder, "Nhập điểm kỹ thuật...");
  assert.equal(input.attributes.get("required"), "true");
  assert.equal(input.attributes.get("aria-required"), "true");
  assert.equal(input.attributes.get("data-technical-score-required"), "true");
  assert.equal(input.attributes.get("min"), "0");
  assert.equal(input.attributes.get("step"), "any");
});

test("summary save rejects Đạt/Không đạt text and requires a numeric technical score", () => {
  let technicalInput = fakeInput("Đạt");
  const ownerDocument = {
    querySelectorAll(selector) {
      assert.equal(selector, 'input.mt-dg-ky-thuat[data-technical-score-required="true"]');
      return [technicalInput];
    },
  };
  const reportNumberInput = fakeInput("BC-01", { ownerDocument });
  const reportDateInput = fakeInput("07/08/2026", { ownerDocument });

  let validation = validateRequiredEvaluationReportFields({
    reportNumberInput,
    reportDateInput,
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errorInputs.includes(technicalInput), true);
  assert.equal(technicalInput.customValidity.length > 0, true);

  technicalInput = fakeInput("82.5");
  validation = validateRequiredEvaluationReportFields({
    reportNumberInput,
    reportDateInput,
  });
  assert.equal(validation.valid, true);
});
