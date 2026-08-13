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

  const concurrent = await Promise.all(
    Array.from({ length: 10 }, () => provider.acquire()),
  );
  const [first, second] = concurrent;
  const cached = await provider.acquire();

  assert.equal(launches, 1);
  assert.equal(harness.closeCount(), 1);
  assert.equal(first.token, second.token);
  assert.equal(new Set(concurrent.map((session) => session.token)).size, 1);
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


test("integration runtime leaves session bootstrap lazy until a protected request", async () => {
  const harness = browserHarness();
  const runtime = new MscIntegrationRuntime({
    puppeteer: harness.puppeteer,
    fetchImpl: async () => ({ body: { cancel: async () => undefined } }),
  });

  const initialized = runtime.initialize();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(initialized.ready, true);
  assert.equal(runtime.health().session.cached, false);
  assert.equal(harness.closeCount(), 0);
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
    recaptchaSiteKey: "test-recaptcha-site-key",
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
    "OPENING_NOTIFY", "OPENING_ROUND", "OPENING_SUBMISSION", "OPENING_BID", "OPENING_LOT",
    "OPENING_LOT_DETAIL", "OPENING_FINANCIAL_DETAIL", "OPENING_FINANCIAL_AVAILABLE",
    "OPENING_OTHER", "OPENING_ADB", "SELECTION_RESULT",
    "SELECTION_RESULT_OTHER", "TECHNICAL_RESULT", "CONTRACT_DETAIL",
    "SELECTION_RESULT_BY_BID_ID", "SELECTION_RESULT_DECISION",
    "SELECTION_RESULT_REPLACEMENT", "NOTICE_TENDER_INFO", "NOTICE_HSMT",
    "NOTICE_PETITION", "NOTICE_CLARIFICATION", "NOTICE_PREBID_CONFERENCE",
    "NOTICE_PHASE_TWO", "NOTICE_HSMT_PHASE_TWO", "NOTICE_CONTRACT_LIST",
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


test("two-envelope opening loads financial data only after the source round allows it", async () => {
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
      if (operation === "OPENING_FINANCIAL_AVAILABLE") {
        return { data: true, metadata: { operation } };
      }
      return { data: { operation, packType: payload.packType }, metadata: { operation } };
    },
  };
  const collector = new MscCollectors({ client });

  const result = await collector.getOpeningBundle("IB2600000002", "notice-01");

  const openingCalls = calls.filter(([operation]) => operation.startsWith("OPENING_"));
  assert.equal(openingCalls.length, 8);
  assert.deepEqual(
    new Set(openingCalls.map(([, payload]) => payload.packType).filter((value) => value != null)),
    new Set([1, 2]),
  );
  assert.ok(result.raw.opening_bid_2);
  assert.ok(result.raw.opening_financial_detail_2);
  assert.deepEqual(
    calls.find(([operation]) => operation === "OPENING_FINANCIAL_AVAILABLE"),
    ["OPENING_FINANCIAL_AVAILABLE", { id: "notice-01" }],
  );
});


test("opening calls lot endpoints only when the source marks the package multi-lot", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_DETAIL") return {
        data: {
          notifyNo: "IB2600000003", notifyId: "notice-01",
          bidMode: "1_MTHS", processApply: "LDT",
        },
        metadata: { operation },
      };
      if (operation === "OPENING_ROUND") return {
        data: { bidoBidroundMngViewDTO: { isMultiLot: 1, bidStatus: "OPEN_BID" } },
        metadata: { operation },
      };
      return { data: { operation }, metadata: { operation } };
    },
  };

  const result = await new MscCollectors({ client }).getOpeningBundle(
    "IB2600000003", "notice-01",
  );

  assert.ok(result.raw.opening_lot_0);
  assert.ok(result.raw.opening_lot_detail_0);
  assert.deepEqual(calls.filter(([operation]) => [
    "OPENING_LOT", "OPENING_LOT_DETAIL",
  ].includes(operation)).map(([operation]) => operation).sort(), [
    "OPENING_LOT", "OPENING_LOT_DETAIL",
  ]);
});


test("complete tender bundle captures sidecars, opening, result and contracts per revision", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_VERSION_LIST") return {
        data: { versionList: [{
          id: "notice-01", notifyNo: "IB2600000002", notifyVersion: "01", processApply: "LDT",
        }] }, metadata: { operation },
      };
      if (operation === "NOTICE_OTHER_VERSION_LIST") throw new Error("PROCUREMENT_NOT_FOUND");
      if (operation === "NOTICE_LDT_DETAIL") return {
        data: {
          notifyNo: "IB2600000002", notifyId: "notice-01", notifyVersion: "01",
          bidMode: "1_MTHS", processApply: "LDT", status: "PUB_KQLCNT",
          bidOpenId: "opening-1", inputResultId: "result-1", planNo: "PL2600000001",
          bidNo: "BP2600000001",
          bidoBidStatus: { status: "OPEN_DXKT", successBidOpenDate: "2026-03-01T09:22:35" },
        }, metadata: { operation },
      };
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [{ id: "plan-01", planVersion: "01" }] }, metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") return {
        data: {
          planNo: "PL2600000001",
          packages: [{
            idDetail: "plan-package-1",
            bidNo: "BP2600000001",
            bidName: "Gói từ kế hoạch",
          }],
        },
        metadata: { operation },
      };
      if (["NOTICE_PETITION", "NOTICE_CLARIFICATION", "NOTICE_PREBID_CONFERENCE"].includes(operation)) {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      if (operation === "OPENING_ROUND") return {
        data: { bidoBidroundMngViewDTO: { isMultiLot: 0, bidStatus: "PUB_KQLCNT" } },
        metadata: { operation },
      };
      if (operation === "NOTICE_CONTRACT_LIST") return {
        data: [{ contractCode: "HD-01", contractDate: "2026-01-01" }], metadata: { operation },
      };
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor", id: "notice-01", notifyId: "notice-01",
    notifyNo: "IB2600000002", inputResultId: "result-1", bidOpenId: "opening-1",
    processApply: "LDT", bidMode: "1_MTHS", statusForNotify: "DXT",
  });

  assert.equal(bundle.schemaVersion, "biddingflow-muasamcong-raw-bundle-v2");
  assert.equal(bundle.entity.kind, "NOTICE");
  assert.equal(bundle.revisions["01"].sources.tenderInfo.success, true);
  assert.equal(bundle.revisions["01"].sources.hsmt.success, true);
  assert.equal(bundle.revisions["01"].sources.planPackageDetail.success, true);
  assert.deepEqual(
    calls.find(([operation]) => operation === "PLAN_PACKAGE_DETAIL"),
    ["PLAN_PACKAGE_DETAIL", { id: "plan-package-1" }],
  );
  assert.equal(bundle.revisions["01"].sources.petition.absent, true);
  assert.equal(bundle.revisions["01"].sources.opening_bid_0.success, true);
  assert.equal(bundle.revisions["01"].sources.selectionResult.success, true);
  assert.equal(bundle.revisions["01"].statusForNotify, "DXT");
  assert.equal(bundle.revisions["01"].sourceStatus, "OPEN_DXKT");
  assert.equal(bundle.sources.contractList.response[0].contractCode, "HD-01");
  assert.equal(bundle.status, "FOUND_COMPLETE");
  assert.equal(calls.some(([operation]) => operation === "OPENING_LOT"), false);
});


test("invitation tender bundle stops before opening, result and contract endpoints", async () => {
  const calls = [];
  const forbidden = new Set([
    "NOTICE_CONTRACT_LIST",
    "SELECTION_RESULT",
    "SELECTION_RESULT_OTHER",
    "TECHNICAL_RESULT",
  ]);
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      assert.equal(operation.startsWith("OPENING_"), false);
      assert.equal(forbidden.has(operation), false);
      if (operation === "NOTICE_LDT_VERSION_LIST") return {
        data: { versionList: [{
          id: "notice-00", notifyNo: "IB2600374868",
          notifyVersion: "00", processApply: "LDT",
        }] },
        metadata: { operation },
      };
      if (operation === "NOTICE_OTHER_VERSION_LIST") {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      if (operation === "NOTICE_LDT_DETAIL") return {
        data: {
          notifyNo: "IB2600374868", notifyId: "notice-00",
          notifyVersion: "00", processApply: "LDT", bidMode: "1_MTHS",
          planNo: "PL2600184109", bidNo: "BP2600291019",
          statusForNotify: "DXT", inputResultId: "result-1",
          techReqId: "technical-1", bidOpenId: "opening-1",
          bidoBidStatus: {
            status: "OPEN_DXKT",
            successBidOpenDate: "2026-08-03T13:08:42",
          },
        },
        metadata: { operation },
      };
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [{
          id: "plan-00", planNo: "PL2600184109", planVersion: "00",
        }] },
        metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") return {
        data: {
          planNo: "PL2600184109",
          packages: [{
            idDetail: "plan-package-1", bidNo: "BP2600291019",
            bidName: "Goi thau dang xet thau",
          }],
        },
        metadata: { operation },
      };
      if ([
        "NOTICE_PETITION", "NOTICE_CLARIFICATION", "NOTICE_PREBID_CONFERENCE",
      ].includes(operation)) {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor", id: "notice-00", notifyId: "notice-00",
    notifyNo: "IB2600374868", processApply: "LDT", bidMode: "1_MTHS",
    statusForNotify: "DXT", bidOpenId: "opening-1", inputResultId: "result-1",
    techReqId: "technical-1",
  }, { detailLevel: "INVITATION" });

  assert.equal(bundle.detailLevel, "INVITATION");
  assert.equal(bundle.revisions["00"].sources.tenderInfo.success, true);
  assert.equal(bundle.revisions["00"].sources.hsmt.success, true);
  assert.equal(bundle.revisions["00"].sources.planPackageDetail.success, true);
  assert.equal(bundle.metrics.collector.openings, 0);
  assert.equal(bundle.metrics.collector.results, 0);
  assert.equal(bundle.metrics.collector.contracts, 0);
});


test("complete KHAC notice uses the exact search revision when version lists are absent", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (["NOTICE_LDT_VERSION_LIST", "NOTICE_OTHER_VERSION_LIST"].includes(operation)) {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      if (operation === "NOTICE_LDT_DETAIL") throw new Error("PROCUREMENT_NOT_FOUND");
      if (operation === "NOTICE_OTHER_DETAIL") return {
        data: {
          notifyNo: "IB2600433562",
          notifyId: "notice-00",
          notifyVersion: "00",
          processApply: "KHAC",
          bidMode: "1_MTHS",
          bidName: "Gói chào hàng cạnh tranh",
          planNo: "PL2600248518",
        },
        metadata: { operation },
      };
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [{
          id: "plan-00",
          planNo: "PL2600248518",
          planVersion: "00",
        }] },
        metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") return {
        data: {
          plan: { id: "plan-00", planNo: "PL2600248518", planVersion: "00" },
          packages: [{ idDetail: "package-00", bidNo: "BP2600000001" }],
        },
        metadata: { operation },
      };
      if (operation === "NOTICE_CONTRACT_LIST") return { data: [], metadata: { operation } };
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor",
    id: "notice-00",
    notifyId: "notice-00",
    notifyNo: "IB2600433562",
    notifyVersion: "00",
    processApply: "KHAC",
    bidMode: "1_MTHS",
    planNo: "PL2600248518",
  }, { revisionMode: "LATEST" });

  assert.deepEqual(Object.keys(bundle.revisions), ["00"]);
  assert.equal(bundle.revisions["00"].sources.noticeDetail.operation, "NOTICE_OTHER_DETAIL");
  assert.equal(bundle.revisions["00"].sources.noticeDetail.success, true);
  assert.equal(
    calls.some(([operation]) => operation === "NOTICE_OTHER_DETAIL"),
    true,
  );
});


test("complete KHAC notice falls back to its exact search record when detail is unavailable", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if ([
        "NOTICE_LDT_VERSION_LIST",
        "NOTICE_OTHER_VERSION_LIST",
        "NOTICE_LDT_DETAIL",
        "NOTICE_OTHER_DETAIL",
        "NOTICE_ADB_DETAIL",
      ].includes(operation)) throw new Error("PROCUREMENT_UPSTREAM_UNAVAILABLE");
      if (operation === "NOTICE_TENDER_INFO_OTHER") return {
        data: {
          bidoNotifyContractorP: {
            notifyNo: "IB2600433562",
            notifyId: "notice-00",
            cPeriod: 5,
            cPeriodUnit: "M",
            isInternet: 0,
            bidGuaranteeValue: 45_000_000,
            ctype: "TG",
          },
        },
        metadata: { operation },
      };
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [{
          id: "plan-00", planNo: "PL2600248518", planVersion: "00",
        }] },
        metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") return {
        data: {
          plan: { id: "plan-00", planNo: "PL2600248518", planVersion: "00" },
          packages: [{
            idDetail: "package-00",
            planNo: "PL2600248518",
            bidName: "Gói chào hàng cạnh tranh",
          }],
        },
        metadata: { operation },
      };
      if (operation === "PLAN_PACKAGE_DETAIL") return {
        data: { idDetail: payload.id }, metadata: { operation },
      };
      if (operation === "NOTICE_CONTRACT_LIST") return { data: [], metadata: { operation } };
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor",
    id: "notice-00",
    notifyId: "notice-00",
    notifyNo: "IB2600433562",
    notifyVersion: "00",
    processApply: "KHAC",
    bidMode: "1_MTHS",
    bidName: ["Gói chào hàng cạnh tranh"],
    investField: ["PTV"],
    bidPrice: [4_484_923_803],
    planNo: "PL2600248518",
  }, { revisionMode: "LATEST" });

  const revision = bundle.revisions["00"];
  assert.equal(bundle.status, "FOUND_PARTIAL");
  assert.equal(revision.sources.noticeDetail.operation, "SEARCH");
  assert.equal(revision.sources.noticeDetail.fallback, true);
  assert.equal(revision.sources.noticeDetail.success, true);
  assert.equal(revision.sources.tenderInfo.operation, "NOTICE_TENDER_INFO_OTHER");
  assert.equal(revision.sources.tenderInfo.success, true);
  assert.deepEqual(
    calls.find(([operation]) => operation === "NOTICE_TENDER_INFO_OTHER"),
    ["NOTICE_TENDER_INFO_OTHER", { id: "notice-00" }],
  );
  assert.equal(
    bundle.failures.some((failure) => failure.operation === "NOTICE_OTHER_DETAIL"),
    true,
  );
});


test("notice revisions enrich from their explicitly linked plan versions", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "NOTICE_LDT_VERSION_LIST") return {
        data: { versionList: [
          { id: "notice-00", notifyNo: "IB2600000008", notifyVersion: "00", processApply: "LDT" },
          { id: "notice-01", notifyNo: "IB2600000008", notifyVersion: "01", processApply: "LDT" },
        ] },
        metadata: { operation },
      };
      if (operation === "NOTICE_OTHER_VERSION_LIST") throw new Error("PROCUREMENT_NOT_FOUND");
      if (operation === "NOTICE_LDT_DETAIL") {
        const version = payload.id.slice(-2);
        return {
          data: {
            notice: {
              id: payload.id,
              notifyId: payload.id,
              notifyNo: "IB2600000008",
              notifyVersion: version,
              planNo: "PL2600000008",
              bidNo: "BP2600000008",
              processApply: "LDT",
              bidMode: "1_MTHS",
            },
            linkedPlanPackage: {
              planNo: "PL2600000008",
              planVersion: version,
              bidNo: "BP2600000008",
            },
          },
          metadata: { operation },
        };
      }
      if (operation === "PLAN_VERSION_LIST") return {
        // Deliberately latest-first: array position must not choose the revision.
        data: { versionList: [
          { id: "plan-01", planNo: "PL2600000008", planVersion: "01" },
          { id: "plan-00", planNo: "PL2600000008", planVersion: "00" },
        ] },
        metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") {
        const version = payload.id.slice(-2);
        return {
          data: {
            plan: {
              id: payload.id,
              planNo: "PL2600000008",
              planVersion: version,
            },
            packages: [{
              idDetail: `package-${version}`,
              idPlan: payload.id,
              planNo: "PL2600000008",
              bidNo: "BP2600000008",
              bidTime: version === "00" ? "15 ngày" : "45 ngày",
            }],
          },
          metadata: { operation },
        };
      }
      if (operation === "PLAN_PACKAGE_DETAIL") return {
        data: { idDetail: payload.id },
        metadata: { operation },
      };
      if (["NOTICE_PETITION", "NOTICE_CLARIFICATION", "NOTICE_PREBID_CONFERENCE"].includes(operation)) {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      if (operation === "NOTICE_CONTRACT_LIST") return { data: [], metadata: { operation } };
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor",
    id: "notice-01",
    notifyId: "notice-01",
    notifyNo: "IB2600000008",
    notifyVersion: "01",
    processApply: "LDT",
    bidMode: "1_MTHS",
  }, { revisionMode: "ALL" });

  assert.equal(
    bundle.revisions["00"].sources.planDetail.response.plan.planVersion,
    "00",
  );
  assert.equal(
    bundle.revisions["01"].sources.planDetail.response.plan.planVersion,
    "01",
  );
  assert.deepEqual(
    calls.filter(([operation]) => operation === "PLAN_DETAIL")
      .map(([, payload]) => payload.id).sort(),
    ["plan-00", "plan-01"],
  );
  assert.deepEqual(
    calls.filter(([operation]) => operation === "PLAN_PACKAGE_DETAIL")
      .map(([, payload]) => payload.id).sort(),
    ["package-00", "package-01"],
  );
});


test("notice enrichment fails closed when multiple plan versions are ambiguous", async () => {
  const client = {
    request: async (operation, payload) => {
      if (operation === "NOTICE_LDT_VERSION_LIST") return {
        data: { versionList: [{
          id: "notice-01",
          notifyNo: "IB2600000009",
          notifyVersion: "01",
          processApply: "LDT",
        }] },
        metadata: { operation },
      };
      if (operation === "NOTICE_OTHER_VERSION_LIST") throw new Error("PROCUREMENT_NOT_FOUND");
      if (operation === "NOTICE_LDT_DETAIL") return {
        data: {
          notifyNo: "IB2600000009",
          notifyId: "notice-01",
          notifyVersion: "01",
          planNo: "PL2600000009",
          bidNo: "BP2600000009",
          processApply: "LDT",
          bidMode: "1_MTHS",
        },
        metadata: { operation },
      };
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [
          { id: "plan-01", planNo: "PL2600000009", planVersion: "01" },
          { id: "plan-00", planNo: "PL2600000009", planVersion: "00" },
        ] },
        metadata: { operation },
      };
      if (["NOTICE_PETITION", "NOTICE_CLARIFICATION", "NOTICE_PREBID_CONFERENCE"].includes(operation)) {
        throw new Error("PROCUREMENT_NOT_FOUND");
      }
      if (operation === "NOTICE_CONTRACT_LIST") return { data: [], metadata: { operation } };
      return { data: { operation, ...payload }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-notify-contractor",
    id: "notice-01",
    notifyId: "notice-01",
    notifyNo: "IB2600000009",
    notifyVersion: "01",
    processApply: "LDT",
    bidMode: "1_MTHS",
  });

  assert.equal(bundle.status, "FOUND_PARTIAL");
  assert.equal(
    bundle.revisions["01"].sources.planDetail.error.code,
    "PROCUREMENT_REVISION_INVALID",
  );
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


test("PL2600244105 complete ALL preserves revision-scoped raw package details", async () => {
  const calls = [];
  const client = {
    request: async (operation, payload) => {
      calls.push([operation, payload]);
      if (operation === "PLAN_VERSION_LIST") {
        return {
          data: { versionList: [
            { id: "revision-00", planNo: "PL2600244105", planVersion: "00" },
            { id: "revision-01", planNo: "PL2600244105", planVersion: "01" },
          ] },
          metadata: { operation, totalMs: 1 },
        };
      }
      if (operation === "PLAN_DETAIL") {
        const revision = payload.id.slice(-2);
        return {
          data: {
            bidPoBidpPlanProjectDetailView: {
              id: payload.id, planNo: "PL2600244105", planVersion: revision,
              name: `Plan ${revision}`,
            },
            bidpPlanDetailToProjectList: [{
              id: `package-${revision}`,
              idDetail: "stable-package-a",
              idPlan: payload.id,
              planNo: "PL2600244105",
              bidNo: "A",
              bidName: "Package A",
              isInternet: 1,
              isMultiLot: 0,
              isDomestic: 1,
              isPrequalification: 0,
              isConcentrateShopping: 0,
              bidPrice: revision === "00" ? 100 : 200,
              bidPriceUnit: "VND",
              bidForm: "DTRR",
              bidField: "HH",
              bidMode: "1_MTHS",
              processApply: "LDT",
              capitalDetail: "State budget",
              bidStartUnit: "MONTH",
              bidStartYear: 2026,
              bidStartMonth: 8,
              bidStartQuarter: 3,
              createdDate: "2026-08-01",
              planDecisionDate: "2026-07-30",
              bidTime: 30,
              ctype: "TG",
              cperiod: 12,
              cperiodUnit: "M",
              unknownFutureField2027: { abc: 123 },
            }],
          },
          metadata: { operation, totalMs: 2 },
        };
      }
      if (operation === "PLAN_PACKAGE_DETAIL") {
        return {
          data: {
            idDetail: payload.id,
            ctype: "TG",
            unknownPackageField2027: { preserved: true },
            accessToken: "must-not-cross-raw-boundary",
          },
          metadata: { operation, totalMs: 3 },
        };
      }
      throw new Error(`unexpected ${operation}`);
    },
  };
  const collector = new MscCollectors({
    client,
    clock: () => "2026-08-11T00:00:00Z",
  });

  const bundle = await collector.collectCompleteBundle({
    type: "es-plan-project-p",
    id: "revision-01",
    planNo: "PL2600244105",
    planVersion: "01",
  }, { revisionMode: "ALL" });

  assert.equal(bundle.schemaVersion, "biddingflow-muasamcong-raw-bundle-v2");
  assert.equal(bundle.status, "FOUND_COMPLETE");
  assert.deepEqual(Object.keys(bundle.revisions).sort(), ["00", "01"]);
  assert.equal(
    bundle.revisions["00"].sources.planDetail.response
      .bidpPlanDetailToProjectList[0].unknownFutureField2027.abc,
    123,
  );
  assert.equal(
    bundle.revisions["00"].packages["stable-package-a"]
      .sources.planPackageDetail.response.unknownPackageField2027.preserved,
    true,
  );
  assert.equal(
    bundle.revisions["00"].packages["stable-package-a"]
      .sources.planPackageDetail.response.accessToken,
    "[REDACTED]",
  );
  assert.equal(
    JSON.stringify(bundle).includes("must-not-cross-raw-boundary"),
    false,
  );
  assert.equal(
    bundle.revisions["00"].sources.planDetail.response
      .bidpPlanDetailToProjectList[0].bidPrice,
    100,
  );
  assert.equal(
    bundle.revisions["01"].sources.planDetail.response
      .bidpPlanDetailToProjectList[0].bidPrice,
    200,
  );
  assert.equal(
    calls.filter(([operation]) => operation === "PLAN_PACKAGE_DETAIL").length,
    2,
  );
  assert.deepEqual(bundle.manifest.revisions, ["00", "01"]);
  assert.equal(bundle.manifest.failedCount, 0);
  assert.equal(bundle.manifest.sourceCount, 6);
  assert.equal(bundle.metrics.upstream.requestCount, 5);
  const preserved = bundle.revisions["00"].sources.planDetail.response
    .bidpPlanDetailToProjectList[0];
  for (const field of [
    "id", "idDetail", "idPlan", "bidNo", "planNo", "bidName",
    "isInternet", "isMultiLot", "isDomestic", "isPrequalification",
    "isConcentrateShopping", "bidPrice", "bidPriceUnit", "bidForm",
    "bidField", "bidMode", "processApply", "capitalDetail",
    "bidStartUnit", "bidStartYear", "bidStartMonth", "bidStartQuarter",
    "createdDate", "planDecisionDate", "bidTime", "ctype", "cperiod",
    "cperiodUnit", "unknownFutureField2027",
  ]) assert.ok(Object.hasOwn(preserved, field), `missing raw field ${field}`);
});


test("complete plan keeps successful raw sources when one package detail fails", async () => {
  const client = {
    request: async (operation, payload) => {
      if (operation === "PLAN_VERSION_LIST") {
        return { data: { versionList: [
          { id: "revision-00", planNo: "PL2600244105", planVersion: "00" },
          { id: "revision-01", planNo: "PL2600244105", planVersion: "01" },
        ] }, metadata: { operation } };
      }
      if (operation === "PLAN_DETAIL") {
        const revision = payload.id.slice(-2);
        return { data: {
          plan: { id: payload.id, planNo: "PL2600244105", planVersion: revision },
          packages: [{ idDetail: `package-${revision}`, bidName: `Package ${revision}` }],
        }, metadata: { operation } };
      }
      if (operation === "PLAN_PACKAGE_DETAIL" && payload.id === "package-01") {
        throw new Error("PROCUREMENT_TIMEOUT");
      }
      return { data: { idDetail: payload.id, ok: true }, metadata: { operation } };
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-plan-project-p",
    id: "revision-01",
    planNo: "PL2600244105",
    planVersion: "01",
  }, { revisionMode: "ALL" });

  assert.equal(bundle.status, "FOUND_PARTIAL");
  assert.equal(bundle.complete, false);
  assert.equal(bundle.revisions["00"].packages["package-00"]
    .sources.planPackageDetail.success, true);
  assert.equal(bundle.revisions["01"].packages["package-01"]
    .sources.planPackageDetail.success, false);
  assert.equal(bundle.revisions["01"].packages["package-01"]
    .sources.planPackageDetail.error.code, "PROCUREMENT_TIMEOUT");
  assert.equal(bundle.manifest.failedCount, 1);
});


test("complete manifest records a failed envelope when package id is missing", async () => {
  const client = {
    request: async (operation) => {
      if (operation === "PLAN_VERSION_LIST") return {
        data: { versionList: [
          { id: "revision-00", planNo: "PL2600244105", planVersion: "00" },
        ] },
        metadata: { operation },
      };
      if (operation === "PLAN_DETAIL") return {
        data: {
          plan: { planNo: "PL2600244105", planVersion: "00" },
          packages: [{ bidNo: "A", bidName: "Package without detail id" }],
        },
        metadata: { operation },
      };
      throw new Error(`unexpected ${operation}`);
    },
  };

  const bundle = await new MscCollectors({ client }).collectCompleteBundle({
    type: "es-plan-project-p",
    id: "revision-00",
    planNo: "PL2600244105",
    planVersion: "00",
  }, { revisionMode: "ALL" });

  const failed = bundle.revisions["00"].packages.A
    .sources.planPackageDetail;
  assert.equal(failed.success, false);
  assert.equal(failed.attempted, false);
  assert.equal(failed.error.code, "PROCUREMENT_ADAPTER_UNSUPPORTED");
  assert.equal(bundle.manifest.failedCount, 1);
  assert.equal(bundle.failures.length, bundle.manifest.failedCount);
  assert.equal(bundle.manifest.sourceCount, 4);
  assert.equal(bundle.metrics.upstream.requestCount, 2);
});
