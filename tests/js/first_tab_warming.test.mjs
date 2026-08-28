import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import {
  beginNavigationFeedback,
  finishNavigationFeedback,
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

test("primary warming serializes optional view chunks before starting page prefetch", async () => {
  const previousFetch = globalThis.fetch;
  const gates = Object.fromEntries(
    ["kehoach", "chudautu", "goithau-timeline"].map((tab) => [tab, deferred()]),
  );
  const calls = [];
  globalThis.fetch = async () => {
    calls.push("paginate");
    return response({ items: [], totalItems: 0, hasMore: false, nextCursor: null });
  };
  const controller = Object.create(BiddingController.prototype);
  controller.model = {
    useServerSidePagination: true,
    pageSize: 10,
    getWorkspaceToken: () => "user:org-a@1",
    workspaceScope: { key: "user:org-a" },
    state: { activetab: "dashboard", kehoach: [], goithau: [], chudautu: [], nhathau: [], chuyengia: [], hopdong: [] },
    normalizeRecordKeys: (record) => record,
    entityIndexes: { invalidate() {} },
  };
  controller.view = {
    elements: { navButtons: [] },
    ensureViewModules(tab) {
      calls.push(`module:${tab}`);
      return gates[tab].promise;
    },
  };
  try {
    const warming = controller.warmPrimaryTabs();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["module:kehoach"]);
    gates.kehoach.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, ["module:kehoach", "module:chudautu"]);
    gates.chudautu.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(calls, [
      "module:kehoach",
      "module:chudautu",
      "module:goithau-timeline",
    ]);
    gates["goithau-timeline"].resolve();
    await warming;
    assert.equal(calls.filter((call) => call === "paginate").length, 6);
  } finally {
    Object.values(gates).forEach(({ resolve }) => resolve());
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
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

test("view-module warming reports a failure without rejecting the background task", async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  const controller = Object.create(BiddingController.prototype);
  controller.model = { useServerSidePagination: false };
  controller.view = {
    elements: { navButtons: [] },
    ensureViewModules: async () => { throw new Error("chunk unavailable"); },
  };
  try {
    assert.equal(await controller.warmTab("kehoach"), null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Could not warm view module/);
  } finally {
    console.warn = previousWarn;
  }
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
