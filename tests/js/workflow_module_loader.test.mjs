import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as biddingWorkflowFacade from "../../frontend/packages/BiddingWorkflows.js";
import {
  importBiddingWorkflowsSequentially,
} from "../../frontend/app/WorkflowModuleLoader.js";

test("sequential bidding workflow loader preserves the exact facade export surface", async () => {
  const loaded = await importBiddingWorkflowsSequentially();

  assert.deepEqual(
    Object.keys(loaded).sort(),
    Object.keys(biddingWorkflowFacade).sort(),
  );
  for (const name of Object.keys(biddingWorkflowFacade)) {
    if ([
      "closeDetailedEvaluation",
      "importDetailedEvaluationExcel",
      "openDetailedEvaluation",
      "renderDetailedEvaluation",
      "saveDetailedEvaluation",
    ].includes(name)) continue;
    assert.equal(loaded[name], biddingWorkflowFacade[name], `export ${name}`);
  }
});

test("detailed evaluation commands stay lazy and preserve receiver and arguments", async () => {
  const calls = [];
  let imports = 0;
  const loaded = await importBiddingWorkflowsSequentially({
    importDetailedEvaluation: async () => {
      imports += 1;
      return {
        async openDetailedEvaluation(...args) {
          calls.push({ receiver: this, args });
          return "opened";
        },
      };
    },
  });
  const receiver = { command: loaded.openDetailedEvaluation };

  assert.equal(imports, 0);
  assert.equal(await receiver.command("package-1", 7), "opened");
  assert.equal(imports, 1);
  assert.deepEqual(calls, [{ receiver, args: ["package-1", 7] }]);
});

test("detailed evaluation keeps action-only graphs behind dynamic imports", () => {
  const workflowSource = readFileSync(
    new URL("../../frontend/packages/DetailedEvaluationWorkflow.js", import.meta.url),
    "utf8",
  );
  const panelSource = readFileSync(
    new URL("../../frontend/packages/detail/DetailedEvaluationPanel.js", import.meta.url),
    "utf8",
  );

  for (const moduleName of [
    "BidderGoodsWorkflow.js",
    "DetailedEvaluationImport.js",
    "DetailedEvaluationSaveWorkflow.js",
    "excelFileReader.js",
  ]) {
    assert.doesNotMatch(
      workflowSource,
      new RegExp(`^import\\s+[\\s\\S]*?from\\s+[\"'][^\"']*${moduleName.replace(".", "\\.")}[\"'];`, "mu"),
      `${moduleName} must load only for the action or tab that needs it`,
    );
  }
  assert.doesNotMatch(
    panelSource,
    /^import\s+[\s\S]*?from\s+["'][^"']*BidderGoodsWorkflow\.js["'];/mu,
    "the generic detailed-evaluation panel must not pull in bidder-goods workflows",
  );
});

test("package detail loads only the active workflow panel graph", () => {
  const source = readFileSync(
    new URL("../../frontend/packages/GoiThauDetail.js", import.meta.url),
    "utf8",
  );

  for (const moduleName of [
    "ActivityTimeline.js",
    "AwardResultDetailsPanel.js",
    "CancellationPanel.js",
    "FinancialOpeningPanel.js",
    "PackageDocumentsPanel.js",
    "PackageGoodsWorkflow.js",
    "PackageOpeningPanel.js",
    "PreparationDetailsPanel.js",
    "PreparationPanel.js",
    "QualifiedApprovalPanel.js",
  ]) {
    assert.doesNotMatch(
      source,
      new RegExp(`^import\\s+[\\s\\S]*?from\\s+[\"'][^\"']*${moduleName.replace(".", "\\.")}[\"'];`, "mu"),
      `${moduleName} must load only for its active package-detail tab`,
    );
  }
});
