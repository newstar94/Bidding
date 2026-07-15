const modalState = new WeakMap();
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

export function getFocusableElements(modal) {
  return [...(modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])]
    .filter((element) => element.getAttribute?.("aria-hidden") !== "true" && element.hidden !== true);
}

export function handleDialogKeydown(event, modal) {
  if (!modal?.classList?.contains("active")) return false;
  if (event.key === "Escape") {
    const close = modal.querySelector?.("[data-close], .modal-close, #btn-dialog-cancel");
    close?.click?.();
    event.preventDefault?.();
    return true;
  }
  if (event.key !== "Tab") return false;
  const focusable = getFocusableElements(modal);
  if (focusable.length === 0) {
    modal.focus?.();
    event.preventDefault?.();
    return true;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = modal.ownerDocument?.activeElement;
  if (event.shiftKey && (active === first || !modal.contains?.(active))) {
    last.focus?.();
    event.preventDefault?.();
    return true;
  }
  if (!event.shiftKey && active === last) {
    first.focus?.();
    event.preventDefault?.();
    return true;
  }
  return false;
}

export function activateDialogAccessibility(modal, trigger = null) {
  if (!modal || modalState.has(modal)) return;
  const ownerDocument = modal.ownerDocument || globalThis.document;
  const restoreTarget = trigger || ownerDocument?.activeElement || null;
  const card = modal.querySelector?.(".modal-card") || modal;
  card.setAttribute?.("role", "dialog");
  card.setAttribute?.("aria-modal", "true");
  if (!card.getAttribute?.("aria-labelledby")) {
    const title = card.querySelector?.("h1, h2, h3, [data-dialog-title]");
    if (title) {
      title.id ||= `${modal.id || "dialog"}-title`;
      card.setAttribute?.("aria-labelledby", title.id);
    }
  }
  if (!card.hasAttribute?.("tabindex")) card.setAttribute?.("tabindex", "-1");
  const onKeydown = (event) => handleDialogKeydown(event, modal);
  modal.addEventListener?.("keydown", onKeydown);
  modalState.set(modal, {
    restoreTarget,
    restoreTargetId: restoreTarget?.id || "",
    ownerDocument,
    onKeydown
  });
  queueMicrotask(() => (getFocusableElements(modal)[0] || card).focus?.());
}

export function deactivateDialogAccessibility(modal) {
  const state = modalState.get(modal);
  if (!state) return;
  modal.removeEventListener?.("keydown", state.onKeydown);
  modalState.delete(modal);
  const restoreFocus = () => {
    const target = state.restoreTarget?.isConnected !== false
      ? state.restoreTarget
      : state.ownerDocument?.getElementById?.(state.restoreTargetId);
    target?.focus?.();
  };
  queueMicrotask(restoreFocus);
  // Closing a routed modal may synchronously rerender and replace its trigger.
  // Retry after that render so focus lands on the new element with the same ID.
  setTimeout(restoreFocus, 0);
}

export function installDialogAccessibility(root = globalThis.document) {
  if (!root?.querySelectorAll || !globalThis.MutationObserver) return null;
  const syncModal = (modal) => {
    if (modal.classList.contains("active")) activateDialogAccessibility(modal);
    else deactivateDialogAccessibility(modal);
  };
  root.querySelectorAll(".modal-overlay").forEach(syncModal);
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.target.matches?.(".modal-overlay")) syncModal(mutation.target);
      mutation.addedNodes?.forEach?.((node) => {
        if (node.nodeType !== 1) return;
        if (node.matches?.(".modal-overlay")) syncModal(node);
        node.querySelectorAll?.(".modal-overlay").forEach(syncModal);
      });
    });
  });
  observer.observe(root.documentElement || root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return observer;
}
