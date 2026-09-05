import assert from "node:assert/strict";
import test from "node:test";

import {
  DetailUrlBuilder,
  NetworkCollector,
  detectCapabilities,
  extractSemanticDomCandidates,
  findExactRoutingCandidate,
  hasExactIdentifier,
  inspectVueState,
  inspectVue3State,
  inspectReactState,
  isInteractionRequired,
  redactResponseUrl,
} from "../../backend/integrations/muasamcong_browser/runtime_support.mjs";
import {
  GenericUiDriver,
  DriverRegistry,
  Vue2Driver,
  selectDriver,
} from "../../backend/integrations/muasamcong_browser/drivers.mjs";
import {
  BrowserLookupRuntime,
  SEARCH_URL,
} from "../../backend/integrations/muasamcong_browser/browser_runtime.mjs";
import {
  ExtractorRegistry,
} from "../../backend/integrations/muasamcong_browser/extractors.mjs";


function withMockDocument(document, callback) {
  const previous = globalThis.document;
  globalThis.document = document;
  return Promise.resolve()
    .then(callback)
    .finally(() => { globalThis.document = previous; });
}


function fakePage(document) {
  return {
    async evaluate(callback, argument) {
      return withMockDocument(document, () => callback(argument));
    },
  };
}


test("capability detector and Vue inspector discover renamed exact state safely", async () => {
  const packageState = {
    renamedNotice: {
      notifyNo: "IB2600000002",
      bidName: "Gói B",
      planNo: "PL2600000001",
      bidPrice: 2_000_000_000,
    },
  };
  const child = { $data: packageState, $children: [] };
  const root = {
    $data: { harmless: true },
    $children: [child],
    axiosSearch() {},
    elasticSearch: "/o/egp/services/smart/search",
  };
  child.$children.push(root);
  const searchElement = { __vue__: root };
  const document = {
    getElementById: (id) => (id === "search-home" ? searchElement : null),
    querySelector: (selector) => (
      selector.includes("input") ? { nodeName: "INPUT" } : null
    ),
    querySelectorAll: () => [searchElement],
    body: { innerText: "Tra cứu lựa chọn nhà thầu" },
  };
  const page = fakePage(document);

  assert.deepEqual(await detectCapabilities(page), {
    vue2: true,
    vue3: false,
    react: false,
    vueInstanceCount: 1,
    knownSearchRoot: true,
    knownRuntimeShape: true,
    genericSearchUi: true,
    semanticDom: true,
  });
  assert.deepEqual(
    await inspectVueState(page, "IB2600000002", "PACKAGE"),
    [packageState.renamedNotice],
  );
});


test("capability detector recognizes the current KHLCNT search placeholder", async () => {
  const document = {
    getElementById: () => null,
    querySelector: (selector) => (
      selector.includes("Mã KHLCNT") ? { nodeName: "INPUT" } : null
    ),
    querySelectorAll: () => [],
    body: { innerText: "Lựa chọn nhà thầu" },
  };

  const capabilities = await detectCapabilities(fakePage(document));

  assert.equal(capabilities.vue2, false);
  assert.equal(capabilities.genericSearchUi, true);
});


test("Vue3 and React state extractors recover exact bounded procurement payloads", async () => {
  const vuePayload = {
    planNo: "PL2600000001",
    planName: "Kế hoạch từ Vue3",
    packages: [],
  };
  const reactPayload = {
    notifyNo: "IB2600000002",
    bidName: "Gói thầu từ React",
    notifyVersion: "01",
  };
  const vueElement = {
    __vueParentComponent: { setupState: { currentPlan: vuePayload } },
  };
  const reactElement = {
    "__reactFiber$fixture": { memoizedProps: { detail: reactPayload } },
  };
  const document = {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [vueElement, reactElement],
    body: { innerText: "" },
  };
  const page = fakePage(document);

  assert.deepEqual(
    await inspectVue3State(page, "PL2600000001", "PLAN"),
    [vuePayload],
  );
  assert.deepEqual(
    await inspectReactState(page, "IB2600000002", "PACKAGE"),
    [reactPayload],
  );
});


test("detail URL and network metadata exclude untrusted query material", () => {
  const url = DetailUrlBuilder.build({
    type: "es-notify-contractor",
    step: "tbmt",
    stepCode: "notify-contractor-step-1-tbmt",
    id: "notice-revision-00",
    notifyId: "notice-revision-00",
    notifyNo: "IB2600000002",
    planNo: "PL2600000001",
    token: "must-not-pass",
    unexpected: "ignored",
  });

  assert.match(url, /^https:\/\/muasamcong\.mpi\.gov\.vn\/vi\/web\/guest\/contractor-selection\?/);
  assert.match(url, /notifyNo=IB2600000002/);
  assert.match(
    url,
    /p_p_id=egpportalcontractorselectionv2_WAR_egpportalcontractorselectionv2/,
  );
  assert.match(url, /p_p_lifecycle=0/);
  assert.match(url, /p_p_state=normal/);
  assert.match(url, /p_p_mode=view/);
  assert.match(url, /step=tbmt/);
  assert.doesNotMatch(url, /token|unexpected/);
  assert.equal(
    redactResponseUrl("https://muasamcong.mpi.gov.vn/o/egp/search?token=secret#x"),
    "https://muasamcong.mpi.gov.vn/o/egp/search",
  );
});


test("search navigation uses the current localized public route", () => {
  assert.equal(
    SEARCH_URL,
    "https://muasamcong.mpi.gov.vn/vi/web/guest/contractor-selection?render=search",
  );
});


test("interaction detector reports challenges without solving them", async () => {
  const challenged = fakePage({
    body: { innerText: "Please complete the CAPTCHA challenge" },
  });
  const normal = fakePage({ body: { innerText: "Kết quả tra cứu" } });

  assert.equal(await isInteractionRequired(challenged), true);
  assert.equal(await isInteractionRequired(normal), false);
});


test("network collector matches schema and exact identifier instead of endpoint name", async () => {
  class FakePage {
    constructor() { this.listeners = new Map(); }
    on(name, listener) { this.listeners.set(name, listener); }
    off(name, listener) {
      if (this.listeners.get(name) === listener) this.listeners.delete(name);
    }
    async emit(response) { await this.listeners.get("response")(response); }
  }
  const page = new FakePage();
  const collector = new NetworkCollector({
    code: "PL2600000001",
    kind: "PLAN",
    maxResponseBytes: 4096,
  });
  collector.start(page);
  const matching = collector.waitForExact(500);

  await page.emit({
    url: () => "https://muasamcong.mpi.gov.vn/unrelated/path?token=secret",
    status: () => 200,
    headers: () => ({ "content-type": "application/json; charset=utf-8" }),
    request: () => ({ method: () => "POST" }),
    body: async () => Buffer.from(JSON.stringify({
      arbitraryWrapper: {
        planNo: "PL2600000001",
        name: "Kế hoạch",
        packagesRenamed: [{ bidName: "Gói A", bidPrice: 1 }],
      },
    })),
  });

  const payload = await matching;
  assert.equal(payload.arbitraryWrapper.planNo, "PL2600000001");
  assert.equal(collector.responses.length, 1);
  assert.deepEqual(collector.responses[0], {
    url: "https://muasamcong.mpi.gov.vn/unrelated/path",
    method: "POST",
    status: 200,
    contentType: "application/json; charset=utf-8",
    durationMs: collector.responses[0].durationMs,
    body: collector.responses[0].body,
  });
  collector.stop();
  assert.equal(page.listeners.size, 0);
});


test("exact family matching accepts only a canonical revision suffix", () => {
  const payload = {
    page: { content: [{
      planNo: "PL2600163819-01",
      id: "plan-revision-01",
      type: "es-plan-project-p",
      stepCode: "plan-step-1",
    }] },
  };

  assert.equal(
    hasExactIdentifier(payload, "PL2600163819", "PLAN"),
    true,
  );
  assert.equal(
    hasExactIdentifier(payload, "PL2600163818", "PLAN"),
    false,
  );
  assert.equal(
    findExactRoutingCandidate(payload, "PL2600163819", "PLAN").id,
    "plan-revision-01",
  );
});


test("semantic DOM extractor supports the current information rows", async () => {
  const row = (label, value) => ({
    children: [
      { textContent: label },
      { textContent: value },
    ],
    querySelectorAll: () => [],
  });
  const rows = [
    row("Mã TBMT", "IB2600148033"),
    row("Mã KHLCNT", "PL2600085700"),
    row("Tên gói thầu", "Mua sắm hóa chất xét nghiệm"),
    row("Chủ đầu tư", "Bệnh viện đa khoa Trực Ninh"),
    row("Chi tiết nguồn vốn", "Nguồn thu hợp pháp"),
    row("Lĩnh vực", "Hàng hóa"),
    row("Hình thức lựa chọn nhà thầu", "Đấu thầu rộng rãi"),
    row("Phương thức lựa chọn nhà thầu", "Một giai đoạn một túi hồ sơ"),
    row("Loại hợp đồng", "Đơn giá cố định"),
    row("Thời gian thực hiện gói thầu", "12 tháng"),
    row("Thời điểm đóng thầu", "23/04/2026 08:00"),
    row("Thời điểm mở thầu", "23/04/2026 08:00"),
  ];
  const page = fakePage({
    body: { innerText: "Mã TBMT IB2600148033" },
    querySelectorAll(selector) {
      return selector.includes(".infomation__content") ? rows : [];
    },
  });

  const candidates = await extractSemanticDomCandidates(
    page, "IB2600148033", "PACKAGE",
  );

  assert.deepEqual(candidates, [{
    notifyNo: "IB2600148033",
    planNo: "PL2600085700",
    bidName: "Mua sắm hóa chất xét nghiệm",
    investorName: "Bệnh viện đa khoa Trực Ninh",
    capitalDetail: "Nguồn thu hợp pháp",
    bidField: "Hàng hóa",
    bidForm: "Đấu thầu rộng rãi",
    bidMode: "Một giai đoạn một túi hồ sơ",
    contractType: "Đơn giá cố định",
    implementationPeriod: "12 tháng",
    bidCloseDate: "23/04/2026 08:00",
    bidOpenDate: "23/04/2026 08:00",
  }]);
});


test("driver selection uses Vue2 fast path and generic semantic fallback", async () => {
  const calls = [];
  const runtime = {
    axiosSearch(payload) { calls.push(payload); },
    formatPayloadSearchWidthNotify(payload) { return [payload]; },
  };
  const vuePage = fakePage({
    getElementById: () => ({ __vue__: runtime }),
  });
  const vue = selectDriver({
    vue2: true,
    knownRuntimeShape: true,
    genericSearchUi: true,
  });
  assert.ok(vue instanceof Vue2Driver);
  await vue.performLookup(vuePage, "IB2600000002", "PACKAGE");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].query[0].keyWord, "IB2600000002");
  assert.deepEqual(calls[0].query[0].filters[0].fieldValues, [
    "es-notify-contractor",
  ]);

  const actions = [];
  const input = {
    async count() { return 1; },
    async isVisible() { return true; },
    async fill(value) { actions.push(["fill", value]); },
    async press(value) { actions.push(["press", value]); },
    first() { return this; },
  };
  const button = {
    async count() { return 1; },
    async isVisible() { return true; },
    async click() { actions.push(["click"]); },
    first() { return this; },
  };
  const genericPage = {
    getByRole(role) { return role === "textbox" ? input : button; },
    getByPlaceholder() { return input; },
  };
  const generic = selectDriver({
    vue2: false,
    knownRuntimeShape: false,
    genericSearchUi: true,
  });
  assert.ok(generic instanceof GenericUiDriver);
  await generic.performLookup(genericPage, "PL2600000001", "PLAN");
  assert.deepEqual(actions, [["fill", "PL2600000001"], ["click"]]);
});


test("generic driver supports the live KHLCNT accessible label", async () => {
  const actions = [];
  const missing = {
    async count() { return 0; }, async isVisible() { return false; }, first() { return this; },
  };
  const labeled = {
    async count() { return 1; }, async isVisible() { return true; },
    async fill(value) { actions.push(["fill", value]); },
    async press(value) { actions.push(["press", value]); },
    first() { return this; },
  };
  const button = {
    async count() { return 1; }, async isVisible() { return true; },
    async click() { actions.push(["click"]); }, first() { return this; },
  };
  const page = {
    getByRole(role) { return role === "button" ? button : missing; },
    getByLabel(name) {
      assert.match(String(name), /KHLCNT|lựa chọn nhà thầu/i);
      return labeled;
    },
    getByPlaceholder() { return missing; },
  };

  await new GenericUiDriver().performLookup(page, "PL2600000001", "PLAN");

  assert.deepEqual(actions, [["fill", "PL2600000001"], ["click"]]);
});


test("generic driver ignores a KHLCNT checkbox label when placeholder matches", async () => {
  const actions = [];
  const missing = {
    async count() { return 0; }, async isVisible() { return false; }, first() { return this; },
  };
  const checkbox = {
    async count() { return 1; }, async isVisible() { return true; },
    async fill() { throw new Error("checkbox must not be filled"); },
    first() { return this; },
  };
  const keyword = {
    async count() { return 1; }, async isVisible() { return true; },
    async fill(value) { actions.push(["fill", value]); },
    locator(selector) {
      assert.match(selector, /ancestor::div/);
      return {
        getByRole() {
          return {
            async count() { return 1; }, async isVisible() { return true; },
            async click() { actions.push(["click"]); }, first() { return this; },
          };
        },
      };
    },
    first() { return this; },
  };
  const button = {
    async count() { return 1; }, async isVisible() { return true; },
    async click() { actions.push(["wrong-header-click"]); }, first() { return this; },
  };
  const page = {
    getByRole(role) { return role === "button" ? button : missing; },
    getByLabel() { return checkbox; },
    getByPlaceholder(pattern) {
      assert.equal(pattern.test(
        "Nhập Mã KHLCNT/ Tên KHLCNT/ Tên gói thầu trong KHLCNT",
      ), true);
      assert.equal(pattern.test(
        "Nhập từ khoá (ví dụ: IB000202 hoặc Mua sắm thiết bị)",
      ), false);
      return keyword;
    },
  };

  await new GenericUiDriver().performLookup(
    page, "PL2600000001", "PLAN",
  );

  assert.deepEqual(actions, [["fill", "PL2600000001"], ["click"]]);
});


test("generic package lookup selects notice category and exact phrase", async () => {
  const actions = [];
  let selectedCategory = "Kế hoạch lựa chọn nhà thầu";
  const makeLocator = (overrides = {}) => ({
    async count() { return 1; },
    async isVisible() { return true; },
    first() { return this; },
    filter() { return this; },
    ...overrides,
  });
  const category = makeLocator({
    async innerText() { return selectedCategory; },
    async click() { actions.push(["open-category"]); },
  });
  const option = makeLocator({
    async click() {
      selectedCategory = "Thông báo mời thầu";
      actions.push(["select-category", "Thông báo mời thầu"]);
    },
  });
  const exactRadio = makeLocator({
    async check() { actions.push(["exact-match"]); },
  });
  const input = makeLocator({
    async fill(value) { actions.push(["fill", value]); },
    async press(value) { actions.push(["press", value]); },
  });
  const button = makeLocator({
    async click() { actions.push(["search"]); },
  });
  const missing = makeLocator({
    async count() { return 0; },
    async isVisible() { return false; },
  });
  const page = {
    getByRole(role) {
      return {
        combobox: category,
        option,
        radio: missing,
        textbox: input,
        button,
      }[role];
    },
    getByLabel() { return input; },
    getByPlaceholder() { return input; },
    locator(selector) {
      assert.equal(selector, "input[type='radio'][value='exact']");
      return exactRadio;
    },
  };

  await new GenericUiDriver().performLookup(
    page, "IB2600000002", "PACKAGE",
  );

  assert.deepEqual(actions, [
    ["open-category"],
    ["select-category", "Thông báo mời thầu"],
    ["exact-match"],
    ["fill", "IB2600000002"],
    ["search"],
  ]);
});


test("generic driver fails closed when category selection does not commit", async () => {
  const locator = (overrides = {}) => ({
    async count() { return 1; },
    async isVisible() { return true; },
    async innerText() { return "Kế hoạch lựa chọn nhà thầu"; },
    async click() {},
    async check() {},
    async fill() {},
    first() { return this; },
    filter() { return this; },
    ...overrides,
  });
  const category = locator();
  const page = {
    getByRole(role) {
      if (role === "combobox") return category;
      return locator();
    },
    getByLabel() { return locator(); },
    getByPlaceholder() { return locator(); },
    locator() { return locator(); },
  };

  await assert.rejects(
    new GenericUiDriver().performLookup(
      page, "IB2600000002", "PACKAGE",
    ),
    /PROCUREMENT_ADAPTER_UNSUPPORTED/,
  );
});


test("versioned driver and extractor registries preserve ordered fallbacks", async () => {
  const drivers = new DriverRegistry();
  assert.ok(drivers.select({
    vue2: true, knownRuntimeShape: true, genericSearchUi: true,
  }) instanceof Vue2Driver);
  assert.ok(drivers.select({ genericSearchUi: true }, {
    vue2: false, generic: true,
  }) instanceof GenericUiDriver);

  const calls = [];
  const extractors = new ExtractorRegistry({
    vueInspector: async () => { calls.push("vue"); return [{ planNo: "PL2600000001" }]; },
    domExtractor: async () => { calls.push("dom"); return [{ planNo: "PL2600000001" }]; },
  });
  const network = await extractors.extract({
    page: {}, code: "PL2600000001", kind: "PLAN",
    networkPayload: { planNo: "PL2600000001" },
    flags: { network: true, vue: true, dom: true },
  });
  assert.equal(network.strategy, "network-json");
  assert.deepEqual(calls, []);

  const vue = await extractors.extract({
    page: {}, code: "PL2600000001", kind: "PLAN", networkPayload: null,
    flags: { network: true, vue: true, dom: true },
  });
  assert.equal(vue.strategy, "vue-state");
  assert.deepEqual(calls, ["vue"]);

  const frameworkCalls = [];
  const frameworkExtractors = new ExtractorRegistry({
    vueInspector: async () => { frameworkCalls.push("vue2"); return []; },
    vue3Inspector: async () => {
      frameworkCalls.push("vue3");
      return [{ planNo: "PL2600000001" }];
    },
    reactInspector: async () => {
      frameworkCalls.push("react");
      return [{ planNo: "PL2600000001" }];
    },
    domExtractor: async () => { frameworkCalls.push("dom"); return []; },
  });
  const vue3 = await frameworkExtractors.extract({
    page: {}, code: "PL2600000001", kind: "PLAN", networkPayload: null,
    flags: { network: true, vue: true, vue3: true, react: true, dom: true },
  });
  assert.equal(vue3.strategy, "vue3-state");
  assert.deepEqual(frameworkCalls, ["vue2", "vue3"]);
});


test("browser rejects foreign hosts before launch", async () => {
  let launches = 0;
  const runtime = new BrowserLookupRuntime({
    chromium: { async launch() { launches += 1; } },
  });
  for (const configuration of [
    { targetHost: "example.test" },
    { targetHost: "" },
  ]) {
    await assert.rejects(runtime.initialize(configuration), /PROCUREMENT_ADAPTER_UNSUPPORTED/);
  }
  assert.equal(launches, 0);
});

test("browser initialization records cold startup time once", async () => {
  const ticks = [100, 125];
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() { return { async close() {} }; },
          async close() {},
        };
      },
    },
    clock: () => ticks.shift(),
  });

  const initialized = await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    chromiumArgs: [],
  });

  assert.deepEqual(initialized, { ready: true, browserStartupMs: 25 });
  assert.equal("browserMode" in runtime.configuration, false);
  await runtime.close();
});


test("search-page challenge returns interaction-required without solving", async () => {
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return { async goto() {}, async close() {} };
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    },
    capabilityDetector: async () => ({ genericSearchUi: true }),
    driverSelector: () => ({
      name: "generic", version: "2026.1", async performLookup() {},
    }),
    collectorFactory: () => ({
      responses: [], start() {}, stop() {},
      async waitForExact() { throw new Error("PROCUREMENT_TIMEOUT"); },
    }),
    interactionDetector: async () => true,
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    chromiumArgs: [],
  });

  await assert.rejects(
    runtime.lookup("IB2600000002", "PACKAGE"),
    /PROCUREMENT_INTERACTION_REQUIRED/,
  );
  await runtime.close();
});


test("read-only probe reports live capabilities even when no driver is usable", async () => {
  const page = { async goto() {}, async close() { this.closed = true; } };
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return { async newPage() { return page; }, async close() {} };
          },
          async close() {},
        };
      },
    },
    capabilityDetector: async () => ({
      vue2: false, knownSearchRoot: false,
      knownRuntimeShape: false, genericSearchUi: false,
    }),
    interactionDetector: async () => false,
    clock: (() => {
      let value = 0;
      return () => { value += 5; return value; };
    })(),
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    chromiumArgs: [],
  });

  const probe = await runtime.probe();

  assert.equal(probe.schemaVersion, "muasamcong-browser-probe-v1");
  assert.equal(probe.framework, "unknown");
  assert.equal(probe.interactionRequired, false);
  assert.equal(probe.capabilities.genericSearchUi, false);
  assert.equal(page.closed, true);
  await runtime.close();
});


test("navigation retries one transient timeout within the configured budget", async () => {
  let navigationCalls = 0;
  const timeouts = [];
  const page = {
    async goto(_url, options) {
      navigationCalls += 1;
      timeouts.push(options.timeout);
      if (navigationCalls === 1) throw new Error("page.goto: Timeout 10000ms exceeded");
      return { status: () => 200 };
    },
    async title() { return "Lựa chọn nhà thầu - EGP_v2.0 - EGP"; },
    async close() {},
  };
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return { async newPage() { return page; }, async close() {} };
          },
          async close() {},
        };
      },
    },
    capabilityDetector: async () => ({
      vue2: false, knownSearchRoot: false,
      knownRuntimeShape: false, genericSearchUi: false,
    }),
    interactionDetector: async () => false,
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    navigationTimeoutMs: 20_000,
  });

  const result = await runtime.probe();

  assert.equal(result.schemaVersion, "muasamcong-browser-probe-v1");
  assert.equal(navigationCalls, 2);
  assert.deepEqual(timeouts, [10_000, 10_000]);
  await runtime.close();
});


test("known upstream error page retries once and fails with stable taxonomy", async () => {
  let navigationCalls = 0;
  const page = {
    async goto() {
      navigationCalls += 1;
      return { status: () => 200 };
    },
    async title() { return "Error"; },
    async close() {},
  };
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return { async newPage() { return page; }, async close() {} };
          },
          async close() {},
        };
      },
    },
    interactionDetector: async () => false,
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
  });

  await assert.rejects(
    runtime.probe(),
    /PROCUREMENT_UPSTREAM_UNAVAILABLE/,
  );
  assert.equal(navigationCalls, 2);
  await runtime.close();
});


test("browser runtime keeps Chromium warm and follows exact search result to detail", async () => {
  const launches = [];
  const navigations = [];
  const pages = [];
  const detailPayload = {
    renamedPlan: {
      planNo: "PL2600000001",
      name: "Kế hoạch",
      packages: [{ idDetail: "detail-a", bidName: "Gói A" }],
    },
  };
  const searchPayload = {
    page: { content: [{
      planNo: "PL2600000001",
      id: "plan-revision-01",
      type: "es-plan-project-p",
      stepCode: "plan-step-1",
    }] },
  };
  const chromium = {
    async launch(options) {
      launches.push(options);
      return {
        async newContext() {
          return {
            async newPage() {
              const page = {
                async goto(url) { navigations.push(url); },
                async close() { this.closed = true; },
              };
              pages.push(page);
              return page;
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
  };
  const collectors = [
    {
      responses: [{ url: "https://muasamcong.mpi.gov.vn/search", body: searchPayload }],
      start() {}, stop() {}, async waitForExact() { return searchPayload; },
    },
    {
      responses: [{ url: "https://muasamcong.mpi.gov.vn/detail", body: detailPayload }],
      start() {}, stop() {}, async waitForExact() { return detailPayload; },
    },
  ];
  const driverCalls = [];
  const runtime = new BrowserLookupRuntime({
    chromium,
    capabilityDetector: async () => ({ vue2: true, knownRuntimeShape: true }),
    driverSelector: () => ({
      name: "vue2", version: "2026.1",
      async performLookup(_page, code, kind) { driverCalls.push([code, kind]); },
    }),
    collectorFactory: () => collectors.shift(),
    vueInspector: async () => [],
    domExtractor: async () => [],
    interactionDetector: async () => false,
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    chromiumArgs: [],
  });

  const artifact = await runtime.lookup("PL2600000001", "PLAN");

  assert.deepEqual(launches, [{ headless: true, args: [] }]);
  assert.deepEqual(driverCalls, [["PL2600000001", "PLAN"]]);
  assert.equal(navigations.length, 2);
  assert.match(navigations[1], /detail-v2/);
  assert.match(navigations[1], /id=plan-revision-01/);
  assert.equal(artifact.driver, "vue2");
  assert.deepEqual(artifact.networkResponses[0].body, detailPayload);
  assert.equal(pages[0].closed, true);

  await runtime.close();
});


test("browser runtime falls back to generic and opens a Vue2 fast-path circuit", async () => {
  const searchPayload = {
    page: { content: [{
      notifyNo: "IB2600000002",
      id: "notice-2",
      type: "es-notify-contractor",
      stepCode: "notify-contractor-step-1-tbmt",
    }] },
  };
  const detailPayload = {
    notice: { notifyNo: "IB2600000002", bidName: "Gói B", bidPrice: 2 },
  };
  let collectorIndex = 0;
  const selectorFlags = [];
  const driverCalls = [];
  const runtime = new BrowserLookupRuntime({
    chromium: {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return { async goto() {}, async close() {} };
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    },
    capabilityDetector: async () => ({
      vue2: true, knownRuntimeShape: true, genericSearchUi: true,
    }),
    driverSelector: (_capabilities, flags) => {
      selectorFlags.push({ ...flags });
      if (flags.vue2) {
        return {
          name: "vue2", version: "2026.1",
          async performLookup() {
            driverCalls.push("vue2");
            throw new Error("PROCUREMENT_ADAPTER_UNSUPPORTED");
          },
        };
      }
      return {
        name: "generic", version: "2026.1",
        async performLookup() { driverCalls.push("generic"); },
      };
    },
    collectorFactory: () => {
      const payload = collectorIndex++ % 2 === 0 ? searchPayload : detailPayload;
      return {
        responses: [{ url: "https://muasamcong.mpi.gov.vn/data", body: payload }],
        start() {}, stop() {}, async waitForExact() { return payload; },
      };
    },
    interactionDetector: async () => false,
    clock: () => 100,
  });
  await runtime.initialize({
    headless: true,
    targetHost: "muasamcong.mpi.gov.vn",
    chromiumArgs: [],
    drivers: { vue2: true, generic: true },
    extractors: { network: true, vue: true, dom: true },
    maxResponseBytes: 524_288,
  });

  for (let index = 0; index < 4; index += 1) {
    const artifact = await runtime.lookup("IB2600000002", "PACKAGE");
    assert.equal(artifact.driver, "generic");
  }

  assert.deepEqual(driverCalls, [
    "vue2", "generic", "vue2", "generic", "vue2", "generic", "generic",
  ]);
  assert.equal(selectorFlags.at(-1).vue2, false);
  assert.equal(runtime.configuration.maxResponseBytes, 524_288);
  await runtime.close();
});
