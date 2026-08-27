import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const serviceWorkerSource = readFileSync("views/service-worker.js", "utf8");


function serviceWorkerHarness({ manifestResponse, addAll } = {}) {
  const listeners = new Map();
  const deleted = [];
  const opened = [];
  const precached = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;
  const cache = {
    addAll: addAll || (async (assets) => { precached.push(...assets); }),
    async match() { return null; },
    async put() {},
  };
  const context = {
    URL,
    Promise,
    Set,
    fetch: async () => manifestResponse || new Response(JSON.stringify({
      "frontend/app/app.js": {
        file: "assets/app-ABCDEFGH.js",
        css: ["assets/app-ABCDEFGH.css"],
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    caches: {
      async open(name) {
        opened.push(name);
        return cache;
      },
      async delete(name) {
        deleted.push(name);
        return true;
      },
      async keys() {
        return ["biddingflow-assets-old-build", "unrelated-cache"];
      },
    },
    self: {
      location: {
        href: "https://example.test/service-worker.js?build=new-build",
        origin: "https://example.test",
      },
      addEventListener(type, callback) { listeners.set(type, callback); },
      async skipWaiting() { skipWaitingCalls += 1; },
      clients: {
        async claim() { claimCalls += 1; },
      },
    },
    Response,
  };
  vm.runInNewContext(serviceWorkerSource, context, {
    filename: "views/service-worker.js",
  });

  const runLifecycle = async (type) => {
    let pending;
    listeners.get(type)({ waitUntil(value) { pending = Promise.resolve(value); } });
    return pending;
  };
  return {
    deleted,
    opened,
    precached,
    runLifecycle,
    get claimCalls() { return claimCalls; },
    get skipWaitingCalls() { return skipWaitingCalls; },
  };
}


test("manifest failure rejects install without activating an empty cache", async () => {
  const harness = serviceWorkerHarness({
    manifestResponse: new Response("unavailable", { status: 503 }),
  });

  await assert.rejects(harness.runLifecycle("install"), /manifest/u);
  assert.deepEqual(harness.opened, []);
  assert.equal(harness.skipWaitingCalls, 0);
});


test("partial precache failure deletes the new cache and rejects install", async () => {
  const harness = serviceWorkerHarness({
    addAll: async () => { throw new Error("precache failed"); },
  });

  await assert.rejects(harness.runLifecycle("install"), /precache failed/u);
  assert.deepEqual(harness.deleted, ["biddingflow-assets-new-build"]);
  assert.equal(harness.skipWaitingCalls, 0);
});


test("successful install waits naturally and activation does not claim old tabs", async () => {
  const harness = serviceWorkerHarness();

  await harness.runLifecycle("install");
  assert.equal(harness.skipWaitingCalls, 0);
  await harness.runLifecycle("activate");
  assert.equal(harness.claimCalls, 0);
  assert.deepEqual(harness.deleted, ["biddingflow-assets-old-build"]);
});


test("install precaches dynamic chunks needed by tabs that survive a deployment", async () => {
  const harness = serviceWorkerHarness({
    manifestResponse: new Response(JSON.stringify({
      "frontend/app/app.js": {
        file: "assets/app-ABCDEFGH.js",
        imports: ["_shared.js"],
        dynamicImports: ["frontend/packages/GoiThauDetail.js"],
      },
      "_shared.js": {
        file: "assets/shared-ABCDEFGH.js",
      },
      "frontend/packages/GoiThauDetail.js": {
        file: "assets/GoiThauDetail-ABCDEFGH.js",
        dynamicImports: ["frontend/documents/ExcelIntegration.js"],
      },
      "frontend/documents/ExcelIntegration.js": {
        file: "assets/ExcelIntegration-ABCDEFGH.js",
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  });

  await harness.runLifecycle("install");

  assert.deepEqual(new Set(harness.precached), new Set([
    "/dist/assets/app-ABCDEFGH.js",
    "/dist/assets/shared-ABCDEFGH.js",
    "/dist/assets/GoiThauDetail-ABCDEFGH.js",
    "/dist/assets/ExcelIntegration-ABCDEFGH.js",
  ]));
});
