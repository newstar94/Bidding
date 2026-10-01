import assert from "node:assert/strict";
import test from "node:test";

import { startBackgroundSessionChecker } from "../../frontend/auth/AuthSessionController.js";
import { isAuthSessionActive, setAuthSessionActive } from "../../frontend/auth/authRuntimeState.js";
import {
  hasServerCapability,
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function sessionFixture(t) {
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
  };
  const local = storage();
  const session = storage();
  local.setItem("bf_active_org", "org-a");
  session.setItem("bf_active_org", "org-a");
  const savedGlobals = new Map();
  const replaceGlobal = (name, value) => {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  replaceGlobal("localStorage", local);
  replaceGlobal("sessionStorage", session);
  replaceGlobal("window", { addEventListener() {} });
  replaceGlobal("document", { cookie: "csrf_token=test", addEventListener() {}, getElementById: () => null });
  let interval = 0;
  t.mock.method(globalThis, "setInterval", () => ++interval);
  t.mock.method(globalThis, "clearInterval", () => {});
  const requests = [];
  t.mock.method(globalThis, "fetch", async () => {
    const response = deferred();
    requests.push(response);
    return { ok: true, json: () => response.promise };
  });
  let token = "user-a:org-a@1";
  const events = [];
  const model = {
    state: { activeuser: { id: "user-a", name: "User A" }, activerole: "employee" },
    STORAGE_KEYS: { ACTIVEUSER: "bf_active_user", ACTIVEROLE: "bf_active_role" },
    getWorkspaceToken: () => token,
    isWorkspaceCurrent: (candidate) => candidate === token,
    constructor: { resolveAllowedActiveRole: () => "employee", getRoleTitle: () => "Chuyên viên" },
    async flushMutationOutbox() { events.push("flush"); },
    async deactivateWorkspace() { events.push("deactivate"); },
    clearSessionData() { events.push("clear"); },
  };
  const controller = {
    model,
    checkInactivity: () => false,
    view: {
      updateActiveUserProfileDisplay: () => events.push("profile"),
      showToast: () => events.push("toast"),
    },
    switchWorkspaceContext: () => events.push("switch"),
  };
  setAuthSessionActive(true, local);
  t.after(() => {
    setAuthSessionActive(false, local);
    invalidateServerCapabilities();
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return {
    controller, requests, events, local, session,
    switchIdentity(userId = "user-b", organizationId = "org-b") {
      token = `${userId}:${organizationId}@2`;
      model.state = { activeuser: { id: userId, name: "Current User" }, activerole: "employee" };
      local.setItem("bf_active_org", organizationId);
      session.setItem("bf_active_org", organizationId);
    },
  };
}

function validSession(userId, organizationId, capability) {
  return {
    valid: true,
    serverCapabilities: [capability],
    user: {
      id: userId, name: "Old User", active_role: "employee", active_org_id: organizationId,
      organizations: [{ id: organizationId, name: organizationId, role: "employee", status: "active" }],
    },
  };
}

test("late session refresh cannot change the new login profile or capability cache", async (t) => {
  const f = sessionFixture(t);
  startBackgroundSessionChecker.call(f.controller);
  const previousCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  f.switchIdentity();
  startBackgroundSessionChecker.call(f.controller);
  updateServerCapabilitiesFromSession(validSession("user-b", "org-b", "current-capability"));
  f.requests[0].resolve(validSession("user-a", "org-a", "old-capability"));
  await previousCheck;
  assert.equal(f.controller.model.state.activeuser.name, "Current User");
  assert.equal(f.session.getItem("bf_active_org"), "org-b");
  assert.equal(hasServerCapability("current-capability"), true);
  assert.equal(hasServerCapability("old-capability"), false);
  assert.deepEqual(f.events, []);
});

test("late invalid session result cannot terminate a restarted login checker", async (t) => {
  const f = sessionFixture(t);
  startBackgroundSessionChecker.call(f.controller);
  const previousCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  f.switchIdentity();
  startBackgroundSessionChecker.call(f.controller);
  f.requests[0].resolve({ valid: false, reason: "session_revoked" });
  await previousCheck;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(isAuthSessionActive(), true);
  assert.deepEqual(f.events, []);
});

test("late session refresh cannot switch a newly selected workspace back", async (t) => {
  const f = sessionFixture(t);
  startBackgroundSessionChecker.call(f.controller);
  const previousCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  f.switchIdentity("user-a", "org-b");
  f.requests[0].resolve(validSession("user-a", "org-a", "old-capability"));
  await previousCheck;
  assert.equal(f.session.getItem("bf_active_org"), "org-b");
  assert.equal(f.controller.model.state.activeuser.name, "Current User");
  assert.deepEqual(f.events, []);
});

test("current session refresh still applies the authoritative profile and capabilities", async (t) => {
  const f = sessionFixture(t);
  startBackgroundSessionChecker.call(f.controller);
  const pending = f.controller._checkSessionNow();
  assert.equal(f.controller._checkSessionNow(), pending, "same-session polling stays single-flight");
  await new Promise((resolve) => setImmediate(resolve));
  f.requests[0].resolve(validSession("user-a", "org-a", "current-capability"));
  await pending;
  assert.equal(f.controller.model.state.activeuser.name, "Old User");
  assert.equal(hasServerCapability("current-capability"), true);
  assert.deepEqual(f.events, ["profile"]);
});

test("old checker completion cannot clear a new session's pending check", async (t) => {
  const f = sessionFixture(t);
  startBackgroundSessionChecker.call(f.controller);
  const previousCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  f.switchIdentity();
  startBackgroundSessionChecker.call(f.controller);
  const currentCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 2, "a new login must not join an old polling request");
  f.requests[0].resolve({ valid: false });
  await previousCheck;
  assert.equal(f.controller._sessionCheckInFlight, currentCheck);
  assert.equal(f.controller._checkSessionNow(), currentCheck);
  f.requests[1].resolve(validSession("user-b", "org-b", "current-capability"));
  await currentCheck;
  assert.equal(f.controller._sessionCheckInFlight, null);
  assert.equal(hasServerCapability("current-capability"), true);
});

test("late role bootstrap cannot alter a newly logged-in user's active role", async (t) => {
  const f = sessionFixture(t);
  f.controller.model.constructor.resolveAllowedActiveRole = (user, role) => role;
  startBackgroundSessionChecker.call(f.controller);
  const previousCheck = f.controller._checkSessionNow();
  await new Promise((resolve) => setImmediate(resolve));
  const payload = validSession("user-a", "org-a", "old-capability");
  delete payload.user.active_role;
  f.requests[0].resolve(payload);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 2);
  f.switchIdentity();
  startBackgroundSessionChecker.call(f.controller);
  f.controller.model.state.activerole = "manager";
  f.events.length = 0;
  f.requests[1].resolve({ activeRole: "employee" });
  await previousCheck;
  assert.equal(f.controller.model.state.activerole, "manager");
  assert.deepEqual(f.events, []);
});
