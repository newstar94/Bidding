import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";

test("workspace memory reset aborts and replaces every registered request map", () => {
  const model = new BiddingModel();
  const pagination = new AbortController();
  const hydration = new AbortController();
  model._paginationRequests = new Map([["goithau", pagination]]);
  model._planPackageHydrationRequests = new Map([[
    "plan-a",
    { controller: hydration, promise: Promise.resolve([]) },
  ]]);

  model._resetWorkspaceMemory();

  assert.equal(pagination.signal.aborted, true);
  assert.equal(hydration.signal.aborted, true);
  assert.equal(model._paginationRequests.size, 0);
  assert.equal(model._planPackageHydrationRequests.size, 0);
});
