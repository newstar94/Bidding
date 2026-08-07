import { setFieldFeedback } from "../app/formStateUtils.js";
import { parseTechnicalScore } from "./technicalEvaluationMethod.js";

export function validateRequiredEvaluationReportFields({ reportNumberInput, reportDateInput }) {
  const errorInputs = [];
  validateRequiredInput(reportNumberInput, "input", errorInputs);
  validateRequiredInput(reportDateInput, "change", errorInputs);
  const documentRef = reportNumberInput?.ownerDocument
    || reportDateInput?.ownerDocument
    || globalThis.document;
  documentRef?.querySelectorAll?.('input.mt-dg-ky-thuat[data-technical-score-required="true"]')
    .forEach((input) => validateRequiredTechnicalScore(input, errorInputs));
  return {
    valid: errorInputs.length === 0,
    errorInputs
  };
}

function validateRequiredInput(input, clearEvent, errorInputs) {
  if (!input || input.value.trim()) return;
  errorInputs.push(input);
  setFieldFeedback(input, { state: "invalid" });
  const clearInvalid = () => {
    setFieldFeedback(input);
    input.removeEventListener(clearEvent, clearInvalid);
  };
  input.addEventListener(clearEvent, clearInvalid);
}

function validateRequiredTechnicalScore(input, errorInputs) {
  if (!input || input.disabled) return;
  if (parseTechnicalScore(input.value) !== null) {
    input.removeAttribute?.("aria-invalid");
    input.setCustomValidity?.("");
    return;
  }
  errorInputs.push(input);
  input.setAttribute?.("aria-invalid", "true");
  input.setCustomValidity?.("Vui lòng nhập điểm kỹ thuật bằng số không âm.");
  setFieldFeedback(input, {
    state: "invalid",
    message: "Vui lòng nhập điểm kỹ thuật bằng số.",
  });
  const clearInvalid = () => {
    if (parseTechnicalScore(input.value) === null) return;
    setFieldFeedback(input);
    input.removeAttribute?.("aria-invalid");
    input.setCustomValidity?.("");
    input.removeEventListener("input", clearInvalid);
  };
  input.addEventListener("input", clearInvalid);
}
