import assert from "node:assert/strict";
import test from "node:test";

import { handleDialogKeydown } from "../../frontend/shared/dialogAccessibility.js";

function keyEvent(key, shiftKey = false) {
  return {
    key,
    shiftKey,
    prevented: false,
    preventDefault() { this.prevented = true; }
  };
}

test("dialog traps Tab on the last control", () => {
  const first = { focus() { this.focused = true; }, getAttribute: () => null };
  const last = { focus() { this.focused = true; }, getAttribute: () => null };
  const modal = {
    classList: { contains: () => true },
    ownerDocument: { activeElement: last },
    querySelectorAll: () => [first, last],
    contains: () => true
  };
  const event = keyEvent("Tab");

  assert.equal(handleDialogKeydown(event, modal), true);
  assert.equal(first.focused, true);
  assert.equal(event.prevented, true);
});

test("dialog Escape invokes its close control", () => {
  const close = { click() { this.clicked = true; } };
  const modal = {
    classList: { contains: () => true },
    querySelector: () => close
  };
  const event = keyEvent("Escape");

  assert.equal(handleDialogKeydown(event, modal), true);
  assert.equal(close.clicked, true);
  assert.equal(event.prevented, true);
});
