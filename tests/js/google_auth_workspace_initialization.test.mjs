import assert from "node:assert/strict";
import test from "node:test";

import {
  continueGoogleLoginAfterAuthentication,
  initializeGoogleWorkspaceAfterAuthentication,
} from "../../frontend/auth/GoogleAuthController.js";


function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}


test("fresh AuthShell Google login reloads before admin or model initialization", async () => {
  const events = [];
  const controller = {
    _workspaceDeferredUntilReload: true,
    constructor: Object,
    model: {
      async init() { events.push("model-init"); },
    },
    async _finishGoogleLogin(activeRole) {
      events.push(`reload:${activeRole}`);
    },
  };

  const result = await initializeGoogleWorkspaceAfterAuthentication(
    controller,
    { effective_roles: ["manager"] },
    "manager",
    { installAdmin: async () => events.push("admin-install") },
  );

  assert.deepEqual(events, ["reload:manager"]);
  assert.deepEqual(result, { deferredUntilReload: true });
});


test("fresh Google account requiring a username completes the modal before reload", async () => {
  const events = [];
  let completeUsername;
  const controller = {
    _workspaceDeferredUntilReload: true,
    constructor: Object,
    model: {
      async init() { events.push("model-init"); },
    },
    _showSetUsernameModal(activeRole, onSuccess, suggestedUsername, accountLinked) {
      events.push(["username-modal", activeRole, suggestedUsername, accountLinked]);
      completeUsername = onSuccess;
    },
    async _finishGoogleLogin(activeRole) {
      events.push(`reload:${activeRole}`);
    },
  };
  const data = {
    account_linked: true,
    effective_roles: ["manager"],
    needs_username: true,
    suggested_username: "quan_ly",
  };

  const result = await continueGoogleLoginAfterAuthentication(
    controller,
    data,
    "manager",
    {
      documentRef: { getElementById: () => null },
      hidePending: () => events.push("pending-hidden"),
      initializeWorkspace: (host, payload, activeRole) => (
        initializeGoogleWorkspaceAfterAuthentication(host, payload, activeRole, {
          installAdmin: async () => events.push("admin-install"),
        })
      ),
    },
  );

  assert.deepEqual(result, { usernameRequired: true });
  assert.deepEqual(events, [
    "pending-hidden",
    ["username-modal", "manager", "quan_ly", true],
  ]);

  await completeUsername();
  assert.deepEqual(events, [
    "pending-hidden",
    ["username-modal", "manager", "quan_ly", true],
    "reload:manager",
  ]);
});


test("in-place Google login keeps the selected role while initializing its admin runtime", async () => {
  const previousDocument = globalThis.document;
  const previousLocalStorage = globalThis.localStorage;
  const previousSessionStorage = globalThis.sessionStorage;
  const events = [];
  const local = memoryStorage();
  const session = memoryStorage();
  globalThis.document = { getElementById: () => null };
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;

  class WorkspaceController {}
  const controller = new WorkspaceController();
  controller._workspaceDeferredUntilReload = false;
  controller.model = {
    STORAGE_KEYS: { ACTIVEUSER: "bf_active_user" },
    state: { activeuser: {} },
    async init() { events.push("model-init"); },
    switchActiveRole(activeRole, name, id) {
      events.push(["active-role", activeRole, name, id]);
      this.state.activeuser = { ...this.state.activeuser, activeRole };
    },
  };
  controller._finishGoogleLogin = async (activeRole) => {
    events.push(`finish:${activeRole}`);
  };
  const data = {
    active_org_id: "org-1",
    avatar: "avatar.png",
    effective_roles: ["manager", "employee"],
    email: "manager@example.test",
    id: "user-1",
    name: "Quan ly",
    organizations: [{
      id: "org-1",
      name: "Workspace",
      role: "manager",
      scope_type: "organization",
      status: "active",
    }],
    package_id: "internal",
    role: "manager",
    username: "manager",
  };

  try {
    const result = await initializeGoogleWorkspaceAfterAuthentication(
      controller,
      data,
      "manager",
      {
        installAdmin: async (TargetClass) => events.push([
          "admin-install",
          TargetClass.name,
        ]),
      },
    );

    assert.deepEqual(result, { deferredUntilReload: false });
    assert.deepEqual(events, [
      ["admin-install", "WorkspaceController"],
      "model-init",
      ["active-role", "manager", "Quan ly", "user-1"],
      "finish:manager",
    ]);
    assert.equal(controller.model.state.activeuser.activeRole, "manager");
    assert.equal(controller.model.state.activeuser.username, "manager");
    assert.equal(controller.model.state.activeuser.activeOrganizationId, "org-1");
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousLocalStorage;
    if (previousSessionStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousSessionStorage;
  }
});
