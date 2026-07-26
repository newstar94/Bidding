import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkflowModuleLoader,
  workflowRequirementForMethod,
  workflowRequirementForRoute,
} from "../../frontend/app/WorkflowModuleLoader.js";

test("workflow routes load only the module group they use", () => {
  assert.equal(workflowRequirementForRoute("mothau"), "bidding");
  assert.equal(workflowRequirementForRoute("danhgiahsdt"), "bidding");
  assert.equal(workflowRequirementForRoute("goithau-detail"), "bidding");
  assert.equal(workflowRequirementForRoute("kehoach", "taomoi"), "bidding");
  assert.equal(workflowRequirementForRoute("goithau", "taomoi"), "bidding");
  assert.equal(workflowRequirementForRoute("chudautu", "taomoi"), "partner");
  assert.equal(workflowRequirementForRoute("nhathau", "taomoi"), "partner");
  assert.equal(workflowRequirementForRoute("chuyengia", "taomoi"), "partner");
  assert.equal(workflowRequirementForRoute("hopdong", "taomoi"), "partner");
  assert.equal(workflowRequirementForRoute("dashboard"), null);
  assert.equal(workflowRequirementForRoute("unknown", "taomoi"), "all");
});

test("workflow commands resolve to their owning module group", () => {
  assert.equal(workflowRequirementForMethod("editGoiThau"), "bidding");
  assert.equal(workflowRequirementForMethod("saveKetQuaChiDinhThau"), "bidding");
  assert.equal(workflowRequirementForMethod("editNhaThau"), "partner");
  assert.equal(workflowRequirementForMethod("deleteHopDong"), "partner");
  assert.equal(workflowRequirementForMethod("triggerExcelImport"), null);
  assert.equal(workflowRequirementForMethod("unknownWorkflow"), "all");
});

test("loader installs only the requested workflow and reuses an in-flight promise", async () => {
  let releaseBidding;
  const pendingBidding = new Promise((resolve) => {
    releaseBidding = resolve;
  });
  const calls = [];
  const installed = [];
  const loader = new WorkflowModuleLoader({
    importBidding: () => {
      calls.push("bidding");
      return pendingBidding;
    },
    importPartner: async () => {
      calls.push("partner");
      return { editNhaThau() {} };
    },
    install: (name, module) => installed.push([name, module]),
  });

  const first = loader.ensure("bidding");
  const second = loader.ensure("bidding");
  assert.equal(first, second);
  assert.deepEqual(calls, ["bidding"]);
  assert.equal(loader.isReady("bidding"), false);
  assert.equal(loader.isReady("partner"), false);

  releaseBidding({ editGoiThau() {} });
  await first;

  assert.equal(loader.isReady("bidding"), true);
  assert.equal(loader.isReady("partner"), false);
  assert.deepEqual(installed.map(([name]) => name), ["bidding-workflows"]);
});

test("failed workflow import can be retried", async () => {
  let attempts = 0;
  const loader = new WorkflowModuleLoader({
    importBidding: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary chunk failure");
      return { editGoiThau() {} };
    },
    importPartner: async () => ({}),
    install: () => {},
  });

  await assert.rejects(loader.ensure("bidding"), /temporary chunk failure/);
  assert.equal(loader.isReady("bidding"), false);
  await loader.ensure("bidding");
  assert.equal(attempts, 2);
  assert.equal(loader.isReady("bidding"), true);
});

test("compatibility loader installs both workflow groups", async () => {
  const calls = [];
  const loader = new WorkflowModuleLoader({
    importBidding: async () => {
      calls.push("bidding");
      return {};
    },
    importPartner: async () => {
      calls.push("partner");
      return {};
    },
    install: () => {},
  });

  const first = loader.ensure("all");
  const second = loader.ensure("all");
  assert.equal(first, second);
  await first;

  assert.deepEqual(calls.sort(), ["bidding", "partner"]);
  assert.equal(loader.isReady("all"), true);
});
