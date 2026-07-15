import test from "node:test";
import assert from "node:assert/strict";

import { reconcileRouteDataAtStartup } from "../../frontend/app/startupReconciliation.js";

test("startup reconciliation pushes pending changes before loading fresh route data", async () => {
  const calls = [];
  const controller = {
    markStartup(label) {
      calls.push(`mark:${label}`);
    },
    async autoSync() {
      calls.push("autoSync");
    },
    async forceSyncData(...args) {
      calls.push(["forceSyncData", ...args]);
    }
  };

  const result = await reconcileRouteDataAtStartup(controller);

  assert.equal(result, true);
  assert.deepEqual(calls, [
    "mark:route-data-sync:start",
    "autoSync",
    ["forceSyncData", true, true, true],
    "autoSync",
    "mark:route-data-sync:end"
  ]);
});

test("startup reconciliation falls back to local data when the server is unavailable", async () => {
  const marks = [];
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await reconcileRouteDataAtStartup({
      markStartup(label) {
        marks.push(label);
      },
      async autoSync() {
        throw new Error("offline");
      }
    });

    assert.equal(result, false);
    assert.deepEqual(marks, ["route-data-sync:start", "route-data-sync:end"]);
  } finally {
    console.warn = originalWarn;
  }
});
