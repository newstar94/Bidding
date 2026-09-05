export function beginSaveButtonFeedback(button, label = "Đang lưu…") {
  if (!button) return () => {};
  const children = button.childNodes ? [...button.childNodes] : null;
  const previousText = button.textContent;
  button.textContent = label;
  return () => {
    if (children && button.replaceChildren) button.replaceChildren(...children);
    else button.textContent = previousText;
  };
}
/**
 * Shared lifecycle for modal CRUD forms. It makes the save operation visible,
 * prevents accidental duplicate submissions, and always restores the controls
 * when validation or persistence fails.
 */
export async function runModalFormSubmission(event, submit) {
  event?.preventDefault?.();
  const form = event?.currentTarget || event?.target;
  if (!form || form.dataset?.submitState === "saving" || typeof submit !== "function") {
    return false;
  }

  const submitButton = form.querySelector?.('button[type="submit"]');
  const wasDisabled = Boolean(submitButton?.disabled);
  const restoreLabel = beginSaveButtonFeedback(submitButton);
  form.dataset.submitState = "saving";
  form.setAttribute?.("aria-busy", "true");
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute?.("aria-busy", "true");
  }

  try {
    await submit();
    return true;
  } finally {
    restoreLabel();
    form.dataset.submitState = "ready";
    form.removeAttribute?.("aria-busy");
    if (submitButton) {
      submitButton.disabled = wasDisabled;
      submitButton.removeAttribute?.("aria-busy");
    }
  }
}
