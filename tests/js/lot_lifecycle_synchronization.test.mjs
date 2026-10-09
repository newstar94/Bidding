import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeLotAndWaitForRender,
  hasSettledAwardApproval,
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
    request: () => ({ method: () => method, url: () => `http://test${path}` }),
    status: () => status,
    json: async () => body,
  };
}

test("lot finalization retains upstream bytes before browser response retention is lost", async () => {
  const events = [];
  let capture;
  const lifecycle = { packageStatus: "COMPLETED", packageRowVersion: 9 };
  const bytes = Buffer.from(JSON.stringify(lifecycle));
  const upstream = { status: () => 200, body: async () => { events.push("body-retained"); return bytes; } };
  const page = {
    waitForResponse: () => Promise.resolve({ ...response(), json: async () => { throw new Error("Network.getResponseBody: No data found for resource with given identifier"); } }),
    route: async (_matcher, handler) => { events.push("observer-installed"); capture = handler; },
    unroute: async () => events.push("observer-removed"),
  };
  const result = await finalizeLotAndWaitForRender({
    page, packageId: "package-1", roundsBefore: 0,
    expectedPackageStatus: "COMPLETED", expectedRenderedStatus: "Đã có kết quả",
    approve: async () => {
      events.push("approved");
      await capture?.({
        request: () => response().request(),
        fetch: async () => { events.push("upstream-fetched"); return upstream; },
        fulfill: async ({ response: retained, body }) => { assert.equal(retained, upstream); assert.equal(body, bytes); events.push("browser-delivered"); },
      });
    },
    waitForPageCondition: async (_page, predicate, args) => {
      assert.equal(predicate, hasRenderedLotFinalization);
      assert.equal(args.expectedVersion, 9);
      events.push("render-verified");
    },
  });
  assert.deepEqual(result, lifecycle);
  assert.deepEqual(events, ["observer-installed", "approved", "upstream-fetched", "body-retained", "browser-delivered", "observer-removed", "render-verified"]);
});

test("lot finalization matcher accepts the authoritative endpoint regardless of outcome status", () => {
  assert.equal(isLotFinalizeResponse(response(), "package-1"), true);
  assert.equal(isLotFinalizeResponse(response({ method: "GET" }), "package-1"), false);
  assert.equal(isLotFinalizeResponse(response({ status: 409 }), "package-1"), true);
  assert.equal(isLotFinalizeResponse(response({
    path: "/api/packages/package-2/lot-batches/batch-1/finalize",
  }), "package-1"), false);
});

function harness({ upstream = response(), timeout = 20_000, evaluate, waitForPageCondition } = {}) {
  const events = [];
  let matcher;
  let handler;
  const route = {
    request: () => response().request(),
    fetch: async (options) => {
      events.push("fetch");
      assert.deepEqual(options, { timeout, maxRedirects: 0, maxRetries: 0 });
      return { ...upstream, body: upstream.body || (async () => Buffer.from(JSON.stringify(await upstream.json()))) };
    },
    fulfill: async ({ response: retained, body }) => {
      events.push("fulfill");
      assert.equal(retained.status(), upstream.status());
      assert.ok(Buffer.isBuffer(body));
    },
    abort: async (code) => { assert.equal(code, "failed"); events.push("abort"); },
    fallback: async () => events.push("fallback"),
  };
  const page = {
    route: async (filter, capture) => { events.push("installed"); matcher = filter; handler = capture; },
    unroute: async (filter, capture) => {
      assert.equal(filter, matcher);
      assert.equal(capture, handler);
      events.push("removed");
    },
    ...(evaluate ? { evaluate } : {}),
  };
  const options = {
    page, packageId: "package-1", roundsBefore: 1,
    expectedPackageStatus: "COMPLETED", expectedRenderedStatus: "Đã có kết quả", timeout,
    approve: async () => { events.push("approved"); await handler(route); },
    waitForPageCondition: waitForPageCondition || (async (renderPage, predicate, args, waitOptions) => {
      events.push("rendered");
      assert.equal(renderPage, page);
      assert.equal(predicate, hasRenderedLotFinalization);
      assert.deepEqual(args, { expectedId: "package-1", expectedRounds: 2, expectedStatus: "Đã có kết quả", expectedVersion: 9 });
      assert.deepEqual(waitOptions, { timeout });
    }),
  };
  return { options, events, page, route, dispatch: () => handler(route), matches: (url) => matcher(new URL(url)) };
}

test("lot approval installs endpoint-only observation before click and preserves authoritative rendering", async () => {
  const fixture = harness();
  const result = await finalizeLotAndWaitForRender(fixture.options);
  assert.deepEqual(fixture.events, ["installed", "approved", "fetch", "fulfill", "removed", "rendered"]);
  assert.equal(result.packageRowVersion, 9);
  assert.equal(fixture.matches(response().url()), true);
  assert.equal(fixture.matches("http://test/api/packages/package-2/lot-batches/batch-1/finalize"), false);
  assert.equal(fixture.matches("http://test/api/packages/package-1/lot-batches/batch-1/finalize/extra"), false);
  assert.equal(fixture.matches("http://test/api/packages/package-1/lot-batches/batch-1/sub/finalize"), false);
});

test("lot approval removes its observer before canonical rehydration closes the approval page", async () => {
  const fixture = harness();
  const canonicalPage = { name: "canonical-page" };
  fixture.options.prepareRenderedState = async ({ lifecycle, page }) => {
    assert.equal(page, fixture.page);
    assert.equal(lifecycle.packageRowVersion, 9);
    assert.equal(fixture.events.at(-1), "removed");
    fixture.page.isClosed = () => true;
    return canonicalPage;
  };
  fixture.options.waitForPageCondition = async (page, predicate) => {
    assert.equal(page, canonicalPage);
    assert.equal(predicate, hasRenderedLotFinalization);
  };
  await finalizeLotAndWaitForRender(fixture.options);
  assert.equal(fixture.events.filter((event) => event === "removed").length, 1);
});

test("lot approval returns authoritative HTTP failure details and removes observation", async () => {
  const fixture = harness({ upstream: response({ status: 409, body: { detail: "LOT_BATCH_ALREADY_FINALIZED" } }) });
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /Lot finalize failed: HTTP 409.*LOT_BATCH_ALREADY_FINALIZED/u);
  assert.deepEqual(fixture.events, ["installed", "approved", "fetch", "fulfill", "removed"]);
});

test("lot approval reports a pre-finalize workflow failure and removes the unused interceptor", async () => {
  const fixture = harness({ evaluate: async () => 4, waitForPageCondition: async (_page, predicate, argument, options) => {
    assert.equal(predicate, hasSettledAwardApproval);
    assert.deepEqual(argument, { afterGeneration: 4 });
    assert.deepEqual(options, { timeout: 20_000 });
    return { jsonValue: async () => ({ state: "failed", kind: "sync_failed" }) };
  } });
  fixture.options.approve = async () => {};
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /Lot approval failed before finalize: sync_failed/u);
  assert.deepEqual(fixture.events, ["installed", "removed"]);
});

test("lot approval cannot hang when every completion signal is absent", async () => {
  const fixture = harness({ timeout: 20 });
  fixture.options.approve = async () => {};
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /did not yield an authoritative finalize response/u);
  assert.deepEqual(fixture.events, ["installed", "removed"]);
});

test("UI success still requires an authoritative finalize response within the deadline", async () => {
  const fixture = harness({ timeout: 20, evaluate: async () => 4,
    waitForPageCondition: async () => ({ jsonValue: async () => ({ state: "succeeded", kind: "lot" }) }),
  });
  fixture.options.approve = async () => {};
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /settled without an authoritative finalize response/u);
  assert.deepEqual(fixture.events, ["installed", "removed"]);
});

test("lot approval rejects missing package identity before arming observers", async () => {
  const fixture = harness();
  fixture.options.packageId = undefined;
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /package identity is required/u);
  assert.deepEqual(fixture.events, []);
});

test("stalled body retention aborts the intercepted request and removes observation", async () => {
  const fixture = harness({ timeout: 20, upstream: { ...response(), body: () => new Promise(() => {}) } });
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /did not yield|response body did not settle/u);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(fixture.events.includes("abort"));
  assert.equal(fixture.events.filter((event) => event === "removed").length, 1);
});

test("render convergence has a bounded deadline after observation has been removed", async () => {
  const fixture = harness({ timeout: 20, waitForPageCondition: async () => new Promise(() => {}) });
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /render did not converge/u);
  assert.equal(fixture.events.filter((event) => event === "removed").length, 1);
});

test("failed approval invocation removes its endpoint interceptor without issuing a mutation", async () => {
  const fixture = harness();
  fixture.options.approve = async () => { throw new Error("click failed"); };
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /observation failed: click failed/u);
  assert.deepEqual(fixture.events, ["installed", "removed"]);
});

for (const failingStep of ["fetch", "fulfill"]) {
  test(`upstream ${failingStep} failure aborts once and uninstalls the exact handler`, async () => {
    const fixture = harness();
    fixture.route[failingStep] = async () => { throw new Error(`${failingStep} failed`); };
    await assert.rejects(finalizeLotAndWaitForRender(fixture.options), new RegExp(`observation failed: ${failingStep} failed`, "u"));
    assert.equal(fixture.events.filter((event) => event === "abort").length, 1);
    assert.equal(fixture.events.filter((event) => event === "removed").length, 1);
  });
}

test("malformed JSON is delivered unchanged to the application and fails observation", async () => {
  const body = Buffer.from("not-json");
  const fixture = harness({ upstream: { ...response(), body: async () => body } });
  fixture.route.fulfill = async (options) => { assert.equal(options.body, body); fixture.events.push("fulfill"); };
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /observation failed/u);
  assert.ok(fixture.events.includes("fulfill"));
  assert.equal(fixture.events.includes("abort"), false);
  assert.equal(fixture.events.at(-1), "removed");
});

test("the finalize URL GET request falls through without an upstream mutation", async () => {
  const fixture = harness();
  const post = fixture.route.request;
  fixture.options.approve = async () => {
    fixture.route.request = () => ({ method: () => "GET" });
    await fixture.dispatch();
    fixture.route.request = post;
    await fixture.dispatch();
  };
  await finalizeLotAndWaitForRender(fixture.options);
  assert.equal(fixture.events.filter((event) => event === "fallback").length, 1);
  assert.equal(fixture.events.filter((event) => event === "fetch").length, 1);
});

test("partially failed route installation still attempts handler-specific removal", async () => {
  const fixture = harness();
  fixture.page.route = async () => { throw new Error("install failed"); };
  fixture.page.unroute = async () => fixture.events.push("removed");
  await assert.rejects(finalizeLotAndWaitForRender(fixture.options), /install failed/u);
  assert.deepEqual(fixture.events, ["removed"]);
});

for (const [body, error] of [
  [{ packageStatus: "PARTIALLY_COMPLETED", packageRowVersion: 8 }, /Unexpected lot lifecycle status/u],
  [{ packageStatus: "COMPLETED" }, /missing packageRowVersion/u],
]) {
  test(`authoritative lifecycle validation rejects ${JSON.stringify(body)} before UI assertions`, async () => {
    const fixture = harness({ upstream: response({ body }) });
    await assert.rejects(finalizeLotAndWaitForRender(fixture.options), error);
    assert.equal(fixture.events.includes("rendered"), false);
    assert.equal(fixture.events.at(-1), "removed");
  });
}

test("pending lot approval exposes its failure dialog as a settled operation", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: {
      dataset: {
        awardApprovalGeneration: "5",
        awardApprovalState: "pending",
      },
    },
    getElementById: () => ({
      classList: { contains: (name) => name === "active" },
      querySelector: () => ({ textContent: "Không thể phê duyệt kết quả đợt" }),
    }),
  };
  try {
    assert.deepEqual(hasSettledAwardApproval({ afterGeneration: 4 }), {
      generation: 5,
      state: "failed",
      kind: "Không thể phê duyệt kết quả đợt",
    });
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
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
