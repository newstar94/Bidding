import assert from "node:assert/strict";
import test from "node:test";

import { createFeatureServices } from "../../frontend/app/FeatureServices.js";


test("feature services preserve lazy workflow loading behind domain interfaces", async () => {
  const calls = [];
  const controller = {
    async ensureWorkflowReady(method) {
      calls.push(["ensure", method]);
    },
    editKeHoach(id) {
      calls.push(["edit", id, this === controller]);
      return `edited:${id}`;
    },
    editGoiThau(id) {
      calls.push(["package", id, this === controller]);
      return `package:${id}`;
    },
  };
  const services = createFeatureServices(controller);

  assert.equal(await services.plans.edit("plan-1"), "edited:plan-1");
  assert.equal(await services.packages.edit("package-1"), "package:package-1");
  assert.deepEqual(calls, [
    ["ensure", "editKeHoach"],
    ["edit", "plan-1", true],
    ["ensure", "editGoiThau"],
    ["package", "package-1", true],
  ]);
  assert.equal(Object.isFrozen(services.plans), true);
});
