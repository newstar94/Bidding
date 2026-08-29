import assert from "node:assert/strict";
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
    assert.equal(loaded[name], biddingWorkflowFacade[name], `export ${name}`);
  }
});
