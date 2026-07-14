import { focusInvalidControl } from "../app/formStateUtils.js";

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

function errorElement(control, group) {
  return group?.querySelector?.(".error-text") || (control?.id ? globalThis.document?.getElementById?.(`${control.id}-error`) : null);
}

export function setValidationError(control, message = "") {
  const group = control?.closest?.(".form-group");
  const error = errorElement(control, group);
  group?.classList?.toggle("invalid", Boolean(message));
  control?.setAttribute?.("aria-invalid", message ? "true" : "false");
  if (error) {
    if (!error.id && control?.id) error.id = `${control.id}-error`;
    if (error.id) control?.setAttribute?.("aria-describedby", error.id);
    error.dataset.defaultValidationMessage ??= error.textContent || "";
    error.textContent = message || error.dataset.defaultValidationMessage;
  }
}

export function validationErrorSummary(invalidControls = []) {
  return invalidControls.map((control) => ({
    id: control?.id || "",
    label: control?.labels?.[0]?.textContent?.trim?.() || control?.name || control?.id || "Trường dữ liệu",
    message: errorElement(control, control?.closest?.(".form-group"))?.textContent || "Dữ liệu không hợp lệ."
  }));
}

function renderValidationSummary(form, invalidControls) {
  if (!form?.ownerDocument?.createElement || !form.querySelector) return;
  let summary = form.querySelector("[data-form-error-summary]");
  if (invalidControls.length === 0) {
    summary?.remove?.();
    return;
  }
  if (!summary) {
    summary = form.ownerDocument.createElement("div");
    summary.dataset.formErrorSummary = "true";
    summary.className = "form-error-summary";
    summary.setAttribute("role", "alert");
    summary.setAttribute("aria-live", "assertive");
    summary.setAttribute("tabindex", "-1");
    form.prepend?.(summary);
  }
  summary.replaceChildren();
  const heading = form.ownerDocument.createElement("strong");
  heading.textContent = `Vui lòng kiểm tra ${invalidControls.length} trường sau:`;
  const list = form.ownerDocument.createElement("ul");
  validationErrorSummary(invalidControls).forEach((item, index) => {
    const row = form.ownerDocument.createElement("li");
    const button = form.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = `${item.label}: ${item.message}`;
    button.addEventListener("click", () => focusInvalidControl(invalidControls[index]));
    row.appendChild(button);
    list.appendChild(row);
  });
  summary.append(heading, list);
}

function bindClearOnChange(control, group) {
  control.__bfValidationCleanup?.();
  const clear = () => {
    setValidationError(control, "");
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
    const valid = typeof rule.validate === "function" ? Boolean(rule.validate(control.value, control)) : defaultValidity(control, rule);
    const group = control.closest?.(".form-group");
    if (valid) setValidationError(control, "");
    else {
      const existing = errorElement(control, group)?.textContent || "Dữ liệu không hợp lệ.";
      setValidationError(control, rule.message || existing);
    }
    if (!valid) {
      invalid.push(control);
      bindClearOnChange(control, group);
    }
  });
  renderValidationSummary(form, invalid);
  if (focus && invalid[0]) focusInvalidControl(invalid[0]);
  return { valid: invalid.length === 0, invalidControls: invalid };
}
