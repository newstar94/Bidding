import { setRuntimeStyle } from "../shared/runtimeStyles.js";
import { beginSaveButtonFeedback } from "../shared/ModalFormSubmission.js";

export function setPackageEditorState(modal, state) {
  if (!modal) return;
  modal.dataset.editorState = String(state || "");
  if (["loading", "saving", "closing"].includes(state)) {
    modal.setAttribute("aria-busy", "true");
  } else {
    modal.removeAttribute("aria-busy");
  }
}

export async function runPackageFormSubmission(controller, event) {
  event?.preventDefault?.();
  const form = event?.currentTarget || event?.target;
  if (!form || form.dataset.submitState === "saving") return false;
  const submitButton = form.querySelector?.('button[type="submit"]');
  const modal = form.closest?.(".modal-overlay");
  const restoreLabel = beginSaveButtonFeedback(submitButton);
  form.dataset.submitState = "saving";
  form.setAttribute?.("aria-busy", "true");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute?.("aria-busy", "true");
  }
  setPackageEditorState(modal, "saving");
  try {
    await controller.handleGoiThauSubmit(event);
    return true;
  } finally {
    restoreLabel();
    const editorStillActive = Boolean(modal?.classList?.contains("active"));
    form.dataset.submitState = editorStillActive ? "ready" : "saved";
    form.removeAttribute?.("aria-busy");
    setPackageEditorState(modal, editorStillActive ? "ready" : "closed");
    if (submitButton) {
      submitButton.disabled = !editorStillActive;
      submitButton.removeAttribute?.("aria-busy");
    }
  }
}

export function resetPackageFormEditableState(form) {
  if (!form) return;
  form.querySelectorAll(".form-group").forEach((group) => group.classList.remove("invalid"));
  form.querySelectorAll("input, select, textarea").forEach((element) => {
    element.disabled = false;
    const wrapper = element.parentNode.querySelector(`.custom-select-wrapper[data-select-id="${element.id}"]`);
    const searchInput = wrapper?.querySelector(".custom-select-search");
    if (searchInput) searchInput.disabled = false;
  });
  form.querySelectorAll("button").forEach((button) => {
    button.disabled = false;
    setRuntimeStyle(button, "display", "");
  });
  const submitButton = form.querySelector('button[type="submit"]');
  if (submitButton) setRuntimeStyle(submitButton, "display", "");
}
export function setPackageSubTableActionsVisible(visible) {
  const display = visible ? "" : "none";
  [
    "btn-them-giahan",
    "btn-them-yeucaulamro",
    "btn-them-traloilamro"
  ].forEach((buttonId) => {
    const button = document.getElementById(buttonId);
    if (button) setRuntimeStyle(button, "display", display);
  });
  document.querySelectorAll(
    "#giahan-table .col-action, #yeucaulamro-table .col-action, #traloilamro-table .col-action"
  ).forEach((cell) => {
    setRuntimeStyle(cell, "display", display);
  });
  document.querySelectorAll(
    "#gt-giahan-tbody .remove-gh-row-btn, #gt-yeucaulamro-tbody .remove-yc-row-btn, #gt-traloilamro-tbody .remove-tl-row-btn"
  ).forEach((button) => {
    const cell = button.closest("td");
    if (cell) setRuntimeStyle(cell, "display", display);
    setRuntimeStyle(button, "display", display);
  });
}

export function unifyTableInputsHeight(container) {
  const parent = container || document;
  const elements = parent.querySelectorAll(".data-table .form-control, #mothau-table .form-control, #danhgiahsdt-table .form-control");
  elements.forEach((element) => {
    setRuntimeStyle(element, "cssText", "height:38px!important;box-sizing:border-box!important;padding:6px 12px!important;font-size:.85rem!important;border-radius:var(--radius-md)!important");
  });
}
