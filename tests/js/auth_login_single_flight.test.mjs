import assert from "node:assert/strict";
import test from "node:test";

import {
  createSingleFlightSubmitHandler,
  resolvePostLoginActiveRole,
  setLoginSubmitBusy,
  startPostLoginReconciliation,
} from "../../frontend/auth/AuthFlowController.js";

test("login submit admits only one request until the current attempt settles", async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const submit = createSingleFlightSubmitHandler(async () => {
    calls += 1;
    await pending;
  });
  const event = { prevented: 0, preventDefault() { this.prevented += 1; } };

  const first = submit(event);
  const duplicate = submit(event);
  assert.equal(calls, 1);
  assert.equal(event.prevented, 2);

  release();
  await Promise.all([first, duplicate]);
  await submit(event);
  assert.equal(calls, 2);
});

test("login submit reports busy immediately and explains an ignored duplicate", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const events = [];
  const submit = createSingleFlightSubmitHandler(async () => pending, {
    onStart: () => events.push("busy"),
    onDuplicate: () => events.push("duplicate"),
    onSettled: () => events.push("idle"),
  });
  const event = { preventDefault() {} };

  const first = submit(event);
  await submit(event);

  assert.deepEqual(events, ["busy", "duplicate"]);
  release();
  await first;
  assert.deepEqual(events, ["busy", "duplicate", "idle"]);
});

test("login button exposes immediate Vietnamese progress and restores itself", () => {
  const attributes = new Map();
  const form = {
    setAttribute: (name, value) => attributes.set(`form:${name}`, value),
    removeAttribute: (name) => attributes.delete(`form:${name}`),
  };
  const button = {
    disabled: false,
    setAttribute: (name, value) => attributes.set(`button:${name}`, value),
    removeAttribute: (name) => attributes.delete(`button:${name}`),
  };
  const label = { textContent: "Đăng nhập" };

  setLoginSubmitBusy(form, button, label, true);
  assert.equal(button.disabled, true);
  assert.equal(label.textContent, "Đang đăng nhập…");
  assert.equal(attributes.get("form:aria-busy"), "true");
  assert.equal(attributes.get("button:aria-busy"), "true");

  setLoginSubmitBusy(form, button, label, false);
  assert.equal(button.disabled, false);
  assert.equal(label.textContent, "Đăng nhập");
  assert.equal(attributes.size, 0);
});

test("successful login starts authoritative reconciliation without blocking the UI", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const events = [];
  const controller = {
    initializeStartupReconciliation() { events.push("initialized"); },
    reconcileInitialRouteData() {
      events.push("started");
      return pending;
    },
  };

  const result = startPostLoginReconciliation(controller);

  assert.equal(result.started, true);
  assert.deepEqual(events, ["initialized", "started"]);
  release(true);
  assert.equal(await result.promise, true);
});

test("successful login prefers the server-confirmed active persona over role hierarchy", () => {
  assert.equal(resolvePostLoginActiveRole({
    active_role: "manager",
    role: "super_admin",
    effective_roles: ["super_admin", "manager", "employee"],
  }), "manager");
});
