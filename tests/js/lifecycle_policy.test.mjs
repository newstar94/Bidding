import test from "node:test";
import assert from "node:assert/strict";

import {
  allowedTransitions,
  fieldPolicy,
  normalizeStatus,
  presentStatus,
  workflowStep,
} from "../../frontend/packages/LifecyclePolicy.js";


test("lifecycle policy normalizes legacy labels and presents stable codes", () => {
  assert.equal(normalizeStatus("Chuẩn bị"), "PREPARING");
  assert.equal(normalizeStatus("Huỷ thầu"), "CANCELLED");
  assert.equal(normalizeStatus("AWARDED"), "AWARDED");
  assert.deepEqual(presentStatus("PARTIALLY_AWARDED"), {
    label: "Đã có kết quả một phần",
    tone: "success",
    icon: "award",
  });
});


test("lifecycle policy owns transitions fields and workflow steps", () => {
  assert.deepEqual(allowedTransitions("PREPARING"), ["CANCELLED", "INVITED"]);
  assert.equal(fieldPolicy("PREPARING", "goods").editable, true);
  assert.equal(fieldPolicy("INVITED", "goods").editable, false);
  assert.equal(workflowStep("EVALUATING", "ONE_STAGE_TWO_ENVELOPE", null), "evaluation");
  assert.equal(workflowStep("AWARDED", "ONE_STAGE_ONE_ENVELOPE", null), "result");
});
