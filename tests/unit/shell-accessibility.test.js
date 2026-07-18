import assert from "node:assert/strict";
import test from "node:test";

import {
  handleProfileMenuKeydown,
  setDesktopSidebarCollapsed,
  setMobileSidebarOpen,
  setProfileMenuOpen,
  synchronizeProfileMenu,
  synchronizeSidebarViewport
} from "../../frontend/app/shellAccessibility.js";

function classList(...initial) {
  const values = new Set(initial);
  return {
    contains: (name) => values.has(name),
    remove: (name) => values.delete(name),
    toggle(name, force) {
      const enabled = force === undefined ? !values.has(name) : force;
      if (enabled) values.add(name);
      else values.delete(name);
      return enabled;
    }
  };
}

function element(classes = []) {
  const attributes = new Map();
  return {
    classList: classList(...classes),
    hidden: false,
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    toggleAttribute(name, enabled) { enabled ? attributes.set(name, "") : attributes.delete(name); },
    hasAttribute(name) { return attributes.has(name); },
    focus() { this.focused = true; }
  };
}

function keyEvent(key, currentTarget) {
  return {
    key,
    currentTarget,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
}

test("profile disclosure exposes state and supports arrow/Escape focus management", () => {
  const ownerDocument = { activeElement: null };
  const trigger = element();
  const first = element();
  const second = element();
  [first, second, trigger].forEach((item) => {
    item.focus = function focus() { ownerDocument.activeElement = this; this.focused = true; };
  });
  const menu = {
    ...element(),
    ownerDocument,
    querySelectorAll: () => [first, second],
    contains: (item) => item === first || item === second
  };

  const openEvent = keyEvent("ArrowDown", trigger);
  assert.equal(handleProfileMenuKeydown(openEvent, trigger, menu), true);
  assert.equal(openEvent.prevented, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(menu.hidden, false);
  assert.equal(ownerDocument.activeElement, first);

  const nextEvent = keyEvent("ArrowDown", menu);
  assert.equal(handleProfileMenuKeydown(nextEvent, trigger, menu), true);
  assert.equal(ownerDocument.activeElement, second);

  const closeEvent = keyEvent("Escape", menu);
  assert.equal(handleProfileMenuKeydown(closeEvent, trigger, menu), true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(menu.hidden, true);
  assert.equal(ownerDocument.activeElement, trigger);
});

test("external profile-menu close synchronizes hidden state and restores focus", () => {
  const trigger = element();
  const item = element();
  const ownerDocument = { activeElement: item };
  trigger.focus = () => { ownerDocument.activeElement = trigger; };
  const menu = {
    ...element(["active"]),
    ownerDocument,
    querySelectorAll: () => [item],
    contains: (candidate) => candidate === item
  };
  setProfileMenuOpen(trigger, menu, true);
  menu.classList.remove("active");

  assert.equal(synchronizeProfileMenu(trigger, menu), false);
  assert.equal(menu.hidden, true);
  assert.equal(ownerDocument.activeElement, trigger);
});

test("mobile sidebar uses inert while closed and moves focus on open/close", () => {
  const activeNavigation = element(["nav-btn", "active"]);
  const sidebar = {
    ...element(),
    querySelector: () => activeNavigation
  };
  const toggle = element();

  setMobileSidebarOpen(sidebar, toggle, false);
  assert.equal(sidebar.hasAttribute("inert"), true);
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  setMobileSidebarOpen(sidebar, toggle, true, { focus: "sidebar" });
  assert.equal(sidebar.hasAttribute("inert"), false);
  assert.equal(sidebar.hasAttribute("aria-hidden"), false);
  assert.equal(activeNavigation.focused, true);

  setMobileSidebarOpen(sidebar, toggle, false, { focus: "toggle" });
  assert.equal(toggle.focused, true);
});

test("desktop collapse and viewport transitions keep control state aligned", () => {
  const appContainer = element();
  const sidebar = element(["active"]);
  const toggle = element();
  const collapseButton = element();

  setDesktopSidebarCollapsed(appContainer, collapseButton, true);
  assert.equal(appContainer.classList.contains("sidebar-collapsed"), true);
  assert.equal(collapseButton.getAttribute("aria-expanded"), "false");

  synchronizeSidebarViewport({
    appContainer,
    sidebar,
    toggle,
    collapseButton,
    mediaQuery: { matches: false }
  });
  assert.equal(sidebar.classList.contains("active"), false);
  assert.equal(sidebar.hasAttribute("inert"), false);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});
