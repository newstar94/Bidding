import assert from "node:assert/strict";
import test from "node:test";

import { BiddingController } from "../../frontend/app/BiddingController.js";


function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}


test("workspace switch forces an authoritative pull before rendering", async () => {
  const globalNames = [
    "CustomEvent",
    "document",
    "localStorage",
    "navigator",
    "sessionStorage",
    "window",
  ];
  const previousGlobals = Object.fromEntries(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const session = memoryStorage({ bf_active_org: "personal:user-1" });
  const local = memoryStorage({ bf_active_org: "personal:user-1" });
  const installGlobal = (name, value) => Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true,
  });
  installGlobal("sessionStorage", session);
  installGlobal("localStorage", local);
  installGlobal("document", {
    getElementById() { return null; },
    querySelector() { return null; },
  });
  installGlobal("navigator", { onLine: true });
  installGlobal("CustomEvent", class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  });
  installGlobal("window", {
    dispatchEvent() {},
    location: { pathname: "/tong-quan" },
  });

  try {
    const syncCalls = [];
    const pushCalls = [];
    const activeUser = {
      id: "user-1",
      name: "Chuyên viên",
      platformRole: "user",
      organizations: [
        {
          id: "personal:user-1",
          name: "Cá nhân",
          role: "employee",
          scope_type: "personal",
          status: "active",
        },
        {
          id: "org-hcp",
          name: "HCP",
          role: "employee",
          scope_type: "organization",
          status: "active",
        },
      ],
    };
    const model = {
      STORAGE_KEYS: { ACTIVEROLE: "bf_active_role", ACTIVEUSER: "bf_active_user" },
      beginWorkspaceTransition() {},
      constructor: {
        getRoleTitle: () => "Chuyên viên",
        resolveAllowedActiveRole: () => "employee",
      },
      endWorkspaceTransition() {},
      async init({ organizationId }) {
        this.workspaceScope = { organizationId };
      },
      state: { activeuser: activeUser, activerole: "employee" },
      async waitForWorkspaceMutations() {},
      workspaceScope: { organizationId: "personal:user-1" },
    };
    const controller = Object.create(BiddingController.prototype);
    Object.assign(controller, {
      _pendingDetailRecordLoads: new Map(),
      _workspacePullGenerations: new Map(),
      _startupReconciliationPromise: Promise.resolve({ ok: false, stale: true }),
      autoSync: async () => {
        pushCalls.push("push");
        return { ok: true };
      },
      disconnectWebSocket() {},
      forceSyncData: async (...args) => {
        syncCalls.push(args);
        return { ok: true };
      },
      getStartupPriorityKeys: () => ["GOITHAU", "ASSIGNMENTS"],
      model,
      renderWorkspaceSwitcher() {},
      setupWebSocketConnection() {},
      async switchTab() {},
      view: {
        _dashboardAggregateCache: null,
        updateActiveUserProfileDisplay() {},
      },
    });

    await controller.switchWorkspaceContext("org-hcp");

    assert.deepEqual(
      syncCalls,
      [[false, true]],
      "a workspace boundary must not reuse a previous delta cursor",
    );
    assert.equal(model.workspaceScope.organizationId, "org-hcp");
    assert.equal(session.getItem("bf_active_org"), "org-hcp");
    assert.deepEqual(
      pushCalls,
      [],
      "workspace switching must not wait on a stale startup pull before changing scope",
    );
  } finally {
    globalNames.forEach((name) => {
      const descriptor = previousGlobals[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
});
