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

export function validateEvaluationReportForMode({
  mode = "complete",
  reportNumberInput,
  reportDateInput,
  optionalDateInputs = [],
} = {}) {
  if (mode === "draft") {
    const errorInputs = [];
    [reportDateInput, ...(optionalDateInputs || [])].forEach(
      (input) => validateOptionalDraftDate(input, errorInputs),
    );
    return { valid: errorInputs.length === 0, errorInputs };
  }
  return validateRequiredEvaluationReportFields({
    reportNumberInput,
    reportDateInput,
  });
}

function isValidDraftDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const day = Number(dmy?.[1] || ymd?.[3]);
  const month = Number(dmy?.[2] || ymd?.[2]);
  const year = Number(dmy?.[3] || ymd?.[1]);
  if (!dmy && !ymd) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateOptionalDraftDate(input, errorInputs) {
  if (!input || isValidDraftDate(input.value)) return;
  errorInputs.push(input);
  input.setAttribute?.("aria-invalid", "true");
  input.setCustomValidity?.("Ngày phải đúng định dạng dd/MM/yyyy.");
  setFieldFeedback(input, {
    state: "invalid",
    message: "Ngày không hợp lệ. Vui lòng nhập theo định dạng dd/MM/yyyy.",
  });
  const clearInvalid = () => {
    if (!isValidDraftDate(input.value)) return;
    setFieldFeedback(input);
    input.removeAttribute?.("aria-invalid");
    input.setCustomValidity?.("");
    input.removeEventListener?.("input", clearInvalid);
  };
  input.addEventListener?.("input", clearInvalid);
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
