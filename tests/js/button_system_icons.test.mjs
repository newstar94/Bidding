import assert from "node:assert/strict";
import test from "node:test";

import { enhanceButtonSystem } from "../../frontend/shared/buttonSystem.js";

test("dynamic buttons hydrate an existing lucide placeholder", async () => {
  const previousWindow = globalThis.window;
  let hydratedRoot = null;
  globalThis.window = {
    lucide: {
      createIcons({ root }) {
        hydratedRoot = root;
      },
    },
  };

  const button = {
    isConnected: true,
    id: "btn-package-goods-add",
    textContent: "Thêm hàng hóa",
    dataset: {},
    classList: {
      contains: (name) => name === "btn" || name === "btn-primary",
      add() {},
      remove() {},
    },
    matches: () => true,
    querySelector: () => ({ dataset: { lucide: "plus" } }),
    querySelectorAll: () => [],
    getAttribute: () => "",
    hasAttribute: () => false,
  };

  try {
    enhanceButtonSystem(button);
    await Promise.resolve();
    assert.equal(hydratedRoot, button);
  } finally {
    globalThis.window = previousWindow;
  }
});
