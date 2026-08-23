import assert from "node:assert/strict";
import test from "node:test";

import {
  activateDialogAccessibility,
  deactivateDialogAccessibility,
  dialogStackMutationRequiresSync,
  handleDialogKeydown,
  handleGlobalDialogEscape,
  syncDialogStackAccessibility,
} from "../../frontend/shared/dialogAccessibility.js";

test("removing a dynamic dialog requests stack cleanup", () => {
  const removedModal = {
    nodeType: 1,
    matches: (selector) => selector === ".modal-overlay",
    querySelector: () => null,
  };

  assert.equal(dialogStackMutationRequiresSync({
    type: "childList",
    addedNodes: [],
    removedNodes: [removedModal],
  }), true);
});

class FakeElement {
  constructor(tagName, { active = false, zIndex = 0 } = {}) {
    this.tagName = tagName.toUpperCase();
    this.zIndex = zIndex;
    this.attributes = new Map();
    this.children = [];
    this.listeners = new Map();
    this.focusables = [];
    this.closeElement = null;
    this.classList = {
      active,
      contains: (name) => name === "active" && this.classList.active,
    };
  }

  setAttribute(name, value = "") { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  removeEventListener(type) { this.listeners.delete(type); }
  querySelector(selector) {
    if (selector.includes("data-close")) return this.closeElement;
    return null;
  }
  querySelectorAll() { return this.focusables; }
  contains(target) { return target === this || this.children.includes(target); }
  focus() {
    this.focused = true;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
}

function createRoot() {
  const app = new FakeElement("main");
  const lower = new FakeElement("div", { active: true, zIndex: 100 });
  const upper = new FakeElement("div", { active: true, zIndex: 200 });
  const modals = [lower, upper];
  const root = {
    body: { children: [app, lower, upper] },
    activeElement: app,
    defaultView: { getComputedStyle: (element) => ({ zIndex: String(element.zIndex) }) },
    querySelectorAll(selector) {
      if (selector === ".modal-overlay") return modals;
      if (selector === ".modal-overlay.active") {
        return modals.filter((modal) => modal.classList.active);
      }
      return [];
    },
  };
  lower.ownerDocument = root;
  upper.ownerDocument = root;
  app.ownerDocument = root;
  return { root, app, lower, upper };
}

test("only the topmost active dialog remains interactive", () => {
  const { root, app, lower, upper } = createRoot();

  assert.equal(syncDialogStackAccessibility(root), upper);
  assert.equal(app.hasAttribute("inert"), true);
  assert.equal(app.getAttribute("aria-hidden"), "true");
  assert.equal(lower.hasAttribute("inert"), true);
  assert.equal(lower.getAttribute("aria-hidden"), "true");
  assert.equal(upper.hasAttribute("inert"), false);
  assert.equal(upper.hasAttribute("aria-hidden"), false);
});

test("closing nested dialogs restores lower dialog then original background state", () => {
  const { root, app, lower, upper } = createRoot();
  app.setAttribute("data-existing", "kept");
  syncDialogStackAccessibility(root);

  upper.classList.active = false;
  syncDialogStackAccessibility(root);
  assert.equal(lower.hasAttribute("inert"), false);
  assert.equal(lower.hasAttribute("aria-hidden"), false);
  assert.equal(app.hasAttribute("inert"), true);

  lower.classList.active = false;
  syncDialogStackAccessibility(root);
  assert.equal(app.hasAttribute("inert"), false);
  assert.equal(app.hasAttribute("aria-hidden"), false);
  assert.equal(app.getAttribute("data-existing"), "kept");
});

test("pre-existing background inert state survives a dialog lifecycle", () => {
  const { root, app, lower, upper } = createRoot();
  upper.classList.active = false;
  app.setAttribute("inert", "");
  app.setAttribute("aria-hidden", "true");

  syncDialogStackAccessibility(root);
  lower.classList.active = false;
  syncDialogStackAccessibility(root);

  assert.equal(app.hasAttribute("inert"), true);
  assert.equal(app.getAttribute("aria-hidden"), "true");
});

test("Escape closes only the topmost nested dialog", () => {
  const { root, lower, upper } = createRoot();
  const closed = [];
  lower.closeElement = { click: () => closed.push("lower") };
  upper.closeElement = { click: () => closed.push("upper") };
  syncDialogStackAccessibility(root);
  const event = {
    key: "Escape",
    preventDefault() { this.defaultPrevented = true; },
  };

  assert.equal(handleGlobalDialogEscape(event, root), true);
  assert.deepEqual(closed, ["upper"]);
  assert.equal(event.defaultPrevented, true);
});

test("Tab and Shift+Tab stay inside the topmost dialog", () => {
  const { root, upper } = createRoot();
  const first = new FakeElement("button");
  const last = new FakeElement("button");
  first.ownerDocument = root;
  last.ownerDocument = root;
  upper.focusables = [first, last];
  upper.children.push(first, last);

  root.activeElement = last;
  const forward = {
    key: "Tab",
    shiftKey: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  assert.equal(handleDialogKeydown(forward, upper), true);
  assert.equal(root.activeElement, first);
  assert.equal(forward.defaultPrevented, true);

  const backward = {
    key: "Tab",
    shiftKey: true,
    preventDefault() { this.defaultPrevented = true; },
  };
  assert.equal(handleDialogKeydown(backward, upper), true);
  assert.equal(root.activeElement, last);
  assert.equal(backward.defaultPrevented, true);
});

test("closing nested dialogs restores focus to lower dialog then page trigger", async () => {
  const { root, app, lower, upper } = createRoot();
  const lowerButton = new FakeElement("button");
  lowerButton.id = "lower-action";
  lowerButton.ownerDocument = root;
  lower.children.push(lowerButton);

  activateDialogAccessibility(lower, app);
  lowerButton.focus();
  activateDialogAccessibility(upper, lowerButton);

  deactivateDialogAccessibility(upper);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(root.activeElement, lowerButton);

  deactivateDialogAccessibility(lower);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(root.activeElement, app);
});
