import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = readFileSync("views/service-worker.js", "utf8");


function serviceWorkerHarness() {
  const listeners = new Map();
  const deleted = [];
  const opened = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  let unregisterCalls = 0;
  const waitUntilCalls = new Map();
  const cache = {
    async addAll() {},
    async match() { return null; },
    async put() {},
  };
  const context = {
    Promise,
    Response,
    Set,
    URL,
    fetch: async () => new Response(JSON.stringify({
      "frontend/app/app.js": { file: "assets/app-ABCDEFGH.js" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    caches: {
      async delete(name) {
        deleted.push(name);
        return true;
      },
      async keys() {
        return [
          "biddingflow-assets-old-build",
          "biddingflow-assets-current-build",
          "unrelated-cache",
        ];
      },
      async open(name) {
        opened.push(name);
        return cache;
      },
    },
    self: {
      location: {
        href: "https://example.test/service-worker.js?build=current-build",
        origin: "https://example.test",
      },
      addEventListener(type, callback) { listeners.set(type, callback); },
      async skipWaiting() { skipWaitingCalls += 1; },
      clients: {
        async claim() { claimCalls += 1; },
      },
      registration: {
        async unregister() { unregisterCalls += 1; return true; },
      },
    },
  };
  vm.runInNewContext(serviceWorkerSource, context, {
    filename: "views/service-worker.js",
  });

  const runLifecycle = async (type) => {
    const listener = listeners.get(type);
    assert.equal(typeof listener, "function", `missing ${type} listener`);
    let pending;
    listener({ waitUntil(value) {
      waitUntilCalls.set(type, (waitUntilCalls.get(type) || 0) + 1);
      pending = Promise.resolve(value);
    } });
    await pending;
  };
  return {
    deleted,
    listeners,
    opened,
    runLifecycle,
    get claimCalls() { return claimCalls; },
    get skipWaitingCalls() { return skipWaitingCalls; },
    get unregisterCalls() { return unregisterCalls; },
    waitUntilCalls,
  };
}


test("install activates the retirement worker immediately", async () => {
  const harness = serviceWorkerHarness();

  await harness.runLifecycle("install");

  assert.equal(harness.skipWaitingCalls, 1);
  assert.equal(harness.waitUntilCalls.get("install"), 1);
});


test("activation removes every old asset cache and unregisters the worker", async () => {
  const harness = serviceWorkerHarness();

  await harness.runLifecycle("activate");

  assert.deepEqual(harness.deleted, [
    "biddingflow-assets-old-build",
    "biddingflow-assets-current-build",
  ]);
  assert.equal(harness.unregisterCalls, 1);
  assert.equal(harness.claimCalls, 1);
  assert.equal(harness.waitUntilCalls.get("activate"), 1);
});


test("retirement worker never intercepts or caches application assets", () => {
  const harness = serviceWorkerHarness();

  assert.equal(harness.listeners.has("fetch"), false);
  assert.doesNotMatch(serviceWorkerSource, /respondWith\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /manifest\.json/u);
  assert.doesNotMatch(serviceWorkerSource, /caches\.open\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /cache\.(?:match|put)\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /addAll\s*\(/u);
  assert.doesNotMatch(serviceWorkerSource, /\bfetch\s*\(/u);
});
