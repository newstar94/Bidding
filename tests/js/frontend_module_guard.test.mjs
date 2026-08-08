import assert from "node:assert/strict";
import test from "node:test";

import { findImportCycles } from "../../scripts/check_frontend_modules.mjs";


test("frontend module guard reports each static import cycle once", () => {
  const graph = new Map([
    ["a.js", ["b.js"]],
    ["b.js", ["c.js"]],
    ["c.js", ["a.js"]],
    ["leaf.js", []],
  ]);

  assert.deepEqual(findImportCycles(graph), [[
    "a.js",
    "b.js",
    "c.js",
    "a.js",
  ]]);
});
