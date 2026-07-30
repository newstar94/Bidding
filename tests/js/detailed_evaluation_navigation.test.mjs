import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDetailedEvaluationNavigation,
  buildDetailedEvaluationNavigation,
  parseDetailedEvaluationNavigation,
  serializeDetailedEvaluationNavigation,
} from "../../frontend/packages/detailedEvaluationNavigation.js";

test("restores the exact detailed evaluation screen after a reload", () => {
  const currentController = {
    currentEvaluationView: "contractor-detail",
    currentDanhGiaTab: "unified",
    selectedEvaluationBidId: "bid-2",
    selectedDetailedEvaluationTab: "technical",
    _evaluationLotScopes: {
      "package-1:unified": {
        mode: "selected",
        selectedLotIds: ["lot-2"],
        availableLotIds: ["lot-1", "lot-2"],
        batchId: null,
      },
    },
    view: {
      _currentWorkflowPackageId: "package-1",
      _currentWorkflowTab: "eval_tech",
    },
  };
  const navigation = buildDetailedEvaluationNavigation(currentController, "package-1");
  const url = serializeDetailedEvaluationNavigation(
    "https://example.test/goi-thau-chi-tiet/GT-01?existing=kept",
    navigation,
  );

  const freshController = { view: {} };
  const restored = applyDetailedEvaluationNavigation(
    freshController,
    parseDetailedEvaluationNavigation(url),
    "package-1",
  );

  assert.equal(restored, true);
  assert.equal(freshController.currentEvaluationView, "contractor-detail");
  assert.equal(freshController.currentDanhGiaTab, "unified");
  assert.equal(freshController.selectedEvaluationBidId, "bid-2");
  assert.equal(freshController.selectedDetailedEvaluationTab, "technical");
  assert.equal(freshController.view._currentWorkflowPackageId, "package-1");
  assert.equal(freshController.view._currentWorkflowTab, "eval_tech");
  assert.deepEqual(freshController._evaluationLotScopes["package-1:unified"], {
    mode: "selected",
    selectedLotIds: ["lot-2"],
    availableLotIds: ["lot-2"],
    batchId: null,
  });
  assert.equal(new URL(url).searchParams.get("existing"), "kept");
});

test("does not restore detailed evaluation state for a different package", () => {
  const url = serializeDetailedEvaluationNavigation(
    "https://example.test/goi-thau-chi-tiet/GT-01",
    {
      packageId: "package-1",
      view: "contractor-detail",
      workflowTab: "eval_fin",
      round: "financial",
      bidId: "bid-1",
      detailTab: "financial",
      lotMode: "all",
      lotIds: ["lot-1"],
    },
  );
  const freshController = { view: {} };

  assert.equal(
    applyDetailedEvaluationNavigation(
      freshController,
      parseDetailedEvaluationNavigation(url),
      "package-2",
    ),
    false,
  );
  assert.equal(freshController.currentEvaluationView, undefined);
});
