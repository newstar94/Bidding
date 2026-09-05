import assert from "node:assert/strict";
import test from "node:test";

import {
  reAddEmployee,
  setupRBACEvents,
} from "../../frontend/admin/AdminUserController.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function installGlobals(values) {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
  }
  return () => {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

function emptyDocument(elements = {}) {
  const listeners = new Map();
  return {
    cookie: "csrf_token=test-token",
    listeners,
    addEventListener(type, listener) { listeners.set(type, listener); },
    getElementById(id) { return elements[id] || null; },
    querySelectorAll() { return []; },
  };
}

test("active-role shell renders before the previous persona snapshot purge completes", async () => {
  const purge = deferred();
  const events = [];
  const document = emptyDocument();
  const sessionStorage = memoryStorage({ bf_active_org: "org-1", bf_user_id: "user-1" });
  const restore = installGlobals({
    document,
    fetch: async () => new Response(JSON.stringify({ activeRole: "employee" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    history: { pushState() { events.push("route"); } },
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage,
    window: { location: { pathname: "/tong-quan" } },
  });
  try {
    const button = {
      disabled: false,
      attributes: new Map([["data-switch-role", "employee"]]),
      getAttribute(name) { return this.attributes.get(name) || null; },
      removeAttribute(name) { this.attributes.delete(name); },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
    };
    const controller = {
      model: {
        state: { activeuser: { id: "user-1", name: "Người dùng", dbRoles: ["manager"] } },
        switchActiveRole(role) {
          this.state.activerole = role;
          events.push("role-confirmed");
        },
        async prepareWorkspaceRoleTransition() { events.push("memory-cleared"); },
        async purgeWorkspaceData() { events.push("purge-start"); await purge.promise; },
        async init() { events.push("local-ready"); },
      },
      view: {
        updateActiveUserProfileDisplay() {},
        showToast() {},
        async customAlert() {},
      },
      switchTab() { events.push("shell-rendered"); },
      initializeStartupReconciliation() { events.push("boundary-ready"); },
      reconcileInitialRouteData() { events.push("reconcile-start"); return Promise.resolve(true); },
      scheduleRemainingStorageHydration(reconciliation) {
        events.push("hydration-scheduled");
        void reconciliation.then(() => events.push("hydration-after-reconcile"));
      },
      scheduleReferenceDataLoading(reconciliation) {
        events.push("reference-scheduled");
        void reconciliation.then(() => events.push("reference-after-reconcile"));
      },
      renderWorkspaceSwitcher() {},
      setupWebSocketConnection() {},
      getStartupPriorityKeys() { return []; },
    };
    setupRBACEvents.call(controller);

    const handling = document.listeners.get("click")({
      target: { closest: () => button },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(events.includes("shell-rendered"), "target dashboard must paint immediately");
    assert.ok(events.includes("purge-start"), "old role snapshot still has to be purged");
    assert.ok(!events.includes("local-ready"), "the test must keep durable purge pending");

    purge.resolve();
    await handling;
    assert.ok(events.indexOf("memory-cleared") < events.indexOf("shell-rendered"));
    assert.ok(events.indexOf("shell-rendered") < events.indexOf("local-ready"));
    assert.ok(events.indexOf("reconcile-start") < events.indexOf("hydration-after-reconcile"));
    assert.ok(events.indexOf("reconcile-start") < events.indexOf("reference-after-reconcile"));
  } finally {
    purge.resolve();
    restore();
  }
});

test("active-role route loading overlaps durable persona purge", async () => {
  const route = deferred();
  const purge = deferred();
  const events = [];
  const document = emptyDocument();
  const restore = installGlobals({
    document,
    fetch: async () => new Response(JSON.stringify({ activeRole: "employee" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    history: { pushState() { events.push("route"); } },
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage: memoryStorage({ bf_active_org: "org-1", bf_user_id: "user-1" }),
    window: { location: { pathname: "/tong-quan" } },
  });
  try {
    const button = {
      disabled: false,
      getAttribute: () => "employee",
      removeAttribute() {},
      setAttribute() {},
    };
    const controller = {
      model: {
        state: { activeuser: { id: "user-1", name: "Người dùng", dbRoles: ["manager"] } },
        switchActiveRole(roleName) { this.state.activerole = roleName; },
        async prepareWorkspaceRoleTransition() {},
        async purgeWorkspaceData() {
          events.push("purge-start");
          await purge.promise;
          events.push("purge-complete");
        },
        async init() { events.push("local-ready"); },
      },
      view: {
        updateActiveUserProfileDisplay() {},
        async customAlert() {},
      },
      async switchTab() {
        events.push("route-start");
        await route.promise;
        events.push("route-complete");
      },
      initializeStartupReconciliation() {},
      reconcileInitialRouteData() { return Promise.resolve(true); },
      getStartupPriorityKeys() { return []; },
    };
    setupRBACEvents.call(controller);

    const handling = document.listeners.get("click")({ target: { closest: () => button } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(events.includes("route-start"));
    assert.ok(events.includes("purge-start"), "purge must not wait for route dependencies");
    assert.ok(!events.includes("local-ready"));

    route.resolve();
    purge.resolve();
    await handling;
    assert.ok(events.indexOf("route-complete") < events.indexOf("local-ready"));
    assert.ok(events.indexOf("purge-complete") < events.indexOf("local-ready"));
  } finally {
    route.resolve();
    purge.resolve();
    restore();
  }
});

for (const failure of [
  { name: "403", response: () => new Response(JSON.stringify({ error: "Không có quyền", requestId: "req-403" }), { status: 403, headers: { "content-type": "application/json" } }) },
  { name: "409", response: () => new Response(JSON.stringify({ error: "Phiên đã thay đổi" }), { status: 409, headers: { "content-type": "application/json" } }) },
  { name: "invalid JSON", response: () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }) },
  { name: "network failure", response: () => { throw new TypeError("network down"); } },
]) {
  test(`active-role ${failure.name} keeps persona route cache and workspace generation unchanged`, async () => {
    const events = [];
    const document = emptyDocument();
    const restore = installGlobals({
      document,
      fetch: async () => failure.response(),
      history: { pushState() { events.push("route"); } },
      localStorage: memoryStorage({ bf_active_org: "org-1" }),
      location: { origin: "http://localhost" },
      navigator: { onLine: true },
      sessionStorage: memoryStorage({ bf_active_org: "org-1", bf_user_id: "user-1" }),
      window: { location: { pathname: "/goi-thau" } },
    });
    try {
      const button = {
        disabled: false,
        attributes: new Map([["data-switch-role", "employee"]]),
        getAttribute(name) { return this.attributes.get(name) || null; },
        removeAttribute(name) { this.attributes.delete(name); },
        setAttribute(name, value) { this.attributes.set(name, String(value)); },
      };
      const controller = {
        model: {
          state: { activeuser: { id: "user-1", name: "Người dùng", dbRoles: ["manager"] }, activerole: "manager" },
          constructor: { resolveAllowedActiveRole: (_user, role) => role },
          switchActiveRole() { events.push("role"); },
          prepareWorkspaceRoleTransition() { events.push("clear"); },
          purgeWorkspaceData() { events.push("purge"); },
          init() { events.push("init"); },
        },
        view: {
          updateActiveUserProfileDisplay() { events.push("profile"); },
          async customAlert(_title, message) { events.push(`alert:${message}`); },
        },
        switchTab() { events.push("tab"); },
      };
      setupRBACEvents.call(controller);
      await document.listeners.get("click")({ target: { closest: () => button } });
      assert.deepEqual(events.filter((event) => ["role", "route", "clear", "purge", "init", "profile", "tab"].includes(event)), []);
      assert.equal(controller.model.state.activerole, "manager");
      assert.equal(button.disabled, false);
      if (failure.name === "403") assert.match(events.find((event) => event.startsWith("alert:")), /req-403/u);
    } finally {
      restore();
    }
  });
}

test("active-role rejects a server role outside the user's allowed set", async () => {
  const events = [];
  const document = emptyDocument();
  const restore = installGlobals({
    document,
    fetch: async () => new Response(JSON.stringify({ activeRole: "super_admin" }), { status: 200, headers: { "content-type": "application/json" } }),
    history: { pushState() { events.push("route"); } },
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage: memoryStorage({ bf_active_org: "org-1", bf_user_id: "user-1" }),
    window: { location: { pathname: "/tong-quan" } },
  });
  try {
    const button = {
      disabled: false,
      attributes: new Map([["data-switch-role", "employee"]]),
      getAttribute(name) { return this.attributes.get(name) || null; },
      removeAttribute(name) { this.attributes.delete(name); },
      setAttribute(name, value) { this.attributes.set(name, String(value)); },
    };
    const controller = {
      model: {
        state: { activeuser: { id: "user-1", dbRoles: ["employee"] }, activerole: "employee" },
        constructor: { resolveAllowedActiveRole: () => "employee" },
        switchActiveRole() { events.push("role"); },
      },
      view: { async customAlert(_title, message) { events.push(`alert:${message}`); } },
    };
    setupRBACEvents.call(controller);
    await document.listeners.get("click")({ target: { closest: () => button } });
    assert.ok(!events.includes("role"));
    assert.match(events.find((event) => event.startsWith("alert:")), /không hợp lệ/u);
  } finally {
    restore();
  }
});

test("confirmed organization member renders before background reload and sync complete", async () => {
  const reload = deferred();
  const sync = deferred();
  const events = [];
  const submitButton = {
    disabled: false,
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
  const form = {
    attributes: new Map(),
    listener: null,
    addEventListener(_type, listener) { this.listener = listener; },
    querySelector() { return submitButton; },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
  const input = (value) => ({ value });
  const document = emptyDocument({
    "form-manager-employee": form,
    "form-employee-id": input(""),
    "emp-name": input("Nguyễn Văn A"),
    "emp-phone": input("0900000000"),
    "emp-email": input("a@example.test"),
  });
  let requestCount = 0;
  const restore = installGlobals({
    document,
    fetch: async () => {
      requestCount += 1;
      const payload = requestCount === 1
        ? { candidate: { id: "employee-1", name: "Nguyễn Văn A", email: "a@example.test" } }
        : { success: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage: memoryStorage({ bf_active_org: "org-1" }),
  });
  try {
    const controller = {
      model: {
        state: {
          activeuser: {
            organizations: [{
              id: "org-1",
              name: "Tổ chức 1",
              role: "manager",
              scope_type: "organization",
              status: "active",
              subscription: { member_quota: 10, member_count: 1 },
            }],
          },
          employees: [],
          permissionmatrix: [{ empId: "employee-1" }],
          assignments: [],
        },
        async persistChanges() { events.push("local-durable"); },
      },
      view: {
        validateForm: () => true,
        closeModal() { events.push("modal-closed"); },
        renderManagerNhanVienPanel() { events.push("panel-rendered"); },
        showToast() { events.push("toast"); },
        async customAlert() {},
      },
      reloadEmployeesFromDatabase() { events.push("reload-start"); return reload.promise; },
      autoSync() { events.push("sync-start"); return sync.promise; },
    };
    setupRBACEvents.call(controller);

    let settled = false;
    const handling = form.listener({ preventDefault() {} }).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(settled, true, "submit must not wait for the authoritative reload or sync");
    assert.deepEqual(controller.model.state.employees.map(({ id }) => id), ["employee-1"]);
    assert.ok(events.indexOf("local-durable") < events.indexOf("modal-closed"));
    assert.ok(events.indexOf("modal-closed") < events.indexOf("reload-start"));
    assert.equal(form.attributes.get("aria-busy"), "false");
    assert.equal(submitButton.disabled, false);

    reload.resolve();
    sync.resolve({ ok: true });
    await handling;
  } finally {
    reload.resolve();
    sync.resolve({ ok: true });
    restore();
  }
});

test("member quota conflict leaves local membership permission and assignments unchanged", async () => {
  const submitButton = {
    disabled: false,
    setAttribute() {},
  };
  const form = {
    listener: null,
    addEventListener(_type, listener) { this.listener = listener; },
    querySelector() { return submitButton; },
    setAttribute() {},
  };
  const input = (value) => ({ value });
  const document = emptyDocument({
    "form-manager-employee": form,
    "form-employee-id": input(""),
    "emp-name": input("Nguyễn Văn A"),
    "emp-phone": input("0900000000"),
    "emp-email": input("a@example.test"),
  });
  let requestCount = 0;
  const restore = installGlobals({
    document,
    fetch: async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({
          candidate: { id: "employee-1", name: "Nguyễn Văn A", email: "a@example.test" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        code: "MEMBER_QUOTA_EXCEEDED",
        error: "Đã đạt giới hạn nhân sự.",
      }), { status: 409, headers: { "content-type": "application/json" } });
    },
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage: memoryStorage({ bf_active_org: "org-1" }),
  });
  try {
    const initialPermission = [{ id: "permission-existing", empId: "employee-existing" }];
    const initialAssignments = [{ id: "assignment-existing", empId: "employee-existing" }];
    const alerts = [];
    const controller = {
      model: {
        state: {
          activeuser: {
            organizations: [{
              id: "org-1", role: "manager", scope_type: "organization", status: "active",
              subscription: { member_quota: 1, member_count: 1 },
            }],
          },
          employees: [],
          permissionmatrix: [...initialPermission],
          assignments: [...initialAssignments],
        },
        async persistChanges() { assert.fail("409 must not persist local membership"); },
      },
      view: {
        validateForm: () => true,
        async customAlert(title, message) { alerts.push([title, message]); },
      },
    };
    setupRBACEvents.call(controller);
    await form.listener({ preventDefault() {} });

    assert.deepEqual(controller.model.state.employees, []);
    assert.deepEqual(controller.model.state.permissionmatrix, initialPermission);
    assert.deepEqual(controller.model.state.assignments, initialAssignments);
    assert.match(alerts.at(-1)?.[1] || "", /giới hạn nhân sự/u);
  } finally {
    restore();
  }
});

test("restored organization member renders before background reload and sync complete", async () => {
  const reload = deferred();
  const sync = deferred();
  const events = [];
  const restore = installGlobals({
    document: emptyDocument(),
    fetch: async () => new Response(JSON.stringify({ success: true, message: "Đã thêm lại" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    localStorage: memoryStorage({ bf_active_org: "org-1" }),
    location: { origin: "http://localhost" },
    navigator: { onLine: true },
    sessionStorage: memoryStorage({ bf_active_org: "org-1" }),
  });
  try {
    const employee = { id: "employee-2", name: "Trần Văn B", email: "b@example.test" };
    const controller = {
      model: {
        state: {
          employees: [],
          formerEmployees: [employee],
          permissionmatrix: [{ empId: employee.id }],
        },
        async persistChanges() { events.push("local-durable"); },
      },
      view: {
        async customConfirm() { return true; },
        async customAlert() {},
        renderManagerNhanVienPanel() { events.push("panel-rendered"); },
        showToast() { events.push("toast"); },
      },
      reloadEmployeesFromDatabase() { events.push("reload-start"); return reload.promise; },
      autoSync() { events.push("sync-start"); return sync.promise; },
    };

    let settled = false;
    const handling = reAddEmployee.call(controller, employee.id).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(settled, true, "restoring a member must not await reload or synchronization");
    assert.deepEqual(controller.model.state.employees.map(({ id }) => id), [employee.id]);
    assert.deepEqual(controller.model.state.formerEmployees, []);
    assert.ok(events.indexOf("local-durable") < events.indexOf("panel-rendered"));
    assert.ok(events.indexOf("panel-rendered") < events.indexOf("reload-start"));

    reload.resolve();
    sync.resolve({ ok: true });
    await handling;
  } finally {
    reload.resolve();
    sync.resolve({ ok: true });
    restore();
  }
});
