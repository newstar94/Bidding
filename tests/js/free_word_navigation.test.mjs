import assert from "node:assert/strict";
import test from "node:test";
import { applyWordNavigationPresentation } from "../../frontend/auth/accessContext.js";

test("free workspace hides the complete Word menu and paid workspace restores it", () => {
  const previousElement = globalThis.Element;
  globalThis.Element = class {};
  try {
    const nodes = [{}, {}, {}];
    const documentRef = { querySelectorAll(selector) {
      assert.equal(selector, "[data-word-navigation]");
      return nodes;
    } };
    applyWordNavigationPresentation({ subscription: { package_id: "free" } }, documentRef);
    assert.ok(nodes.every((node) => node.hidden && node.inert));
    applyWordNavigationPresentation({ subscription: { package_id: "gold" } }, documentRef);
    assert.ok(nodes.every((node) => !node.hidden && !node.inert));
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});
