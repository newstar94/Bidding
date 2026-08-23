const modalState = new WeakMap();
const backgroundState = new Map();
const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");
const DIALOG_CLOSE_SELECTOR = [
  "[data-close]",
  "[data-bf-action='close-modal']",
  ".modal-close",
  "#btn-dialog-cancel"
].join(",");

function dialogZIndex(modal, ownerDocument) {
  const view = ownerDocument?.defaultView || globalThis.window;
  const computed = view?.getComputedStyle?.(modal)?.zIndex;
  const value = Number.parseInt(computed || modal?.style?.zIndex || "0", 10);
  return Number.isFinite(value) ? value : 0;
}

export function getTopmostActiveDialog(root = globalThis.document) {
  const dialogs = [...(root?.querySelectorAll?.(".modal-overlay.active") || [])];
  let topmost = null;
  let topmostZIndex = Number.NEGATIVE_INFINITY;
  dialogs.forEach((dialog) => {
    const zIndex = dialogZIndex(dialog, root);
    if (zIndex >= topmostZIndex) {
      topmost = dialog;
      topmostZIndex = zIndex;
    }
  });
  return topmost;
}

export function getFocusableElements(modal) {
  return [...(modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])]
    .filter((element) => element.getAttribute?.("aria-hidden") !== "true" && element.hidden !== true);
}

export function handleDialogKeydown(event, modal) {
  if (!modal?.classList?.contains("active")) return false;
  if (event.key === "Escape") {
    if (event.defaultPrevented || event.repeat || event.isComposing) return false;
    const topmost = getTopmostActiveDialog(modal.ownerDocument);
    if (topmost && topmost !== modal) return false;
    const close = modal.querySelector?.(DIALOG_CLOSE_SELECTOR);
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

export function handleGlobalDialogEscape(event, root = globalThis.document) {
  if (event?.key !== "Escape" || event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }
  const modal = getTopmostActiveDialog(root);
  if (!modal) return false;
  return handleDialogKeydown(event, modal);
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

function rememberBackgroundState(element) {
  if (backgroundState.has(element)) return;
  backgroundState.set(element, {
    inert: element.hasAttribute?.("inert") || false,
    ariaHidden: element.getAttribute?.("aria-hidden"),
  });
}

function restoreBackgroundState() {
  backgroundState.forEach((state, element) => {
    if (state.inert) element.setAttribute?.("inert", "");
    else element.removeAttribute?.("inert");
    if (state.ariaHidden === null || state.ariaHidden === undefined) {
      element.removeAttribute?.("aria-hidden");
    } else {
      element.setAttribute?.("aria-hidden", state.ariaHidden);
    }
  });
  backgroundState.clear();
}

function inertBackgroundForDialog(root, topmost) {
  const bodyChildren = [...(root?.body?.children || [])];
  bodyChildren.forEach((element) => {
    const tagName = String(element.tagName || "").toUpperCase();
    if (
      element === topmost
      || element.contains?.(topmost)
      || ["SCRIPT", "STYLE", "LINK", "TEMPLATE"].includes(tagName)
    ) return;
    rememberBackgroundState(element);
    element.setAttribute?.("inert", "");
    element.setAttribute?.("aria-hidden", "true");
  });
}

export function syncDialogStackAccessibility(root = globalThis.document) {
  restoreBackgroundState();
  const modals = [...(root?.querySelectorAll?.(".modal-overlay") || [])];
  const topmost = getTopmostActiveDialog(root);
  modals.forEach((modal) => {
    const active = modal.classList.contains("active");
    const accessible = active && modal === topmost;
    if (accessible) {
      modal.removeAttribute?.("inert");
      modal.removeAttribute?.("aria-hidden");
    } else {
      modal.setAttribute?.("inert", "");
      modal.setAttribute?.("aria-hidden", "true");
    }
    if (active) activateDialogAccessibility(modal);
    else deactivateDialogAccessibility(modal);
  });
  if (topmost) inertBackgroundForDialog(root, topmost);
  return topmost;
}

export function dialogStackMutationRequiresSync(mutation) {
  if (mutation?.type === "attributes" && mutation.target?.matches?.(".modal-overlay")) {
    return true;
  }
  const changedNodes = [
    ...(mutation?.addedNodes || []),
    ...(mutation?.removedNodes || []),
  ];
  return changedNodes.some((node) => (
    node?.nodeType === 1
    && (
      node.matches?.(".modal-overlay")
      || node.querySelector?.(".modal-overlay")
    )
  ));
}

export function installDialogAccessibility(root = globalThis.document) {
  if (!root?.querySelectorAll || !globalThis.MutationObserver) return null;
  root.addEventListener?.("keydown", (event) => handleGlobalDialogEscape(event, root));
  syncDialogStackAccessibility(root);
  const observer = new MutationObserver((mutations) => {
    let shouldSync = false;
    mutations.forEach((mutation) => {
      if (dialogStackMutationRequiresSync(mutation)) shouldSync = true;
    });
    if (shouldSync) syncDialogStackAccessibility(root);
  });
  observer.observe(root.documentElement || root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  return observer;
}
