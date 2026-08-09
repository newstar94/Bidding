import test from "node:test";
import assert from "node:assert/strict";
import DOMPurify from "../../node_modules/dompurify/dist/purify.es.mjs";

import { BiddingController } from "../../frontend/app/BiddingController.js";
import { initializeNotificationCenter } from "../../frontend/app/NotificationCenter.js";
import { fetchRecordByLookup } from "../../frontend/app/SyncPullService.js";
import { reloadEmployeesFromDatabase } from "../../frontend/admin/AdminUserController.js";
import { loadWorkspaceEmployees } from "../../frontend/shared/workspaceEmployeeLoader.js";
import {
  loadWordMappings,
  loadWordTemplates,
} from "../../frontend/documents/WordIntegration.js";
import {
  fetchTimelinePackage,
  fetchTimelinePlan,
} from "../../frontend/packages/PackageTimelineView.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("record lookup started in workspace A cannot cache into workspace B", async () => {
  const response = deferred();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => response.promise;

  const writesA = [];
  const writesB = [];
  const stateA = { goithau: [] };
  const stateB = { goithau: [] };
  const dbA = {
    async putRecord(table, record) {
      writesA.push([table, record]);
    },
  };
  const dbB = {
    async putRecord(table, record) {
      writesB.push([table, record]);
    },
  };
  let token = "user:org-a@1";
  const model = {
    db: dbA,
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    normalizeRecordKeys: (record) => record,
  };

  try {
    const lookup = fetchRecordByLookup.call({ model }, "goithau", "pkg-a");

    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = dbB;
    response.resolve({
      ok: true,
      async json() {
        return { item: { id: "pkg-a", organizationId: "org-a" } };
      },
    });

    await assert.rejects(lookup, (error) => (
      error?.name === "AbortError" && error?.code === "WORKSPACE_CHANGED"
    ));
    assert.deepEqual(stateA.goithau, []);
    assert.deepEqual(stateB.goithau, []);
    assert.deepEqual(writesA, []);
    assert.deepEqual(writesB, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("background init responses from workspace A cannot populate workspace B", async () => {
  const usersResponse = deferred();
  const packagesResponse = deferred();
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousIdleCallback = globalThis.requestIdleCallback;
  let scheduledLoad = null;
  globalThis.fetch = (url) => (
    String(url).includes("/api/auth/users") ? usersResponse.promise : packagesResponse.promise
  );
  globalThis.requestIdleCallback = (callback) => {
    scheduledLoad = callback;
    return 1;
  };
  globalThis.window = { requestIdleCallback: globalThis.requestIdleCallback };

  const stateA = { employees: [], systempackages: [] };
  const stateB = { employees: [], systempackages: [] };
  let token = "user:org-a@1";
  const persistCalls = [];
  const dropdownCalls = [];
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    persistData: async (table) => persistCalls.push(table),
  };
  const controller = {
    model,
    view: {
      populateNhanVienPhuTrachDropdowns: () => dropdownCalls.push(token),
    },
  };

  try {
    BiddingController.prototype.loadInitDataInBackground.call(controller);
    assert.equal(typeof scheduledLoad, "function");
    const load = scheduledLoad();

    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    usersResponse.resolve(new Response(JSON.stringify([{
      id: "user-a",
      name: "User A",
      role: "employee",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    packagesResponse.resolve(new Response(JSON.stringify([{
      id: "package-a",
      name: "Package A",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    await load;

    assert.deepEqual(stateA.employees, []);
    assert.deepEqual(stateA.systempackages, []);
    assert.deepEqual(stateB.employees, []);
    assert.deepEqual(stateB.systempackages, []);
    assert.deepEqual(persistCalls, []);
    assert.deepEqual(dropdownCalls, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousIdleCallback === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = previousIdleCallback;
  }
});

test("admin employee reload from workspace A cannot update workspace B", async () => {
  const usersResponse = deferred();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    if (String(url).includes("/api/auth/users")) return usersResponse.promise;
    return Promise.resolve(new Response(JSON.stringify([{ id: "former-a" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };

  const stateA = { employees: [], formerEmployees: [] };
  const stateB = { employees: [], formerEmployees: [] };
  let token = "user:org-a@1";
  const persistCalls = [];
  const dropdownCalls = [];
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    persistData: async (table) => persistCalls.push(table),
  };

  try {
    const reload = reloadEmployeesFromDatabase.call({
      model,
      view: {
        populateNhanVienPhuTrachDropdowns: () => dropdownCalls.push(token),
      },
    });
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    usersResponse.resolve(new Response(JSON.stringify([{
      id: "user-a",
      name: "User A",
      role: "employee",
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    await reload;

    assert.deepEqual(stateA, { employees: [], formerEmployees: [] });
    assert.deepEqual(stateB, { employees: [], formerEmployees: [] });
    assert.deepEqual(persistCalls, []);
    assert.deepEqual(dropdownCalls, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("notification refresh from workspace A cannot render into workspace B", async () => {
  const staleResponse = deferred();
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousSanitize = DOMPurify.sanitize;
  const previousIsSupported = DOMPurify.isSupported;
  DOMPurify.isSupported = true;
  DOMPurify.sanitize = (value) => String(value);
  let requestCount = 0;
  globalThis.fetch = () => {
    requestCount += 1;
    if (requestCount === 1) {
      return Promise.resolve(new Response(JSON.stringify({ items: [], unreadCount: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    return staleResponse.promise;
  };

  const listeners = new Map();
  const element = (extra = {}) => ({
    addEventListener(type, handler) {
      listeners.set(`${extra.id || "element"}:${type}`, handler);
    },
    setAttribute() {},
    ...extra,
  });
  const elements = {
    "notification-center": element({ id: "root", dataset: {} }),
    "notification-trigger": element({ id: "trigger" }),
    "notification-badge": element({ id: "badge", hidden: true, textContent: "" }),
    "notification-panel": element({ id: "panel", hidden: true }),
    "notification-read-all": element({ id: "read-all", disabled: true }),
    "notification-list": element({ id: "list", innerHTML: "" }),
  };
  globalThis.document = {
    hidden: false,
    getElementById: (id) => elements[id] || null,
    addEventListener() {},
  };
  globalThis.window = {
    lucide: { createIcons() {} },
    setInterval: () => 1,
  };

  const stateA = {};
  const stateB = {};
  let token = "user:org-a@1";
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    getFilteredGoiThau: () => [],
    getFilteredKeHoach: () => [],
    getFilteredHopDong: () => [],
  };

  try {
    const center = initializeNotificationCenter({ model });
    await new Promise((resolve) => setImmediate(resolve));
    const beforeMarkup = elements["notification-list"].innerHTML;
    const beforeBadge = {
      hidden: elements["notification-badge"].hidden,
      textContent: elements["notification-badge"].textContent,
    };
    const refresh = center.refresh();

    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    staleResponse.resolve(new Response(JSON.stringify({
      items: [{
        id: "notification-a",
        title: "Workspace A",
        message: "Private A",
        createdAt: "2026-08-09T00:00:00Z",
      }],
      unreadCount: 1,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    await refresh;

    assert.equal(elements["notification-list"].innerHTML, beforeMarkup);
    assert.deepEqual({
      hidden: elements["notification-badge"].hidden,
      textContent: elements["notification-badge"].textContent,
    }, beforeBadge);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    DOMPurify.sanitize = previousSanitize;
    DOMPurify.isSupported = previousIsSupported;
  }
});

test("package and contract employee loader cannot commit users after workspace switch", async () => {
  const usersResponse = deferred();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => usersResponse.promise;

  const stateA = { employees: [] };
  const stateB = { employees: [] };
  let token = "user:org-a@1";
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
  };
  const renderCalls = [];

  try {
    const load = loadWorkspaceEmployees(model, {
      onLoaded: () => renderCalls.push(token),
    });
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    usersResponse.resolve(new Response(JSON.stringify([{
      id: "user-a",
      name: "User A",
      email: "a@example.test",
      role: "employee",
    }]), { status: 200, headers: { "content-type": "application/json" } }));

    await assert.rejects(load, (error) => (
      error?.name === "AbortError" && error?.code === "WORKSPACE_CHANGED"
    ));
    assert.deepEqual(stateA.employees, []);
    assert.deepEqual(stateB.employees, []);
    assert.deepEqual(renderCalls, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("Word template response from workspace A cannot render or chain into workspace B", async () => {
  const templatesResponse = deferred();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => templatesResponse.promise;

  const stateA = {};
  const stateB = {};
  let token = "user:org-a@1";
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
  };
  const rendered = [];
  const activationCalls = [];
  const mappingCalls = [];
  const controller = {
    model,
    view: { renderWordTemplates: (templates) => rendered.push(templates) },
    setupTemplateActivationEvents: () => activationCalls.push(token),
    loadWordMappings: async () => mappingCalls.push(token),
  };

  try {
    const load = loadWordTemplates.call(controller);
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    templatesResponse.resolve(new Response(JSON.stringify([{ filename: "private-a.docx" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await load;

    assert.deepEqual(rendered, []);
    assert.deepEqual(activationCalls, []);
    assert.deepEqual(mappingCalls, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
});

test("Word mapping response from workspace A cannot update state or DOM in workspace B", async () => {
  const mappingsResponse = deferred();
  const previousFetch = globalThis.fetch;
  const previousDocument = globalThis.document;
  globalThis.fetch = () => mappingsResponse.promise;
  globalThis.document = { getElementById: () => null };

  const stateA = { wordMappings: [] };
  const stateB = { wordMappings: [] };
  let token = "user:org-a@1";
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
  };
  const renderedMappings = [];
  const renderedDictionaries = [];
  const copyEvents = [];
  const controller = {
    model,
    _disabledWordMappings: [],
    view: {
      renderWordMappingsTable: (mappings) => renderedMappings.push(mappings),
      renderDictionary: (group) => renderedDictionaries.push(group),
    },
    setupCopyVariableEvents: () => copyEvents.push(token),
  };

  try {
    const load = loadWordMappings.call(controller);
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    mappingsResponse.resolve(new Response(JSON.stringify([{
      id: "mapping-a",
      variable: "PRIVATE_A",
      disabled: false,
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    await load;

    assert.deepEqual(stateA.wordMappings, []);
    assert.deepEqual(stateB.wordMappings, []);
    assert.deepEqual(controller._disabledWordMappings, []);
    assert.deepEqual(renderedMappings, []);
    assert.deepEqual(renderedDictionaries, []);
    assert.deepEqual(copyEvents, []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

async function assertTimelineLookupIsWorkspaceFenced(fetchTimelineRecord, table, item) {
  const recordResponse = deferred();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => recordResponse.promise;
  const stateA = { [table]: [] };
  const stateB = { [table]: [] };
  let token = "user:org-a@1";
  const model = {
    db: { name: "db-a" },
    state: stateA,
    workspaceScope: { key: "user:org-a" },
    getWorkspaceToken: () => token,
    normalizeRecordKeys: (record) => record,
  };

  try {
    const lookup = fetchTimelineRecord({ model }, item.id);
    token = "user:org-b@2";
    model.workspaceScope = { key: "user:org-b" };
    model.state = stateB;
    model.db = { name: "db-b" };
    recordResponse.resolve(new Response(JSON.stringify({ item }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    await assert.rejects(lookup, (error) => (
      error?.name === "AbortError" && error?.code === "WORKSPACE_CHANGED"
    ));
    assert.deepEqual(stateA[table], []);
    assert.deepEqual(stateB[table], []);
  } finally {
    if (previousFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = previousFetch;
  }
}

test("timeline package fetch from workspace A cannot cache into workspace B", async () => {
  await assertTimelineLookupIsWorkspaceFenced(fetchTimelinePackage, "goithau", {
    id: "package-a",
    organizationId: "org-a",
  });
});

test("timeline plan fetch from workspace A cannot cache into workspace B", async () => {
  await assertTimelineLookupIsWorkspaceFenced(fetchTimelinePlan, "kehoach", {
    id: "plan-a",
    organizationId: "org-a",
  });
});
