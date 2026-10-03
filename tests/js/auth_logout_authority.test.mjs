import assert from "node:assert/strict";
import test from "node:test";

import { setupAuth } from "../../frontend/auth/AuthFlowController.js";
import {
  claimSessionTermination,
  isAuthSessionActive,
  isExplicitLogoutInProgress,
  setAuthSessionActive,
} from "../../frontend/auth/authRuntimeState.js";
import {
  CONFLICT_CENTER_CAPABILITY,
  hasServerCapability,
  PROCUREMENT_IMPORT_CAPABILITY,
  PROCUREMENT_LOOKUP_CAPABILITY,
  resolveServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";

const originalCapabilities = [PROCUREMENT_IMPORT_CAPABILITY, CONFLICT_CENTER_CAPABILITY];

function logoutFixture(t, requestLogout, { pending = false } = {}) {
  const events = [];
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
  const nodes = new Map();
  for (const id of ["auth-overlay", "form-auth-login", "form-auth-register", "form-auth-forgot", "btn-auth-logout"]) {
    nodes.set(id, {
      id, disabled: false, dataset: {}, querySelector: () => null,
      attributes: new Map(),
      setAttribute(name, value) { this.attributes.set(name, value); },
      removeAttribute(name) { this.attributes.delete(name); },
    });
  }
  const saved = new Map();
  const replace = (name, value) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  replace("localStorage", local);
  replace("sessionStorage", session);
  replace("document", {
    cookie: "csrf_token=fixture", getElementById: (id) => nodes.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
  });
  replace("window", { location: { pathname: "/", assign: (path) => events.push(["navigate", path]) } });
  t.mock.method(globalThis, "fetch", async () => requestLogout(events, local));
  t.mock.method(console, "error", () => {});
  let queue = pending ? {
    patches: { goithau: { "package-a": { id: "package-a", name: "entered" } } },
  } : {};
  const model = {
    state: { activeuser: { id: "user-a", name: "User A" }, activerole: "employee" },
    STORAGE_KEYS: { ACTIVEUSER: "bf_active_user", ACTIVEROLE: "bf_active_role" },
    constructor: { resolveAllowedActiveRole: () => "employee", getRoleTitle: () => "Chuyên viên" },
    getMutationQueue: () => queue,
    discardMutationBatch() { events.push(["discard"]); queue = {}; },
    flushMutationOutbox: async () => events.push(["flush"]),
    purgeWorkspaceData: async () => events.push(["purge"]),
    deactivateWorkspace: async () => events.push(["deactivate"]),
    clearSessionData: () => events.push(["clear"]),
  };
  const controller = {
    model, routeMap: {},
    _initialSessionData: {
      valid: true,
      user: { id: "user-a", role: "employee", effective_roles: ["employee"] },
      serverCapabilities: originalCapabilities,
    },
    autoSync: async () => pending ? { ok: false, transport: true } : { ok: true },
    view: {
      customConfirm: async () => true,
      updateActiveUserProfileDisplay() {},
      showToast: (...args) => events.push(["toast", ...args]),
    },
    startBackgroundSessionChecker() {},
    disconnectWebSocket: () => events.push(["disconnect"]),
    usageAnalyticsTracker: { stop: () => events.push(["analytics-stop"]) },
  };
  setAuthSessionActive(true, local);
  setupAuth.call(controller);
  t.after(() => {
    setAuthSessionActive(true, local);
    setAuthSessionActive(false, local);
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  return { events, local, session, model, button: nodes.get("btn-auth-logout") };
}

const response = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});

for (const [name, result] of [
  ["HTTP 503", () => response(503, { success: false, code: "LOGOUT_UNAVAILABLE" })],
  ["network failure", () => { throw new Error("offline"); }],
  ["malformed HTTP 200", () => new Response("broken json", { status: 200 })],
  ["HTTP 200 success=false", () => response(200, { success: false })],
]) {
  test(`real logout handler preserves workspace/session/queue after ${name}`, async (t) => {
    const peer = await import(`../../frontend/auth/authRuntimeState.js?logout-peer=${encodeURIComponent(name)}`);
    const fixture = logoutFixture(t, (_events, local) => {
      assert.equal(isExplicitLogoutInProgress(local), true);
      assert.equal(claimSessionTermination(local), false);
      assert.equal(peer.isExplicitLogoutInProgress(local), true);
      assert.equal(peer.claimSessionTermination(local), false);
      assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), false);
      assert.equal(hasServerCapability(CONFLICT_CENTER_CAPABILITY), false);
      return result();
    }, { pending: true });
    peer.setAuthSessionActive(true, fixture.local);
    await new Promise((resolve) => setImmediate(resolve));
    const queue = structuredClone(fixture.model.getMutationQueue());
    await fixture.button.onclick({ preventDefault() {} });

    assert.deepEqual(fixture.model.getMutationQueue(), queue);
    assert.equal(fixture.events.some(([event]) => ["discard", "purge", "deactivate", "clear", "navigate", "analytics-stop"].includes(event)), false);
    assert.equal(fixture.events.some(([event]) => event === "toast"), true);
    assert.equal(isAuthSessionActive(), true);
    assert.equal(isExplicitLogoutInProgress(fixture.local), false);
    assert.equal(fixture.local.getItem("bf_explicit_logout_at"), null);
    assert.deepEqual(await resolveServerCapabilities(), originalCapabilities);
    assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), true);
    assert.equal(hasServerCapability(CONFLICT_CENTER_CAPABILITY), true);
    assert.equal(hasServerCapability(PROCUREMENT_LOOKUP_CAPABILITY), false);
    assert.equal(claimSessionTermination(fixture.local), true);
    assert.equal(peer.claimSessionTermination(fixture.local), true);
  });
}

test("real logout handler discards and purges only after confirmed server success", async (t) => {
  let beforeCommit;
  const fixture = logoutFixture(t, (events, local) => {
    beforeCommit = {
      marker: isExplicitLogoutInProgress(local),
      disposed: events.some(([event]) => event === "discard" || event === "analytics-stop"),
    };
    events.push(["server-commit"]);
    return response(200, { success: true });
  }, { pending: true });
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.button.onclick({ preventDefault() {} });

  assert.deepEqual(beforeCommit, { marker: true, disposed: false });
  assert.ok(fixture.events.some(([event]) => event === "server-commit"));
  assert.ok(fixture.events.findIndex(([event]) => event === "server-commit") < fixture.events.findIndex(([event]) => event === "discard"));
  assert.equal(fixture.events.filter(([event]) => event === "purge").length, 1);
  assert.equal(fixture.events.filter(([event]) => event === "analytics-stop").length, 1);
  assert.equal(isAuthSessionActive(), false);
  assert.equal(isExplicitLogoutInProgress(fixture.local), true);
  assert.deepEqual(await resolveServerCapabilities(), []);
  assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), false);
  assert.equal(hasServerCapability(CONFLICT_CENTER_CAPABILITY), false);
});

test("failed logout rollback cannot overwrite a newer authoritative capability snapshot", async (t) => {
  const fixture = logoutFixture(t, () => {
    updateServerCapabilitiesFromSession({
      valid: true,
      user: { id: "user-a" },
      serverCapabilities: [CONFLICT_CENTER_CAPABILITY],
    });
    return response(503, { success: false });
  });
  await new Promise((resolve) => setImmediate(resolve));
  await fixture.button.onclick({ preventDefault() {} });

  assert.deepEqual(await resolveServerCapabilities(), [CONFLICT_CENTER_CAPABILITY]);
  assert.equal(hasServerCapability(PROCUREMENT_IMPORT_CAPABILITY), false);
  assert.equal(isAuthSessionActive(), true);
  assert.equal(isExplicitLogoutInProgress(fixture.local), false);
});

test("duplicate logout submits share one attempt and a failed attempt can retry with the original queue", async (t) => {
  let release;
  let requests = 0;
  const firstResponse = new Promise((resolve) => { release = resolve; });
  const fixture = logoutFixture(t, () => {
    requests += 1;
    return requests === 1 ? firstResponse : response(200, { success: true });
  }, { pending: true });
  await new Promise((resolve) => setImmediate(resolve));
  const queue = structuredClone(fixture.model.getMutationQueue());
  const first = fixture.button.onclick({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.button.disabled, true);
  assert.equal(fixture.button.attributes.get("aria-busy"), "true");
  await fixture.button.onclick({ preventDefault() {} });
  assert.equal(requests, 1);
  release(response(503, { success: false }));
  await first;

  assert.deepEqual(fixture.model.getMutationQueue(), queue);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.button.attributes.has("aria-busy"), false);
  assert.equal(isExplicitLogoutInProgress(fixture.local), false);
  await fixture.button.onclick({ preventDefault() {} });
  assert.equal(requests, 2);
  assert.deepEqual(fixture.model.getMutationQueue(), {});
  assert.equal(fixture.events.filter(([event]) => event === "discard").length, 1);
  assert.equal(fixture.events.filter(([event]) => event === "purge").length, 1);
});
