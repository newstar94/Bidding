export function setVisible(element, visible, display = "flex") {
  if (!element) return;
  element.style.display = visible ? display : "none";
}
export function setRequired(element, required) {
  if (!element) return;
  if (required) {
    element.setAttribute("required", "true");
  } else {
    element.removeAttribute("required");
  }
}
export function setDisabled(element, disabled) {
  if (!element) return;
  element.disabled = Boolean(disabled);
  if (element.id) syncCustomSelectDisabled(element);
}
export function setReadonlyVisual(element, readonly) {
  if (!element) return;
  if (readonly) {
    element.setAttribute("readonly", "true");
    element.style.pointerEvents = "none";
    element.style.background = "var(--neutral-soft)";
    element.style.cursor = "not-allowed";
  } else {
    element.removeAttribute("readonly");
    element.style.pointerEvents = "auto";
    element.style.background = "";
    element.style.cursor = "auto";
  }
}
export function setFieldFeedback(input, { state = "clear", message = "", color = "" } = {}) {
  const formGroup = input?.closest?.(".form-group") || null;
  const errorEl = (input?.id ? document.getElementById(`${input.id}-error`) : null) || formGroup?.querySelector?.(".error-text") || null;
  if (formGroup) {
    formGroup.classList.remove("invalid", "warning");
    if (state === "invalid") formGroup.classList.add("invalid");
    if (state === "warning") formGroup.classList.add("warning");
  }
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.style.color = color || "";
    errorEl.style.display = message ? "block" : "";
  }
}

export function getVisibleInvalidControl(input) {
  if (!input) return null;
  const flatpickrInput = input._flatpickr?.altInput;
  if (flatpickrInput) return flatpickrInput;
  const parent = input.parentNode;
  if (input.id && parent?.querySelector) {
    const searchableWrapper = parent.querySelector(`.custom-select-wrapper[data-select-id="${input.id}"]`);
    const searchableInput = searchableWrapper?.querySelector?.(".custom-select-search");
    if (searchableInput) return searchableInput;
    const customSelectContainer = parent.querySelector(`.custom-select-container[data-target="${input.id}"]`);
    const customSelectTrigger = customSelectContainer?.querySelector?.(".custom-select-trigger");
    if (customSelectTrigger) return customSelectTrigger;
    if (searchableWrapper) return searchableWrapper;
    if (customSelectContainer) return customSelectContainer;
  }
  return input;
}

export function focusInvalidControl(input, { delay = 300 } = {}) {
  const visibleControl = getVisibleInvalidControl(input);
  if (!visibleControl) return null;
  visibleControl.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "center" });
  setTimeout(() => {
    if (!visibleControl.hasAttribute?.("tabindex") && typeof visibleControl.focus === "function" && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(visibleControl.tagName || "")) {
      visibleControl.setAttribute?.("tabindex", "-1");
    }
    visibleControl.focus?.({ preventScroll: true });
  }, delay);
  return visibleControl;
}
import { syncCustomSelectDisabled } from "../../views/subviews/view_helpers.js";
