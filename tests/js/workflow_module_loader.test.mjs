import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as biddingWorkflowFacade from "../../frontend/packages/BiddingWorkflows.js";
import * as planWorkflows from "../../frontend/plans/KeHoachWorkflow.js";
import { installPrototypeModules } from "../../frontend/app/moduleRegistry.js";
import {
  WorkflowModuleLoader,
  importBiddingWorkflowsSequentially,
  importPlanEditorWorkflows,
  importPackageEditorWorkflows,
  workflowRequirementForMethod,
  workflowRequirementForRoute,
} from "../../frontend/app/WorkflowModuleLoader.js";

test("plan create and edit actions use the focused plan workflow graph", async () => {
  assert.equal(workflowRequirementForRoute("kehoach", "taomoi"), "plan-editor");
  assert.equal(workflowRequirementForRoute("kehoach"), null);
  for (const method of [
    "editKeHoach", "deleteKeHoach", "addBreakdownRow", "removeBreakdownRow",
    "backToPlanDraft", "savePlanBreakdown",
  ]) {
    assert.equal(workflowRequirementForMethod(method), "plan-editor", method);
  }
  // Opening a package or a bidding panel still loads its existing graph.
  assert.equal(workflowRequirementForRoute("goithau", "taomoi"), "bidding");
  assert.equal(workflowRequirementForRoute("goithau-detail"), "bidding");

  const loaded = await importPlanEditorWorkflows();
  for (const [name, implementation] of Object.entries(planWorkflows)) {
    assert.equal(loaded[name], implementation, name);
  }
  assert.equal(typeof loaded.makeSearchableSelect, "function");
  for (const name of [
    "editGoiThau", "renderDanhGiaHsdtPanel", "openDetailedEvaluation",
    "runProcurementInlineLookup", "openProcurementPlanImport",
  ]) {
    assert.equal(loaded[name], undefined, name);
  }
});

test("plan editor is single-flight, independent of full workflows, and retries a failed import", async () => {
  const calls = [];
  let attempt = 0;
  let finishImport;
  const loader = new WorkflowModuleLoader({
    importPlanEditor: () => {
      calls.push("plan-editor");
      attempt += 1;
      if (attempt === 1) return Promise.reject(new Error("temporary chunk failure"));
      return new Promise((resolve) => { finishImport = resolve; });
    },
    importBidding: () => { assert.fail("manual plan edit must not load bidding workflows"); },
    importPartner: () => { assert.fail("manual plan edit must not load partner workflows"); },
    install: (name) => calls.push(`install:${name}`),
  });

  await assert.rejects(loader.ensure("plan-editor"), /temporary chunk failure/u);
  assert.equal(loader.isReady("plan-editor"), false);
  const retry = loader.ensure("plan-editor");
  assert.equal(loader.ensure("plan-editor"), retry);
  finishImport({ editKeHoach() {} });
  await retry;
  assert.equal(loader.isReady("plan-editor"), true);
  assert.equal(loader.isReady("bidding"), false);
  assert.equal(loader.isReady("all"), false);
  await loader.ensure("plan-editor");
  assert.deepEqual(calls, ["plan-editor", "plan-editor", "install:plan-editor-workflows"]);
});

test("focused plan imports can coexist with package and full bidding commands", async () => {
  class Controller {}
  const loader = new WorkflowModuleLoader({
    install: (name, module) => installPrototypeModules(Controller, [{ name, module }]),
  });
  await loader.ensure("plan-editor");
  assert.equal(Controller.prototype.handleKeHoachSubmit, planWorkflows.handleKeHoachSubmit);
  assert.equal(Controller.prototype.savePlanBreakdown, planWorkflows.savePlanBreakdown);
  assert.equal(Controller.prototype.editGoiThau, undefined);
  await loader.ensure("package-editor");
  await loader.ensure("bidding");
  assert.equal(loader.isReady("plan-editor"), true);
  assert.equal(loader.isReady("package-editor"), true);
  assert.equal(typeof Controller.prototype.editGoiThau, "function");
  assert.equal(typeof Controller.prototype.runProcurementInlineLookup, "function");
});

test("full bidding readiness satisfies a subsequent plan editor request", async () => {
  const calls = [];
  const loader = new WorkflowModuleLoader({
    importBidding: async () => ({ editKeHoach() {} }),
    importPlanEditor: () => { assert.fail("full bidding already includes the plan editor"); },
    install: (name) => calls.push(name),
  });
  await loader.ensure("bidding");
  assert.equal(loader.isReady("plan-editor"), true);
  await loader.ensure("plan-editor");
  assert.deepEqual(calls, ["bidding-workflows"]);
});

test("package editor action uses its focused workflow graph", async () => {
  assert.equal(workflowRequirementForMethod("editGoiThau"), "package-editor");

  const loaded = await importPackageEditorWorkflows();
  for (const exportName of [
    "editGoiThau",
    "_loadPhanLoRows",
    "enforceSingleLeader",
    "makeSearchableSelect",
    "recalculatePlanTotal",
  ]) {
    assert.equal(typeof loaded[exportName], "function", exportName);
  }
  assert.equal(loaded.renderDanhGiaHsdtPanel, undefined);
  assert.equal(loaded.openDetailedEvaluation, undefined);
});

test("package editor action does not wait for the complete bidding workflow group", async () => {
  const calls = [];
  const loader = new WorkflowModuleLoader({
    importBidding: async () => {
      calls.push("bidding");
      return { renderDanhGiaHsdtPanel() {} };
    },
    importPackageEditor: async () => {
      calls.push("package-editor");
      return { editGoiThau() {} };
    },
    importPartner: async () => {
      calls.push("partner");
      return { editNhaThau() {} };
    },
    install: (name) => calls.push(`install:${name}`),
  });

  await loader.ensure(workflowRequirementForMethod("editGoiThau"));

  assert.deepEqual(calls, ["package-editor", "install:package-editor-workflows"]);
  assert.equal(loader.isReady("package-editor"), true);
  assert.equal(loader.isReady("bidding"), false);
});

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
