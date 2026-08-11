import assert from "node:assert/strict";
import test from "node:test";

import { MscApiClient } from "../../backend/integrations/muasamcong_browser/api_client.mjs";
import { MscCollectors } from "../../backend/integrations/muasamcong_browser/collectors.mjs";
import {
  ENDPOINT_PROFILES,
  ENDPOINTS,
  resolveEndpoint,
} from "../../backend/integrations/muasamcong_browser/endpoint_catalog.mjs";
import { MscSessionProvider } from "../../backend/integrations/muasamcong_browser/session_provider.mjs";
import { MscIntegrationRuntime } from "../../backend/integrations/muasamcong_browser/integration_runtime.mjs";


function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    body: { cancel: async () => undefined },
    text: async () => JSON.stringify(body),
  };
}


function browserHarness({
  networkToken = "network-token-value-1234567890",
  searchToken = "",
  fallbackToken = "fallback-token-value-1234567890",
  navigationError = null,
} = {}) {
  let requestHandler = null;
  let closeCount = 0;
  const selectorTimeouts = [];
  const page = {
    on(event, callback) {
      if (event === "request") requestHandler = callback;
    },
    setBypassCSP: async (value) => assert.equal(value, true),
    setUserAgent: async (value) => assert.match(value, /Chrome\/131/),
    goto: async () => {
      if (navigationError) throw navigationError;
      if (networkToken) {
        requestHandler?.({
          url: () => `https://muasamcong.mpi.gov.vn/api?token=${networkToken}`,
        });
      }
    },
    evaluate: async (fn, argument) => {
      if (argument) return fallbackToken;
      if (String(fn).includes("typeof window.grecaptcha")) return false;
      if (searchToken && String(fn).includes("querySelectorAll")) {
        requestHandler?.({
          url: () => `https://muasamcong.mpi.gov.vn/api?token=${searchToken}`,
        });
      }
      return undefined;
    },
    waitForSelector: async (_selector, options = {}) => {
      selectorTimeouts.push(options.timeout);
      if (searchToken) return true;
      throw new Error("missing search UI");
    },
    addScriptTag: async () => ({ loaded: true }),
    waitForFunction: async () => true,
    cookies: async () => [
      { name: "COOKIE_SUPPORT", value: "true" },
      { name: "GUEST_LANGUAGE_ID", value: "vi_VN" },
    ],
  };
  return {
    puppeteer: {
      launch: async (options) => {
        assert.equal(options.headless, "new");
        assert.ok(options.args.includes("--disable-blink-features=AutomationControlled"));
        return {
          newPage: async () => page,
          close: async () => { closeCount += 1; },
        };
      },
    },
    closeCount: () => closeCount,
    selectorTimeouts: () => selectorTimeouts,
  };
}


test("session provider coalesces callers, caches token/cookie, and closes browser", async () => {
  const harness = browserHarness();
  let launches = 0;
  const launch = harness.puppeteer.launch;
  harness.puppeteer.launch = async (...args) => {
    launches += 1;
    return launch(...args);
  };
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async () => undefined,
    clock: () => 1_000,
  });

  const [first, second] = await Promise.all([provider.acquire(), provider.acquire()]);
  const cached = await provider.acquire();

  assert.equal(launches, 1);
  assert.equal(harness.closeCount(), 1);
  assert.equal(first.token, second.token);
  assert.equal(cached.cookie, "COOKIE_SUPPORT=true; GUEST_LANGUAGE_ID=vi_VN");
  assert.deepEqual(provider.metadata(), {
    provider: "BrowserSessionV1",
    fetchedAt: first.fetchedAt,
    ageMs: 0,
    ttlMs: 1_800_000,
    hasToken: true,
    hasCookie: true,
  });
});


test("session provider skips fixed sleeps when navigation already captured a token", async () => {
  const harness = browserHarness();
  const sleeps = [];
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });

  await provider.acquire();

  assert.deepEqual(sleeps, []);
});


test("session provider stops waiting as soon as the search action captures a token", async () => {
  const harness = browserHarness({
    networkToken: "",
    searchToken: "search-token-value-1234567890",
  });
  const sleeps = [];
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
  });

  const session = await provider.acquire();

  assert.equal(session.token, "search-token-value-1234567890");
  assert.deepEqual(sleeps, []);
  assert.deepEqual(harness.selectorTimeouts(), [1_000]);
});


test("session TTL and forceRefresh both replace the cached browser session", async () => {
  const harness = browserHarness();
  let now = 1_000;
  let launches = 0;
  const launch = harness.puppeteer.launch;
  harness.puppeteer.launch = async (...args) => {
    launches += 1;
    return launch(...args);
  };
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async () => undefined,
    ttlMs: 60_000,
    clock: () => now,
  });

  await provider.acquire();
  now += 30_000;
  await provider.acquire();
  await provider.acquire({ forceRefresh: true });
  now += 60_001;
  await provider.acquire();

  assert.equal(launches, 3);
  assert.equal(harness.closeCount(), 3);
});


test("session provider refreshes in the background before the cached token expires", async () => {
  const harness = browserHarness();
  let launches = 0;
  const launch = harness.puppeteer.launch;
  harness.puppeteer.launch = async (...args) => {
    launches += 1;
    return launch(...args);
  };
  const scheduled = [];
  const cleared = [];
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async () => undefined,
    ttlMs: 120_000,
    refreshAheadMs: 60_000,
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds, unref() {} };
      scheduled.push(timer);
      return timer;
    },
    clearTimer(timer) { cleared.push(timer); },
  });

  await provider.acquire();
  assert.equal(launches, 1);
  assert.equal(scheduled[0].milliseconds, 60_000);

  await scheduled[0].callback();
  assert.equal(launches, 2);
  assert.equal(scheduled.length, 2);

  provider.invalidate();
  assert.equal(cleared.at(-1), scheduled[1]);
});


test("integration runtime starts session prewarm without blocking initialization", async () => {
  const harness = browserHarness();
  const runtime = new MscIntegrationRuntime({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
  });

  const initialized = runtime.initialize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initialized.ready, true);
  assert.equal(runtime.health().session.cached, true);
  assert.equal(harness.closeCount(), 1);
  runtime.close();
});


test("session provider keeps the source fallback when portal UI cannot emit a token", async () => {
  const harness = browserHarness({
    networkToken: "",
    navigationError: new Error("frontend failed to load"),
  });
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async () => undefined,
  });

  const session = await provider.acquire();

  assert.match(session.token, /^fallback-token/);
  assert.equal(harness.closeCount(), 1);
});


test("session provider still uses the browser when the reachability probe fails", async () => {
  const harness = browserHarness();
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => { throw new Error("probe unavailable"); },
    sleep: async () => undefined,
  });

  const session = await provider.acquire();

  assert.match(session.token, /^network-token/);
  assert.equal(harness.closeCount(), 1);
});


test("session provider closes the browser when every token path fails", async () => {
  const harness = browserHarness({ networkToken: "", fallbackToken: "" });
  const provider = new MscSessionProvider({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
    sleep: async () => undefined,
  });

  await assert.rejects(provider.acquire(), /PROCUREMENT_SESSION_FAILED/);
  assert.equal(harness.closeCount(), 1);
});


test("protected client refreshes exactly once on 401 and never returns secrets", async () => {
  const calls = [];
  const provider = {
    acquire: async () => ({ token: "old-secret-token", cookie: "old-secret-cookie" }),
    invalidate: () => calls.push("invalidate"),
    refresh: async () => ({ token: "new-secret-token", cookie: "new-secret-cookie" }),
  };
  const client = new MscApiClient({
    sessionProvider: provider,
    retries: 0,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), cookie: options.headers.cookie });
      return calls.filter((item) => typeof item === "object").length === 1
        ? response(401, {})
        : response(200, { versionList: [{ id: "revision-00" }] });
    },
  });

  const result = await client.request("PLAN_DETAIL", { id: "revision-00" });

  assert.equal(result.metadata.sessionRefreshCount, 1);
  assert.deepEqual(result.data, { versionList: [{ id: "revision-00" }] });
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.deepEqual(calls[1], "invalidate");
  assert.equal(client.health().status, "UP");
});


test("client health distinguishes session, API, schema, and upstream failures", async () => {
  const provider = {
    acquire: async () => ({ token: "token-value", cookie: "cookie-value" }),
    invalidate: () => undefined,
    refresh: async () => ({ token: "token-value", cookie: "cookie-value" }),
  };
  const client = new MscApiClient({
    sessionProvider: provider,
    retries: 0,
    fetchImpl: async () => response(500, {}),
  });

  await assert.rejects(
    client.request("PLAN_DETAIL", { id: "revision" }),
    /PROCUREMENT_UPSTREAM_UNAVAILABLE/,
  );
  assert.equal(client.health().status, "DOWN");
  await assert.rejects(
    client.request("NOT_A_REAL_OPERATION", {}),
    /PROCUREMENT_ENDPOINT_CHANGED/,
  );
  assert.equal(client.health().status, "API_CHANGED");
});


test("API circuit breaker stops repeated upstream failures until its bounded cooldown", async () => {
  let now = 0;
  let fetches = 0;
  const client = new MscApiClient({
    sessionProvider: {
      acquire: async () => ({ token: "token-value", cookie: "cookie-value" }),
    },
    retries: 0,
    circuitMs: 1_000,
    circuitFailureThreshold: 2,
    clock: () => now,
    fetchImpl: async () => {
      fetches += 1;
      return response(500, {});
    },
  });

  await assert.rejects(client.request("PLAN_DETAIL", { id: "one" }));
  await assert.rejects(client.request("PLAN_DETAIL", { id: "two" }));
  await assert.rejects(client.request("PLAN_DETAIL", { id: "blocked" }));
  assert.equal(fetches, 2);
  assert.equal(client.health().circuitOpen, true);

  now = 1_001;
  await assert.rejects(client.request("PLAN_DETAIL", { id: "after-cooldown" }));
  assert.equal(fetches, 3);
});


test("API client deduplicates identical in-flight requests", async () => {
  let fetches = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = new MscApiClient({
    sessionProvider: {
      acquire: async () => ({ token: "token-value", cookie: "cookie-value" }),
    },
    retries: 0,
    fetchImpl: async () => {
      fetches += 1;
      await gate;
      return response(200, { id: "revision-1" });
    },
  });

  const requests = [
    client.request("PLAN_DETAIL", { id: "revision-1", extra: true }),
    client.request("PLAN_DETAIL", { extra: true, id: "revision-1" }),
    client.request("PLAN_DETAIL", { id: "revision-1", extra: true }),
  ];
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  release();
  const results = await Promise.all(requests);

  assert.deepEqual(results.map((result) => result.data.id), [
    "revision-1", "revision-1", "revision-1",
  ]);
  assert.equal(client.inFlight.size, 0);
});


test("API client enforces configured concurrency across distinct requests", async () => {
  let active = 0;
  let maxActive = 0;
  let fetches = 0;
  const client = new MscApiClient({
    sessionProvider: {
      acquire: async () => ({ token: "token-value", cookie: "cookie-value" }),
    },
    retries: 0,
    maxConcurrency: 2,
    queueTimeoutMs: 5_000,
    fetchImpl: async (_url, options) => {
      fetches += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return response(200, JSON.parse(options.body));
    },
  });

  const results = await Promise.all(
    Array.from({ length: 7 }, (_, index) => (
      client.request("PLAN_DETAIL", { id: `revision-${index}` })
    )),
  );

  assert.equal(fetches, 7);
  assert.equal(maxActive, 2);
  assert.equal(results.length, 7);
  assert.deepEqual(client.health(), {
    status: "UP",
    lastFailure: null,
    circuitOpen: false,
    activeRequests: 0,
    queuedRequests: 0,
    maxConcurrency: 2,
  });
});


test("endpoint profile covers the complete WEB_DAU_THAU semantic catalog", () => {
  assert.equal(ENDPOINT_PROFILES["2026.08"], ENDPOINTS);
  const required = [
    "SEARCH", "PLAN_VERSION_LIST", "PLAN_DETAIL", "NOTICE_LDT_VERSION_LIST",
    "PROJECT_VERSION_LIST", "PROJECT_DETAIL", "NOTICE_LDT_DETAIL",
    "NOTICE_OTHER_VERSION_LIST", "NOTICE_OTHER_DETAIL", "NOTICE_ADB_DETAIL",
    "OPENING_NOTIFY", "OPENING_ROUND", "OPENING_BID", "OPENING_LOT",
    "OPENING_LOT_DETAIL", "OPENING_OTHER", "OPENING_ADB", "SELECTION_RESULT",
    "SELECTION_RESULT_OTHER", "TECHNICAL_RESULT", "CONTRACT_DETAIL",
    "CONTRACT_LINKED", "CONTRACT_TENDER", "CONTRACT_HSMT",
    "PLAN_OVERALL_DETAIL", "QUOTE_REQUEST_DETAIL",
    "PREQUALIFICATION_NOTICE_DETAIL", "INTEREST_NOTICE_DETAIL",
    "BIDO_INTEREST_NOTICE_DETAIL", "PREQUALIFICATION_OPENING_DETAIL",
    "INTEREST_OPENING_DETAIL", "PREQUALIFICATION_RESULT_DETAIL",
    "INTEREST_RESULT_DETAIL", "INPUT_RESULT_OTHER_DETAIL",
    "SHOPPING_RESULT_DETAIL", "CONTRACT_PUBLISH_FRAME_DETAIL",
  ];
  required.forEach((operation) => {
    assert.ok(operation in ENDPOINTS);
    assert.match(resolveEndpoint(operation).url, /^https:\/\/muasamcong\.mpi\.gov\.vn\//);
  });
});


test("unknown endpoint profiles fail with the stable upstream-change signal", async () => {
  assert.throws(
    () => resolveEndpoint("PLAN_DETAIL", "2099.01"),
    /PROCUREMENT_ENDPOINT_CHANGED/,
  );
  const client = new MscApiClient({
    sessionProvider: { acquire: async () => ({ token: "unused", cookie: "" }) },
    profileId: "2099.01",
  });
  await assert.rejects(
    client.request("PLAN_DETAIL", { id: "revision" }),
    /PROCUREMENT_ENDPOINT_CHANGED/,
  );
});


test("collector assembles selection and technical result data", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_DETAIL") {
        return {
          data: {
            notifyNo: "IB2600000002",
            processApply: "LDT",
            inputResultId: "selection-1",
            techReqId: "technical-1",
          },
          metadata: { profile: "2026.08", operation },
        };
      }
      if (operation === "SELECTION_RESULT") {
        return { data: { status: "APPROVED" }, metadata: { operation } };
      }
      if (operation === "TECHNICAL_RESULT") {
        return { data: { bidders: [{ id: "bidder-1" }] }, metadata: { operation } };
      }
      throw new Error("PROCUREMENT_NOT_FOUND");
    },
  };
  const collector = new MscCollectors({ client, clock: () => "2026-08-11T00:00:00Z" });

  const result = await collector.getResultBundle("IB2600000002", "notice-01");

  assert.deepEqual(result.raw.selectionResult, { status: "APPROVED" });
  assert.deepEqual(result.raw.technicalResult, { bidders: [{ id: "bidder-1" }] });
  assert.equal(result.metadata.operation, "RESULT_BUNDLE");
  assert.deepEqual(calls.map(([operation]) => operation), [
    "NOTICE_LDT_DETAIL", "SELECTION_RESULT", "TECHNICAL_RESULT",
  ]);
});


test("two-envelope opening loads the financial pack only after the source round allows it", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_DETAIL") {
        return {
          data: {
            notifyNo: "IB2600000002",
            notifyId: "notice-01",
            bidMode: "1_HTHS",
            processApply: "LDT",
          },
          metadata: { profile: "2026.08", operation },
        };
      }
      if (operation === "OPENING_ROUND" && payload.packType === 1) {
        return {
          data: { bidoBidroundMngViewDTO: { bidStatus: "OPEN_DXTC" } },
          metadata: { operation },
        };
      }
      return { data: { operation, packType: payload.packType }, metadata: { operation } };
    },
  };
  const collector = new MscCollectors({ client });

  const result = await collector.getOpeningBundle("IB2600000002", "notice-01");

  const openingCalls = calls.filter(([operation]) => operation.startsWith("OPENING_"));
  assert.equal(openingCalls.length, 10);
  assert.deepEqual(new Set(openingCalls.map(([, payload]) => payload.packType)), new Set([1, 2]));
  assert.ok(result.raw.opening_bid_2);
});


test("complete tender bundle includes revision details plus eligible opening and result data", async () => {
  const collector = new MscCollectors({ client: {} });
  const openings = [];
  const results = [];
  collector.listNoticeRevisions = async () => ({ revisions: [
    { revisionId: "notice-00", revisionNumber: "00" },
    { revisionId: "notice-01", revisionNumber: "01" },
  ] });
  collector.getNoticeRevision = async (_noticeNo, revisionId) => ({
    raw: revisionId === "notice-01"
      ? { status: "OPEN_DXTC" }
      : { status: "PUBLISHED" },
  });
  collector.getOpeningBundle = async (_noticeNo, revisionId) => {
    openings.push(revisionId);
    return { raw: { opening: revisionId } };
  };
  collector.getResultBundle = async (_noticeNo, revisionId, hints) => {
    results.push([revisionId, hints.inputResultId]);
    return { raw: { result: revisionId } };
  };

  const bundle = await collector.collectCompleteBundle({
    type: "es-notify-contractor",
    id: "notice-01",
    notifyId: "notice-01",
    notifyNo: "IB2600000002",
    inputResultId: "result-1",
  });

  assert.ok(bundle.sources.noticeDetail_00);
  assert.ok(bundle.sources.noticeDetail_01);
  assert.deepEqual(openings, ["notice-01"]);
  assert.deepEqual(results, [["notice-01", "result-1"]]);
  assert.deepEqual(bundle.sources.noticeOpening_01, { opening: "notice-01" });
  assert.deepEqual(bundle.sources.noticeResult_01, { result: "notice-01" });
});


test("complete contract bundle follows contract detail links including offline result", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "CONTRACT_DETAIL") {
        return {
          data: {
            contract: {
              contractCode: "CT-01",
              resultId: "result-1",
              isInternet: 0,
              processApply: "KQLCNT",
            },
          },
        };
      }
      return { data: { operation } };
    },
  };
  const collector = new MscCollectors({ client });

  const bundle = await collector.collectCompleteBundle({
    type: "es-ct-contract", id: "contract-1", contractCode: "CT-01",
  });

  assert.deepEqual(calls.map(([operation]) => operation), [
    "CONTRACT_DETAIL", "CONTRACT_LINKED", "SELECTION_RESULT",
  ]);
  assert.deepEqual(bundle.sources.contractSelectionResult, {
    operation: "SELECTION_RESULT",
  });
  assert.deepEqual(bundle.failures, []);
});


test("complete bundle routes every generic WEB_DAU_THAU record type", async () => {
  const genericTypes = {
    "es-plan-overall-p": "PLAN_OVERALL_DETAIL",
    "es-ycbg": "QUOTE_REQUEST_DETAIL",
    "es-notify-prequalification": "PREQUALIFICATION_NOTICE_DETAIL",
    "es-notify-interest": "INTEREST_NOTICE_DETAIL",
    "es-bido-interest-notify": "BIDO_INTEREST_NOTICE_DETAIL",
    "es-prequalification-open": "PREQUALIFICATION_OPENING_DETAIL",
    "es-interest-open": "INTEREST_OPENING_DETAIL",
    "es-prequalification-result": "PREQUALIFICATION_RESULT_DETAIL",
    "es-interest-result": "INTEREST_RESULT_DETAIL",
    "es-bide-contractor-input-result-other": "INPUT_RESULT_OTHER_DETAIL",
    "es-shopping-result": "SHOPPING_RESULT_DETAIL",
    "es-ct-publish-frame": "CONTRACT_PUBLISH_FRAME_DETAIL",
  };
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      return { data: { operation, id: payload.id }, metadata: { operation } };
    },
  };
  const collector = new MscCollectors({ client, clock: () => "2026-08-11T00:00:00Z" });

  for (const type of Object.keys(genericTypes)) {
    const result = await collector.collectCompleteBundle({ type, id: `${type}-id` });
    assert.equal(result.sources.primaryDetail.operation, genericTypes[type]);
  }

  assert.deepEqual(calls.map(([operation]) => operation), Object.values(genericTypes));
});


test("collector returns every plan revision in the upstream version list", async () => {
  const client = {
    request: async (operation) => {
      assert.equal(operation, "PLAN_VERSION_LIST");
      return {
        data: {
          versionList: [
            { id: "plan-01", planNo: "PL2600000001", planVersion: "01" },
            { id: "plan-00", planNo: "PL2600000001", planVersion: "00" },
          ],
        },
        metadata: { operation },
      };
    },
  };
  const collector = new MscCollectors({ client });

  const result = await collector.listPlanRevisions("PL2600000001");

  assert.deepEqual(result.revisions.map((row) => row.revisionNumber), ["01", "00"]);
});
