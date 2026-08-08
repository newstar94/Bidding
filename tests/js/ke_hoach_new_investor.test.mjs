import assert from "node:assert/strict";
import test from "node:test";

import { handlePlanInvestorChange } from "../../frontend/plans/KeHoachWorkflow.js";

test("plan investor selection delegates creation through the partner feature service", async () => {
  const calls = [];
  const controller = {
    partners: {
      async editInvestor(id) {
        calls.push(["edit", id]);
      },
    },
  };
  const target = { value: "__NEW_INVESTOR__" };

  await handlePlanInvestorChange.call(controller, { target });

  assert.equal(target.value, "");
  assert.deepEqual(calls, [
    ["edit", null],
  ]);
});

test("plan investor selection ignores existing investors", async () => {
  const controller = {
    ensureWorkflowReady() {
      assert.fail("existing investors must not load partner workflows");
    },
  };
  const target = { value: "investor-1" };

  await handlePlanInvestorChange.call(controller, { target });

  assert.equal(target.value, "investor-1");
});
