import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { beginWorkspaceRequest } from "../../frontend/app/workspaceLease.js";

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

test("workspace transition aborts every model-wide loader request", () => {
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a" };
  const request = beginWorkspaceRequest(model);

  model.beginWorkspaceTransition();

  assert.equal(request.signal.aborted, true);
  assert.equal(request.signal.reason?.code, "WORKSPACE_CHANGED");
  assert.equal(model._workspaceRequestControllers.size, 0);
});
