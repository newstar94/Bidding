import assert from "node:assert/strict";
import { test } from "node:test";

import {
  extractLiteralModuleSpecifiers,
  reachableModules,
} from "../../scripts/audit_frontend_reachability.mjs";


test("reachability parser includes static, dynamic, and worker module edges", () => {
  const source = `
    import "./static.js";
    export { value } from "./re-export.mjs";
    const lazy = () => import("./lazy.js?chunk=1");
    const worker = new URL("./worker.js?no-inline", import.meta.url);
    const stylesheet = new URL("./route.css", import.meta.url);
    const computed = import(\`./dynamic/\${name}.js\`);
  `;

  assert.deepEqual(extractLiteralModuleSpecifiers(source), [
    "./lazy.js?chunk=1",
    "./re-export.mjs",
    "./static.js",
    "./worker.js?no-inline",
  ]);
});

test("reachability traversal follows every dependency from explicit entrypoints", () => {
  const graph = new Map([
    ["app", ["static", "lazy"]],
    ["static", ["worker"]],
    ["lazy", []],
    ["worker", []],
    ["orphan", []],
  ]);

  assert.deepEqual(
    [...reachableModules(graph, ["app"])].sort(),
    ["app", "lazy", "static", "worker"],
  );
});
