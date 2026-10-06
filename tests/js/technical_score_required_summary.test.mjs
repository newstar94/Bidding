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
    emit(name, event = {}) {
      listeners.get(name)?.(event);
    },
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

test("technical score rejects typed and pasted letters while accepting localized decimals", () => {
  const input = fakeInput("82,5");
  const root = { querySelectorAll: () => [input] };
  configureBidTechnicalScoreInputs(root, { phuongPhapDanhGia: "Kết hợp kỹ thuật và giá" });
  let prevented = false;
  input.emit("beforeinput", {
    inputType: "insertText", data: "a",
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  input.value = "82,5abc";
  input.emit("input");
  assert.equal(input.value, "82,5");
  for (const value of ["", "9", "97,", "97,05", "82.5"]) {
    input.value = value;
    input.emit("input");
    assert.equal(input.value, value);
  }
  input.value = "Đạt";
  input.emit("input");
  assert.equal(input.value, "82.5");
  configureBidTechnicalScoreInputs(root, { phuongPhapDanhGia: "Giá thấp nhất" });
  input.value = "Đạt";
  input.emit("input");
  assert.equal(input.value, "Đạt");
});

test("technical score formats decimal commas and grouping dots on change and blur", () => {
  const input = fakeInput("97,05");
  configureBidTechnicalScoreInputs({ querySelectorAll: () => [input] }, {
    phuongPhapDanhGia: "Kết hợp kỹ thuật và giá",
  });
  for (const event of ["change", "blur"]) {
    for (const [entered, displayed] of [["97,05", "97,05"], ["82.5", "82,5"], ["1.234,56", "1.234,56"]]) {
      input.value = entered;
      input.emit(event);
      assert.equal(input.value, displayed);
    }
  }
  input.value = "97,05";
  input.emit("change");
  input.value = "abc";
  input.emit("input");
  assert.equal(input.value, "97,05");
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
  assert.equal(input.type, "text");
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
