import { focusInvalidControl, getVisibleInvalidControl } from "../app/formStateUtils.js";

let generatedValidationId = 0;

const CONTROL_SELECTOR = "input, select, textarea";

function isHidden(control) {
  const group = control?.closest?.(".form-group");
  if (group && group.offsetWidth === 0 && group.offsetHeight === 0) return true;
  return !group && control?.offsetWidth === 0 && control?.offsetHeight === 0 && control?.type !== "hidden";
}

function defaultValidity(control, rule) {
  const value = String(control?.value ?? "").trim();
  if ((rule.required ?? control?.required) && !value) return false;
  if (!value) return true;
  if ((rule.type || control?.type) === "number") {
    const number = Number(value);
    const min = rule.min ?? (control?.getAttribute?.("min") || -Infinity);
    return Number.isFinite(number) && number >= Number(min);
  }
  if ((rule.type || control?.type) === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (rule.pattern) return rule.pattern.test(value);
  return true;
}

function normalizedFieldLabel(control) {
  const documentRef = control?.ownerDocument || globalThis.document;
  const escapedId = control?.id && globalThis.CSS?.escape ? globalThis.CSS.escape(control.id) : control?.id;
  const label = control?.closest?.("label")
    || (escapedId ? documentRef?.querySelector?.(`label[for="${escapedId}"]`) : null);
  return String(
    label?.textContent
    || control?.getAttribute?.("aria-label")
    || control?.getAttribute?.("placeholder")
    || control?.name
    || "trường này",
  ).replace(/\*/g, "").replace(/\s+/g, " ").trim();
}

function fieldAction(control) {
  if (control?.tagName === "SELECT" || ["checkbox", "radio"].includes(control?.type)) return "chọn";
  if (control?.type === "file") return "tải lên";
  return "nhập";
}

export function constraintValidationMessage(control) {
  const validity = control?.validity || {};
  const label = normalizedFieldLabel(control).toLocaleLowerCase("vi-VN");
  if (validity.customError && control?.validationMessage) return control.validationMessage;
  if (validity.valueMissing) return `Vui lòng ${fieldAction(control)} ${label}.`;
  if (validity.typeMismatch) {
    if (control?.type === "email") return "Địa chỉ email chưa đúng định dạng.";
    if (control?.type === "url") return "Địa chỉ liên kết chưa đúng định dạng.";
    return `Giá trị của ${label} chưa đúng định dạng.`;
  }
  if (validity.tooShort) return `Vui lòng nhập ít nhất ${control?.minLength} ký tự.`;
  if (validity.tooLong) return `Vui lòng nhập không quá ${control?.maxLength} ký tự.`;
  if (validity.rangeUnderflow) return `Giá trị nhỏ nhất của ${label} là ${control?.min}.`;
  if (validity.rangeOverflow) return `Giá trị lớn nhất của ${label} là ${control?.max}.`;
  if (validity.stepMismatch || validity.badInput) return `Vui lòng nhập giá trị hợp lệ cho ${label}.`;
  if (validity.patternMismatch) return `Giá trị của ${label} chưa đúng định dạng yêu cầu.`;
  return "Dữ liệu chưa hợp lệ.";
}

function errorElement(control, group) {
  const documentRef = control?.ownerDocument || globalThis.document;
  const byId = control?.id ? documentRef?.getElementById?.(`${control.id}-error`) : null;
  if (byId) return byId;
  const validationKey = control?.dataset?.bfValidationKey;
  if (validationKey) {
    const dynamic = group?.querySelector?.(`[data-bf-validation-for="${validationKey}"]`);
    if (dynamic) return dynamic;
  }
  return group?.querySelector?.(
    ".error-text:not(.field-validation-error), .auth-field-error:not(.field-validation-error)",
  ) || null;
}

function ensureErrorElement(control, group) {
  const existing = errorElement(control, group);
  if (existing || !control) return existing;
  const documentRef = control.ownerDocument || globalThis.document;
  if (!documentRef?.createElement) return null;
  const validationKey = control.id || `field-${++generatedValidationId}`;
  control.dataset.bfValidationKey = validationKey;
  const error = documentRef.createElement("p");
  error.id = control.id ? `${control.id}-error` : `bf-validation-${generatedValidationId}`;
  error.className = control.closest?.("#auth-overlay")
    ? "auth-field-error field-validation-error"
    : "error-text field-validation-error";
  error.dataset.bfValidationFor = validationKey;
  const visibleControl = getVisibleInvalidControl(control);
  const authWrapper = control.closest?.(".auth-input-wrapper");
  const anchor = authWrapper || (visibleControl?.parentElement === group ? visibleControl : null);
  if (anchor?.parentElement === group) {
    group.insertBefore(error, anchor.nextSibling || null);
  } else if (group?.appendChild) {
    group.appendChild(error);
  } else {
    control.insertAdjacentElement?.("afterend", error);
  }
  return error;
}

export function setValidationError(control, message = "") {
  const group = control?.closest?.(".form-group");
  const error = message ? ensureErrorElement(control, group) : errorElement(control, group);
  group?.classList?.toggle("invalid", Boolean(message));
  control?.setAttribute?.("aria-invalid", message ? "true" : "false");
  if (error) {
    if (!error.id && control?.id) error.id = `${control.id}-error`;
    if (error.id) {
      const descriptions = new Set((control?.getAttribute?.("aria-describedby") || "").split(/\s+/).filter(Boolean));
      descriptions.add(error.id);
      control?.setAttribute?.("aria-describedby", [...descriptions].join(" "));
    }
    error.setAttribute?.("role", "alert");
    error.setAttribute?.("aria-live", "assertive");
    error.setAttribute?.("aria-atomic", "true");
    error.dataset.defaultValidationMessage ??= error.textContent || "";
    error.textContent = message || error.dataset.defaultValidationMessage;
    if (error.classList?.contains?.("auth-field-error")) error.hidden = !message;
  }
}

function bindClearOnChange(control) {
  control.__bfValidationCleanup?.();
  const clear = () => {
    const stillInvalid = control?.validity && !control.validity.valid;
    setValidationError(control, stillInvalid ? constraintValidationMessage(control) : "");
    if (stillInvalid) return;
    control.removeEventListener?.("input", clear);
    control.removeEventListener?.("change", clear);
    delete control.__bfValidationCleanup;
  };
  control.addEventListener?.("input", clear);
  control.addEventListener?.("change", clear);
  control.__bfValidationCleanup = clear;
}

export function validateForm(form, { rules = [], focus = true } = {}) {
  const configured = new Map((rules || []).map((rule) => [rule.control || rule.id, rule]));
  const controls = rules.length
    ? rules.map((rule) => typeof rule.control === "string" ? form.querySelector(`#${globalThis.CSS?.escape ? globalThis.CSS.escape(rule.control) : rule.control}`) : rule.control).filter(Boolean)
    : [...form.querySelectorAll("[required]")];
  const invalid = [];
  controls.forEach((control) => {
    if (isHidden(control)) return;
    const rule = configured.get(control) || configured.get(control.id) || {};
    const valid = typeof rule.validate === "function"
      ? Boolean(rule.validate(control.value, control))
      : (control?.validity && typeof control.validity.valid === "boolean" ? control.validity.valid : defaultValidity(control, rule));
    const group = control.closest?.(".form-group");
    if (valid) setValidationError(control, "");
    else {
      const existing = errorElement(control, group)?.textContent || "";
      setValidationError(control, rule.message || existing || constraintValidationMessage(control));
    }
    if (!valid) {
      invalid.push(control);
      bindClearOnChange(control);
    }
  });
  if (focus && invalid[0]) focusInvalidControl(invalid[0]);
  return { valid: invalid.length === 0, invalidControls: invalid };
}

export function validateNativeForm(form, { focus = true } = {}) {
  const controls = [...(form?.elements || form?.querySelectorAll?.(CONTROL_SELECTOR) || [])]
    .filter((control) => control?.matches?.(CONTROL_SELECTOR))
    .filter((control) => control.type !== "hidden" && !control.disabled && control.willValidate !== false)
    .filter((control) => !isHidden(control));
  const invalidControls = controls.filter((control) => control.validity && !control.validity.valid);
  controls.forEach((control) => {
    if (invalidControls.includes(control)) {
      setValidationError(control, constraintValidationMessage(control));
      bindClearOnChange(control);
    } else if (control.getAttribute?.("aria-invalid") === "true") {
      setValidationError(control, "");
    }
  });
  if (focus && invalidControls[0]) focusInvalidControl(invalidControls[0], { delay: 0 });
  return { valid: invalidControls.length === 0, invalidControls };
}
