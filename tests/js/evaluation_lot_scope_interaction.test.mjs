import assert from "node:assert/strict";
import test from "node:test";

import {
  commitEvaluationLotScopeChange,
} from "../../frontend/packages/BidEvaluationWorkflow.js";
import {
  reconcileEvaluationLotScopeControls,
} from "../../frontend/packages/bidEvaluationActions.js";


test("lot scope controls commit state before a deferred coalesced rerender", () => {
  const controller = {};
  const scopeStore = {};
  const scheduled = [];
  const events = [];
  const nextScope = {
    mode: "selected",
    selectedLotIds: ["lot-1"],
    availableLotIds: ["lot-1", "lot-2"],
    batchId: null,
  };
  const arguments_ = {
    controller,
    scopeStore,
    scopeKey: "package-1:unified",
    nextScope,
    syncNavigation: () => events.push("navigation"),
    rerender: () => events.push("render"),
    schedule: (callback) => scheduled.push(callback),
  };

  commitEvaluationLotScopeChange(arguments_);
  commitEvaluationLotScopeChange(arguments_);

  assert.equal(scopeStore["package-1:unified"], nextScope);
  assert.equal(controller._explicitEvaluationLotScopes["package-1:unified"], nextScope);
  assert.deepEqual(events, ["navigation", "navigation"]);
  assert.equal(scheduled.length, 1);
  scheduled[0]();
  assert.deepEqual(events, ["navigation", "navigation", "render"]);
});


test("save reconciles the visible lot selection when a deferred render left stale scope state", () => {
  const checked = [{ getAttribute: () => "lot-1" }];
  const elements = {
    "danhgiahsdt-scope-container": {
      querySelector: () => ({ checked: true }),
    },
    "danhgiahsdt-lot-options": {
      querySelectorAll: () => checked,
    },
  };
  const scope = reconcileEvaluationLotScopeControls(
    { getActiveElement: (id) => elements[id] },
    {
      phanLo: "Có",
      phanLoList: [
        { id: "lot-1", maPhanLo: "L1" },
        { id: "lot-2", maPhanLo: "L2" },
      ],
    },
    {
      mode: "all",
      selectedLotIds: ["lot-1", "lot-2"],
      availableLotIds: ["lot-1", "lot-2"],
      batchId: null,
    },
  );

  assert.equal(scope.mode, "selected");
  assert.deepEqual(scope.selectedLotIds, ["lot-1"]);
});
