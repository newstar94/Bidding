import assert from "node:assert/strict";
import test from "node:test";

import {
  getNextDetailedEvaluationTabAfterCompletion,
} from "../../frontend/packages/DetailedEvaluationSaveWorkflow.js";

const configuredGroups = ["validity", "capacity", "technical", "financial"];

test("a passed completed tab advances to the next configured tab", () => {
  assert.equal(getNextDetailedEvaluationTabAfterCompletion({
    configuredGroups,
    activeGroup: "capacity",
    groupResult: "Đạt",
    completeGroup: true,
  }), "technical");
});

test("an unsuccessful or draft save stays on the current tab", () => {
  assert.equal(getNextDetailedEvaluationTabAfterCompletion({
    configuredGroups,
    activeGroup: "capacity",
    groupResult: "Không đạt",
    completeGroup: true,
  }), "");
  assert.equal(getNextDetailedEvaluationTabAfterCompletion({
    configuredGroups,
    activeGroup: "capacity",
    groupResult: "Đạt",
    completeGroup: false,
  }), "");
});

test("the final configured tab does not advance past the workflow", () => {
  assert.equal(getNextDetailedEvaluationTabAfterCompletion({
    configuredGroups,
    activeGroup: "financial",
    groupResult: "Đạt",
    completeGroup: true,
  }), "");
});
