import test from "node:test";
import assert from "node:assert/strict";

import {
  commitPackageAwardDecision,
  saveQualifiedApproval
} from "../../frontend/packages/packageEvaluationProgress.js";

test("qualified approval and award decision persist before synchronization", async () => {
  const calls = [];
  const pkg = { id: "gt-1" };
  const controller = {
    model: {
      state: { goithau: [pkg], thongtinmothau: [], nhathau: [] },
      persistData: async table => calls.push(`persist:${table}`)
    },
    autoSync: async () => calls.push("sync")
  };
  await saveQualifiedApproval(controller, pkg, { technical: { qualifiedSaved: true } });
  assert.equal(JSON.parse(pkg.danhGiaHsdtMetadata).technical.qualifiedSaved, true);
  await commitPackageAwardDecision(controller, { afterPersist: () => calls.push("render") });
  assert.deepEqual(calls, [
    "persist:goithau", "sync",
    "persist:nhathau", "persist:goithau", "persist:thongtinmothau", "render", "sync"
  ]);
});
