import { setFieldFeedback } from "../main_controller/formStateUtils.js";
export function validateRequiredEvaluationReportFields({ reportNumberInput, reportDateInput }) {
  const errorInputs = [];
  validateRequiredInput(reportNumberInput, "input", errorInputs);
  validateRequiredInput(reportDateInput, "change", errorInputs);
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
