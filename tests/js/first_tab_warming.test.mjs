import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import {
  beginNavigationFeedback,
  finishNavigationFeedback,
  setupTabs,
  switchTab,
} from "../../frontend/app/BiddingControllerUI.js";
import {
  BiddingView,
  getViewModuleLoadDiagnostics,
} from "../../frontend/app/BiddingView.js";
import { loadPaginatedRecords } from "../../frontend/shared/tableDataUtils.js";
import { POST_STARTUP_TIMING } from "../../frontend/app/startupTiming.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function response(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("primary business views stay route-specific and outside the workspace startup graph", () => {
  const viewSource = fs.readFileSync("frontend/app/BiddingView.js", "utf8");
  const workspaceSource = fs.readFileSync("frontend/app/workspaceBootstrap.js", "utf8");
  for (const [moduleName, modulePath] of [
    ["plan-list", "../plans/KeHoachView.js"],
    ["package-list", "../packages/GoiThauTable.js"],
    ["investor-list", "../partners/ChuDauTuComponent.js"],
    ["contractor-list", "../partners/NhaThauComponent.js"],
    ["expert-list", "../experts/ChuyenGiaComponent.js"],
    ["contract-list", "../contracts/HopDongComponent.js"],
  ]) {
    assert.match(
      viewSource,
      new RegExp(`["']${moduleName}["']:\\s*\\(\\)\\s*=>\\s*import\\(["']${modulePath.replaceAll(".", "\\.")}["']\\)`),
    );
  }
  assert.doesNotMatch(viewSource, /PrimaryBusinessView/);
  assert.doesNotMatch(workspaceSource, /^import .*PrimaryBusinessView/m);
  assert.deepEqual(getViewModuleLoadDiagnostics("package-list"), {
    installed: false,
    pending: false,
    loadCount: 0,
  });
});

test("procurement resume waits for an explicitly requested bidding workflow load", async () => {
  const scheduled = [];
  const resumed = [];
  const ready = new Set();
  let workspaceToken = "user:org-a@1";
  const controller = Object.create(BiddingController.prototype);
  controller.model = { getWorkspaceToken: () => workspaceToken };
  controller._workflowModuleLoader = {
    async ensure(requirement) {
      ready.add(requirement);
      controller.resumeProcurementImportSession = async () => resumed.push(requirement);
    },
    isReady: (requirement) => ready.has(requirement),
  };
  controller.schedulePostStartupTask = (task, options) => scheduled.push({ task, options });

  assert.deepEqual(scheduled, []);
  await controller.ensureWorkflowRequirement("partner");
  assert.deepEqual(scheduled, [], "an unrelated workflow must not resume procurement import");

  await controller.ensureWorkflowRequirement("bidding");
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0].options, {
    timeout: 3000,
    key: "procurement-import-resume-after-navigation",
  });
  await scheduled[0].task();
  assert.deepEqual(resumed, ["bidding"]);

  await controller.ensureWorkflowRequirement("bidding");
  assert.equal(scheduled.length, 1, "resume is scheduled once for the active workspace");

  workspaceToken = "user:org-b@2";
  await controller.ensureWorkflowRequirement("bidding");
  assert.equal(scheduled.length, 2, "a new workspace gets its own pending-import resume");
  assert.equal(await scheduled[0].task(), false, "a stale workspace task cannot resume after a switch");
  await scheduled[1].task();
  assert.deepEqual(resumed, ["bidding", "bidding"]);

  const uiSource = fs.readFileSync("frontend/app/BiddingControllerUI.js", "utf8");
  assert.match(
    uiSource,
    /this\.scheduleProcurementImportResume\?\.\(workflowRequirement\);/,
    "an already-loaded bidding workflow must still resume the current workspace on navigation",
  );
});

test("goithau loads only its route-specific list module", async () => {
  const view = new BiddingView({});
  await view.ensureViewModules("goithau");
  await view.ensureViewModules("goithau");
  assert.deepEqual(getViewModuleLoadDiagnostics("package-list"), {
    installed: true,
    pending: false,
    loadCount: 1,
  });
  assert.deepEqual(getViewModuleLoadDiagnostics("plan-list"), {
    installed: false,
    pending: false,
    loadCount: 0,
  });
});

test("tab setup starts route loading from click without hover or focus prefetch", async () => {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  const button = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    getAttribute: (name) => name === "data-tab" ? "goithau" : null,
  };
  const switched = [];
  globalThis.document = { getElementById: () => null };
  const controller = {
    view: { elements: { navButtons: [button] } },
    switchTab: async (tab) => switched.push(tab),
  };
  try {
    setupTabs.call(controller);
    assert.deepEqual([...listeners.keys()], ["click"]);
    listeners.get("click")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(switched, ["goithau"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("primary tab warming limits page prefetch concurrency and fills exact first-page cache", async () => {
  const previousFetch = globalThis.fetch;
  let active = 0;
  let maximumActive = 0;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return response({ items: [], totalItems: 0, hasMore: false, nextCursor: null });
  };
  const model = {
    useServerSidePagination: true,
    pageSize: 10,
    getWorkspaceToken: () => "user:org-a@1",
    workspaceScope: { key: "user:org-a" },
    state: { activetab: "dashboard", kehoach: [], goithau: [], chudautu: [], nhathau: [], chuyengia: [], hopdong: [] },
    normalizeRecordKeys: (record) => record,
    entityIndexes: { invalidate() {} },
  };
  const controller = Object.create(BiddingController.prototype);
  controller.model = model;
  controller.view = { elements: { navButtons: [] }, ensureViewModules: async () => {} };
  try {
    await controller.warmPrimaryTabs();
    assert.equal(requests, 6);
    assert.equal(maximumActive, 2);
    assert.equal(model._paginatedQueryCache.size, 6);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("scheduled primary warming keeps route modules cold until the tab is clicked", async () => {
  const previousDocument = globalThis.document;
  const previousHistory = globalThis.history;
  const previousElement = globalThis.Element;
  class TestElement {}
  globalThis.Element = TestElement;
  const createClassList = () => {
    const tokens = new Set();
    return {
      add: (...names) => names.forEach((name) => tokens.add(name)),
      remove: (...names) => names.forEach((name) => tokens.delete(name)),
      contains: (name) => tokens.has(name),
    };
  };
  const navButton = {
    classList: createClassList(),
    getAttribute: (name) => name === "data-tab" ? "kehoach" : null,
  };
  const dashboardPane = { id: "tab-dashboard", classList: createClassList() };
  dashboardPane.classList.add("active");
  const planPane = { id: "tab-kehoach", classList: createClassList() };
  const panes = [dashboardPane, planPane];
  globalThis.document = {
    body: {},
    getElementById(id) {
      return panes.find((pane) => pane.id === id) || null;
    },
    querySelectorAll(selector) {
      if (selector === ".nav-btn") return [navButton];
      if (selector === ".tab-pane") return panes;
      return [];
    },
  };
  globalThis.history = { pushState() {}, replaceState() {} };

  const moduleLoads = [];
  const readyModules = new Set();
  const rendered = [];
  const scheduled = [];
  const controller = Object.create(BiddingController.prototype);
  controller.model = {
    useServerSidePagination: false,
    getWorkspaceToken: () => "user:org-a@1",
    workspaceScope: { key: "user:org-a" },
    state: {
      activetab: "dashboard",
      activeaction: null,
      activerole: "manager",
      kehoach: [],
      goithau: [],
      chudautu: [],
      nhathau: [],
      hopdong: [],
    },
    hasActiveEffectiveRole: () => true,
  };
  controller._workflowModulesReady = true;
  controller.lazyTabPartials = {};
  controller.routeMap = { kehoach: "ke-hoach" };
  controller.actionMap = {};
  controller.view = {
    elements: {
      navButtons: [navButton],
      tabPanes: panes,
      pageTitle: { textContent: "" },
    },
    areViewModulesReady: (tab) => readyModules.has(tab),
    async ensureViewModules(tab) {
      moduleLoads.push(tab);
      readyModules.add(tab);
    },
  };
  controller.renderTabData = (tab) => rendered.push(tab);
  controller.switchTab = switchTab;
  controller.schedulePostStartupTask = (task, options) => scheduled.push({ task, options });

  try {
    assert.equal(await controller.schedulePrimaryTabWarming(), true);
    assert.equal(scheduled.length, 1);
    await scheduled[0].task();
    assert.deepEqual(
      moduleLoads,
      [],
      "background warming must not import route UI before explicit navigation",
    );

    await controller.switchTab("kehoach");
    assert.deepEqual(moduleLoads, ["kehoach"]);
    assert.deepEqual(rendered, ["kehoach"]);
    assert.equal(planPane.classList.contains("active"), true);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHistory === undefined) delete globalThis.history;
    else globalThis.history = previousHistory;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});

test("post-startup warming waits for authoritative reconciliation before filling page caches", async () => {
  const controllerSource = fs.readFileSync("frontend/app/BiddingController.js", "utf8");
  const loaderHiddenAt = controllerSource.indexOf("hideInitLoader();");
  const reconciliationAt = controllerSource.indexOf("scheduleInitialRouteReconciliation", loaderHiddenAt);
  const warmingAt = controllerSource.indexOf("schedulePrimaryTabWarming", reconciliationAt);
  assert.ok(loaderHiddenAt >= 0 && reconciliationAt > loaderHiddenAt && warmingAt > reconciliationAt);

  const pendingReconciliation = deferred();
  const scheduled = [];
  const controller = Object.create(BiddingController.prototype);
  controller.model = { getWorkspaceToken: () => "user:org-a@1" };
  controller.schedulePostStartupTask = (task, options) => scheduled.push({ task, options });
  const warming = controller.schedulePrimaryTabWarming(pendingReconciliation.promise);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(scheduled.length, 0, "warming must not race the pull that invalidates query caches");
  pendingReconciliation.resolve(true);
  assert.equal(await warming, true);
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0].options, {
    timeout: 700,
    delay: POST_STARTUP_TIMING.primaryTabWarm,
    key: "primary-tab-warm-after-reconcile",
    priority: "warm",
  });
});

test("a failed post-startup task cannot break the app", async () => {

  const previousWindow = globalThis.window;
  const previousAnimationFrame = globalThis.requestAnimationFrame;
  const previousIdleCallback = globalThis.requestIdleCallback;
  const previousError = console.error;
  const errors = [];
  globalThis.window = { requestIdleCallback(callback) { callback(); } };
  globalThis.requestIdleCallback = (callback) => callback();
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  console.error = (...args) => errors.push(args);
  const controller = Object.create(BiddingController.prototype);
  try {
    controller.schedulePostStartupTask(() => Promise.reject(new Error("warm failed")));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "Post-startup task failed:");
  } finally {
    console.error = previousError;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousAnimationFrame === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = previousAnimationFrame;
    if (previousIdleCallback === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = previousIdleCallback;
  }
});

test("expert renderer uses the same search query key as primary-tab warming", () => {
  const source = fs.readFileSync("frontend/experts/ChuyenGiaComponent.js", "utf8");
  assert.match(source, /pageParams\s*=\s*\{\s*page:\s*currentPage,\s*pageSize,\s*search:\s*searchVal,/);
});

test("workspace change stops remaining warm batches and cannot cache the old response", async () => {
  const previousFetch = globalThis.fetch;
  const previousWarn = console.warn;
  const requests = [];
  let workspaceToken = "user:org-a@1";
  globalThis.fetch = (_url, options = {}) => {
    const pending = deferred();
    requests.push({ pending, signal: options.signal });
    return pending.promise;
  };
  console.warn = () => {};
  const model = {
    useServerSidePagination: true,
    pageSize: 10,
    getWorkspaceToken: () => workspaceToken,
    workspaceScope: { key: "user:org-a" },
    state: { activetab: "dashboard", kehoach: [], goithau: [], chudautu: [], nhathau: [], chuyengia: [], hopdong: [] },
    normalizeRecordKeys: (record) => record,
    entityIndexes: { invalidate() {} },
  };
  const controller = Object.create(BiddingController.prototype);
  controller.model = model;
  controller.view = { elements: { navButtons: [] }, ensureViewModules: async () => {} };
  try {
    const warming = controller.warmPrimaryTabs();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests.length, 2);
    workspaceToken = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    requests.forEach(({ pending }) => pending.resolve(response({
      items: [{ id: "old-workspace-row" }], totalItems: 1, hasMore: false, nextCursor: null,
    })));
    await warming;
    assert.equal(requests.length, 2, "no later warm batch may start for the new workspace");
    assert.equal(model._paginatedQueryCache?.size || 0, 0);
  } finally {
    console.warn = previousWarn;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("active-role switch aborts pagination and clears role-scoped page cache", async () => {
  const previousFetch = globalThis.fetch;
  const previousSessionStorage = globalThis.sessionStorage;
  let aborted = false;
  globalThis.sessionStorage = { setItem() {} };
  globalThis.fetch = (_url, { signal } = {}) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      aborted = true;
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    }, { once: true });
  });
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a" };
  model.state.activeuser = { role: "manager" };
  model.state.activerole = "manager";
  model.getWorkspaceToken = () => "user:org-a@1";
  try {
    const pending = loadPaginatedRecords(model, "kehoach", { page: 1, pageSize: 10 });
    await new Promise((resolve) => setImmediate(resolve));
    model._paginatedQueryCache.set("seed", { fetchedAt: Date.now() });
    model.switchActiveRole("employee", "Nhân viên", "user-1");
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(aborted, true);
    assert.equal(model._paginationRequests.size, 0);
    assert.equal(model._paginatedQueryCache.size, 0);
  } finally {
    if (previousSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSessionStorage;
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("rapid tab switching keeps only the newest route and cleans stale transition metrics", async () => {
  const previousDocument = globalThis.document;
  const previousHistory = globalThis.history;
  const previousElement = globalThis.Element;
  class TestElement {}
  globalThis.Element = TestElement;
  const createClassList = () => {
    const tokens = new Set();
    return {
      add: (...names) => names.forEach((name) => tokens.add(name)),
      remove: (...names) => names.forEach((name) => tokens.delete(name)),
      contains: (name) => tokens.has(name),
      get active() { return tokens.has("active"); },
    };
  };
  const navTabs = ["kehoach", "goithau", "nhathau"].map((tab) => ({
    tab,
    classList: createClassList(),
    getAttribute(name) { return name === "data-tab" ? this.tab : null; },
  }));
  const panes = navTabs.map(({ tab }) => ({
    id: `tab-${tab}`,
    classList: createClassList(),
  }));
  const pageTitle = { textContent: "" };
  globalThis.document = {
    body: {},
    getElementById(id) { return panes.find((pane) => pane.id === id) || null; },
    querySelectorAll(selector) {
      if (selector === ".nav-btn") return navTabs;
      if (selector === ".tab-pane") return panes;
      return [];
    },
  };
  const historyCalls = [];
  globalThis.history = { pushState(...args) { historyCalls.push(args); }, replaceState() {} };
  const pendingModules = new Map(navTabs.map(({ tab }) => [tab, deferred()]));
  const readyModules = new Set();
  const rendered = [];
  const controller = {
    _workflowModulesReady: true,
    lazyTabPartials: {},
    model: {
      state: { activetab: "dashboard", activeaction: null, activerole: "manager", goithau: [], kehoach: [], hopdong: [], chudautu: [], nhathau: [] },
      hasActiveEffectiveRole: () => true,
    },
    routeMap: { kehoach: "ke-hoach", goithau: "goi-thau", nhathau: "nha-thau" },
    actionMap: {},
    view: {
      elements: { navButtons: navTabs, tabPanes: panes, pageTitle },
      areViewModulesReady: (tab) => readyModules.has(tab),
      ensureViewModules: (tab) => pendingModules.get(tab).promise,
    },
    renderTabData(tab) { rendered.push(tab); },
  };
  controller.switchTab = switchTab;
  try {
    const planTransition = controller.switchTab("kehoach");
    const packageTransition = controller.switchTab("goithau");
    const contractorTransition = controller.switchTab("nhathau");
    for (const tab of ["kehoach", "goithau", "nhathau"]) {
      readyModules.add(tab);
      pendingModules.get(tab).resolve();
    }
    await Promise.all([planTransition, packageTransition, contractorTransition]);
    assert.equal(controller.model.state.activetab, "nhathau");
    assert.deepEqual(rendered, ["nhathau"]);
    assert.equal(historyCalls.length, 1);
    assert.equal(historyCalls[0][2], "/nha-thau");
    assert.equal(navTabs.find(({ tab }) => tab === "nhathau").classList.active, true);
    assert.equal(panes.find(({ id }) => id === "tab-nhathau").classList.active, true);
    assert.equal(controller._tabPerfTransitions.size, 0);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHistory === undefined) delete globalThis.history;
    else globalThis.history = previousHistory;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});

test("slow navigation feedback appears after the delay and is always cleaned up", () => {
  const previousDocument = globalThis.document;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const tokens = () => {
    const values = new Set();
    return {
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      contains: (name) => values.has(name),
    };
  };
  const button = {
    classList: tokens(),
    getAttribute: (name) => name === "data-tab" ? "kehoach-detail" : null,
  };
  const attributes = new Map();
  const viewport = {
    classList: tokens(),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  let delayedCallback = null;
  globalThis.setTimeout = (callback) => {
    delayedCallback = callback;
    return 42;
  };
  globalThis.clearTimeout = () => {};
  globalThis.document = {
    querySelector: (selector) => selector === ".content-viewport" ? viewport : null,
    querySelectorAll: (selector) => selector === ".nav-btn" ? [button] : [],
  };
  const controller = {};
  try {
    beginNavigationFeedback(controller, "kehoach-detail", 7);
    assert.equal(button.classList.contains("bf-nav-intent"), true);
    assert.equal(viewport.classList.contains("bf-route-waiting"), false);
    assert.equal(attributes.has("aria-busy"), false);

    delayedCallback();
    assert.equal(button.classList.contains("bf-nav-waiting"), true);
    assert.equal(viewport.classList.contains("bf-route-waiting"), true);
    assert.equal(attributes.get("aria-busy"), "true");

    assert.equal(finishNavigationFeedback(controller, 7), true);
    assert.equal(button.classList.contains("bf-nav-intent"), false);
    assert.equal(button.classList.contains("bf-nav-waiting"), false);
    assert.equal(viewport.classList.contains("bf-route-waiting"), false);
    assert.equal(attributes.has("aria-busy"), false);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

test("a caught non-stale view-module failure shows feedback without reloading", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousError = console.error;
  const reloads = [];
  const toasts = [];
  const errors = [];
  const storage = new Map();
  globalThis.document = {
    body: {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = {
    location: {
      href: "https://demo.hosodauthau.online/tong-quan",
      origin: "https://demo.hosodauthau.online",
      reload: () => reloads.push(true),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  console.error = (...args) => errors.push(args);
  const controller = {
    _workflowModulesReady: true,
    actionMap: {},
    lazyTabPartials: {},
    model: {
      state: {
        activeaction: null,
        activetab: "dashboard",
        activerole: "manager",
        chudautu: [],
        goithau: [],
        hopdong: [],
        kehoach: [],
        nhathau: [],
      },
      hasActiveEffectiveRole: () => true,
    },
    routeMap: { kehoach: "ke-hoach" },
    view: {
      elements: { navButtons: [], tabPanes: [], pageTitle: { textContent: "" } },
      areViewModulesReady: () => false,
      ensureViewModules: () => Promise.reject(new Error("ordinary module bug")),
      showToast: (...args) => toasts.push(args),
    },
  };
  controller.switchTab = switchTab;
  try {
    await controller.switchTab("kehoach");
    assert.deepEqual(reloads, []);
    assert.equal(toasts.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(controller._tabPerfTransitions.size, 0);
    assert.equal(controller._navigationFeedback, null);
  } finally {
    console.error = previousError;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("caught view and workflow stale-bundle failures request exactly one guarded reload", async () => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousError = console.error;
  const reloads = [];
  const toasts = [];
  const errors = [];
  const storage = new Map();
  let viewModulesReady = false;
  let firefoxMessageReads = 0;
  globalThis.document = {
    body: {},
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  globalThis.window = {
    location: {
      href: "https://demo.hosodauthau.online/tong-quan",
      origin: "https://demo.hosodauthau.online",
      reload: () => reloads.push(true),
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value)),
    },
  };
  console.error = (...args) => errors.push(args);
  const controller = {
    _workflowModulesReady: true,
    actionMap: {},
    lazyTabPartials: {},
    model: {
      state: {
        activeaction: null,
        activetab: "dashboard",
        activerole: "manager",
        chudautu: [],
        goithau: [],
        hopdong: [],
        kehoach: [],
        nhathau: [],
      },
      hasActiveEffectiveRole: () => true,
    },
    routeMap: { kehoach: "ke-hoach", "goithau-detail": "goi-thau-chi-tiet" },
    view: {
      elements: { navButtons: [], tabPanes: [], pageTitle: { textContent: "" } },
      areViewModulesReady: () => viewModulesReady,
      ensureViewModules: () => Promise.reject(new TypeError(
        "Failed to fetch dynamically imported module: /dist/assets/KeHoachView-AbCdEf12.js",
      )),
      showToast: (...args) => toasts.push(args),
    },
  };
  controller.switchTab = switchTab;
  try {
    await controller.switchTab("kehoach");
    assert.equal(reloads.length, 1);
    assert.equal(toasts.length, 0, "the first stale failure should hand off to reload recovery");
    assert.equal(errors.length, 0);
    assert.equal(controller._tabPerfTransitions.size, 0);
    assert.equal(controller._navigationFeedback, null);

    viewModulesReady = true;
    controller._workflowModulesReady = false;
    controller.isWorkflowRequirementReady = () => false;
    controller.ensureWorkflowRequirement = () => Promise.reject({
      name: "TypeError",
      get message() {
        firefoxMessageReads += 1;
        return "error loading dynamically imported module: /dist/assets/BiddingWorkflows-QwErTy12.js";
      },
    });
    await controller.switchTab("goithau-detail");

    assert.ok(firefoxMessageReads > 0, "the caught workflow error must reach stale-bundle recovery");
    assert.equal(reloads.length, 1, "the session guard must prevent a second automatic reload");
    assert.equal(toasts.length, 1, "a guarded repeat failure must retain actionable UI feedback");
    assert.equal(errors.length, 1);
    assert.equal(controller._tabPerfTransitions.size, 0);
    assert.equal(controller._navigationFeedback, null);
  } finally {
    console.error = previousError;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test("an asynchronous tab render failure is reported without an unhandled rejection", async () => {
  const previousDocument = globalThis.document;
  const previousHistory = globalThis.history;
  const previousElement = globalThis.Element;
  const previousError = console.error;
  class TestElement {}
  globalThis.Element = TestElement;
  globalThis.document = {
    body: {},
    getElementById(id) { return id === "tab-kehoach" ? {} : null; },
    querySelectorAll() { return []; },
  };
  globalThis.history = { pushState() {}, replaceState() {} };
  const errors = [];
  const toasts = [];
  console.error = (...args) => errors.push(args);
  const controller = {
    _workflowModulesReady: true,
    lazyTabPartials: {},
    model: {
      state: { activetab: "dashboard", activeaction: null, activerole: "manager", goithau: [], kehoach: [], hopdong: [], chudautu: [], nhathau: [] },
      hasActiveEffectiveRole: () => true,
    },
    routeMap: { kehoach: "ke-hoach" },
    actionMap: {},
    view: {
      elements: { navButtons: [], tabPanes: [], pageTitle: { textContent: "" } },
      areViewModulesReady: () => true,
      showToast: (...args) => toasts.push(args),
    },
    renderTabData: async () => { throw new Error("render failed"); },
  };
  controller.switchTab = switchTab;
  try {
    await controller.switchTab("kehoach");
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "Failed to render tab:");
    assert.equal(toasts.length, 1);
    assert.equal(controller._tabPerfTransitions.size, 0);
  } finally {
    console.error = previousError;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousHistory === undefined) delete globalThis.history;
    else globalThis.history = previousHistory;
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});

test("all paginated main-list renderers preserve cached rows instead of painting a skeleton", () => {
  const rendererPaths = [
    "frontend/plans/KeHoachView.js",
    "frontend/packages/GoiThauTable.js",
    "frontend/partners/ChuDauTuComponent.js",
    "frontend/partners/NhaThauComponent.js",
    "frontend/experts/ChuyenGiaComponent.js",
    "frontend/contracts/HopDongComponent.js",
  ];
  rendererPaths.forEach((path) => {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /getCachedPaginatedRecords\([\s\S]{0,500}renderTableLoading/,
      `${path} must guard its loading skeleton with the exact query cache`);
  });
});
