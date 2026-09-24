import assert from "node:assert/strict";
import test from "node:test";
import { checkInactivity, setupActivityTracker } from "../../frontend/auth/AuthSessionController.js";
import { setAuthSessionActive } from "../../frontend/auth/authRuntimeState.js";

test("activity events respect throttle, inactive sessions and one-time binding", (t) => {
  const handlers = new Map();
  const writes = [];
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = { getItem: () => null, removeItem() {}, setItem: (...args) => writes.push(args) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    addEventListener(type, callback, options) {
      assert.equal(options.passive, true);
      assert.equal(handlers.has(type), false);
      handlers.set(type, callback);
    },
  } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    setAuthSessionActive(false, storage);
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  setAuthSessionActive(true, storage);
  const controller = {};
  setupActivityTracker.call(controller);
  setupActivityTracker.call(controller);
  assert.equal(handlers.size, 5);
  assert.equal(writes.length, 1);
  for (let index = 0; index < 100; index += 1) {
    for (const [type, callback] of handlers) callback({ type });
  }
  assert.equal(writes.length, 1);
  now += 14_999;
  handlers.get("scroll")({ type: "scroll" });
  assert.equal(writes.length, 1);
  now += 1;
  handlers.get("touchstart")({ type: "touchstart" });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1], ["bf_last_activity", String(now)]);
  setAuthSessionActive(false, storage);
  now += 30_000;
  for (const callback of handlers.values()) callback({});
  assert.equal(writes.length, 2);
});

test("forced inactivity caller flushes before clearing session state", async (t) => {
  let release;
  const flush = new Promise((resolve) => { release = resolve; });
  const events = [];
  let now = 100_000;
  t.mock.method(Date, "now", () => now);
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map([["bf_last_activity", "0"], ["bf_inactivity_timeout", "0"]]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    getElementById: () => null,
    querySelector: () => null,
  } });
  t.after(() => {
    setAuthSessionActive(false, storage);
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
  });
  setAuthSessionActive(true, storage);
  const controller = {
    model: {
      state: { activeuser: { name: "User" } },
      flushMutationOutbox: () => flush,
      deactivateWorkspace: async () => events.push("deactivate"),
      clearSessionData: () => events.push("clear"),
    },
    disconnectWebSocket: () => events.push("socket"),
    usageAnalyticsTracker: { stop: () => events.push("analytics") },
  };
  assert.equal(checkInactivity.call(controller), true);
  assert.deepEqual(events, ["analytics", "socket"]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["analytics", "socket", "deactivate", "clear"]);
});
