import assert from "node:assert/strict";
import test from "node:test";

import { beginTabTransition } from "../../frontend/app/BiddingControllerUI.js";
import { resolveContractPackageIds } from "../../frontend/contracts/HopDongWorkflow.js";

test("a newer tab transition invalidates older asynchronous work", () => {
  const controller = {};
  const first = beginTabTransition(controller);
  const second = beginTabTransition(controller);

  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});

test("editing a contract preserves linked packages when package rows are not loaded", () => {
  const packageIds = resolveContractPackageIds(
    [],
    { id: "contract-1" },
    ["package-1", "package-2"],
  );

  assert.deepEqual(packageIds, ["package-1", "package-2"]);
});
