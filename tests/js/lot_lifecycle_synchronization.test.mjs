import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeLotAndWaitForRender,
  hasRenderedLotFinalization,
  isLotFinalizeResponse,
} from "../../scripts/lib/lotLifecycleSynchronization.mjs";

function response({
  path = "/api/packages/package-1/lot-batches/batch-1/finalize",
  method = "POST",
  status = 200,
  body = { packageStatus: "COMPLETED", packageRowVersion: 9 },
} = {}) {
  return {
    url: () => `http://test${path}`,
    request: () => ({ method: () => method }),
    status: () => status,
    json: async () => body,
  };
}

test("lot finalization matcher accepts only the authoritative package transition", () => {
  assert.equal(isLotFinalizeResponse(response(), "package-1"), true);
  assert.equal(isLotFinalizeResponse(response({ method: "GET" }), "package-1"), false);
  assert.equal(isLotFinalizeResponse(response({ status: 201 }), "package-1"), false);
  assert.equal(isLotFinalizeResponse(response({
    path: "/api/packages/package-2/lot-batches/batch-1/finalize",
  }), "package-1"), false);
});

test("lot approval arms the response wait before clicking and waits for rendered version", async () => {
  const events = [];
  let responsePredicate;
  let renderedWait;
  const page = {
    waitForResponse(predicate) {
      events.push("response-armed");
      responsePredicate = predicate;
      return Promise.resolve(response());
    },
  };
  const result = await finalizeLotAndWaitForRender({
    page,
    packageId: "package-1",
    roundsBefore: 1,
    expectedPackageStatus: "COMPLETED",
    expectedRenderedStatus: "Đã có kết quả",
    approve: async () => events.push("approve-clicked"),
    waitForPageCondition: async (...args) => {
      events.push("render-waited");
      renderedWait = args;
    },
  });

  assert.deepEqual(events, ["response-armed", "approve-clicked", "render-waited"]);
  assert.equal(responsePredicate(response()), true);
  assert.equal(renderedWait[1], hasRenderedLotFinalization);
  assert.deepEqual(renderedWait[2], {
    expectedId: "package-1",
    expectedRounds: 2,
    expectedStatus: "Đã có kết quả",
    expectedVersion: 9,
  });
  assert.deepEqual(renderedWait[3], { timeout: 20_000 });
  assert.equal(result.packageRowVersion, 9);
});

test("lot approval rejects the wrong lifecycle status before waiting for render", async () => {
  let renderWaited = false;
  await assert.rejects(finalizeLotAndWaitForRender({
    page: {
      waitForResponse: () => Promise.resolve(response({
        body: { packageStatus: "PARTIALLY_COMPLETED", packageRowVersion: 8 },
      })),
    },
    packageId: "package-1",
    roundsBefore: 0,
    expectedPackageStatus: "COMPLETED",
    expectedRenderedStatus: "Đã có kết quả",
    approve: async () => {},
    waitForPageCondition: async () => { renderWaited = true; },
  }), /Unexpected lot lifecycle status/);
  assert.equal(renderWaited, false);
});

test("lot approval requires the authoritative package row version", async () => {
  await assert.rejects(finalizeLotAndWaitForRender({
    page: {
      waitForResponse: () => Promise.resolve(response({
        body: { packageStatus: "COMPLETED" },
      })),
    },
    packageId: "package-1",
    roundsBefore: 0,
    expectedPackageStatus: "COMPLETED",
    expectedRenderedStatus: "Đã có kết quả",
    approve: async () => {},
    waitForPageCondition: async () => {},
  }), /missing packageRowVersion/);
});

test("render convergence uses the route-owned semantic package projection", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById: () => ({
      dataset: {
        renderedPackageId: "package-1",
        renderedPackageStatus: "Đã có kết quả",
        renderedPackageRowVersion: "9",
        renderedWorkflowTab: "result",
        renderedRenderVersion: "4",
        pendingRenderVersion: "4",
      },
    }),
    querySelectorAll: () => [{}, {}],
  };
  try {
    assert.equal(hasRenderedLotFinalization({
      expectedId: "package-1",
      expectedRounds: 2,
      expectedStatus: "Đã có kết quả",
      expectedVersion: 9,
    }), true);
    assert.equal(hasRenderedLotFinalization({
      expectedId: "package-1",
      expectedRounds: 2,
      expectedStatus: "Đã có kết quả",
      expectedVersion: 8,
    }), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
