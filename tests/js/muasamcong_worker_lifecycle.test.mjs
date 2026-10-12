import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function workerHarness({ failInitialization = false } = {}) {
  const listeners = new Map();
  const responses = [];
  const runtimes = [];
  class BrowserRuntime {
    constructor() { runtimes.push(this); }
    async initialize(configuration) {
      this.configuration = configuration;
      if (failInitialization) {
        failInitialization = false;
        throw new Error("PROCUREMENT_TIMEOUT");
      }
      this.ready = true;
    }
    async lookup(code, kind) {
      if (!this.ready) throw new Error("PROCUREMENT_BROWSER_FAILED");
      return { code, kind };
    }
    async close() { this.closed = true; }
  }
  const input = { on: (name, callback) => listeners.set(name, callback), close() {} };
  const source = fs.readFileSync(
    new URL("../../backend/integrations/muasamcong_browser/browser_worker.mjs", import.meta.url), "utf8",
  ).replace(/^import[^\r\n]*;\r?$/gm, "");
  vm.runInNewContext(source, {
    readline: { createInterface: () => input },
    chromium: { executablePath: () => "fixture-browser" },
    puppeteer: {},
    BrowserLookupRuntime: BrowserRuntime,
    MscIntegrationRuntime: class {
      initialize() { return { ready: true }; }
      close() {}
    },
    process: { stdin: {}, stdout: { write: (line) => responses.push(JSON.parse(line)) }, exit() {} },
    setImmediate() {},
  });
  let requestNumber = 0;
  return {
    runtimes,
    async send(operation, extra = {}) {
      await listeners.get("line")(JSON.stringify({ requestId: String(++requestNumber), operation, ...extra }));
      return responses.at(-1);
    },
  };
}

test("first fallback lookup initializes lazily without a preceding probe", async () => {
  const worker = workerHarness();
  assert.equal((await worker.send("initialize", { configuration: { targetHost: "muasamcong.mpi.gov.vn" } })).ok, true);
  assert.equal(worker.runtimes.length, 0);
  const first = await worker.send("lookup", { code: "PL2600000001", kind: "PLAN" });
  assert.equal(first.ok, true);
  assert.deepEqual(first.result, { code: "PL2600000001", kind: "PLAN" });
  assert.equal((await worker.send("lookup", { code: "IB2600000002", kind: "PACKAGE" })).ok, true);
  assert.equal(worker.runtimes.length, 1);
  assert.equal(worker.runtimes[0].configuration.targetHost, "muasamcong.mpi.gov.vn");
});

test("fallback lookup requires a live initialized worker and validates before launching", async () => {
  const worker = workerHarness();
  assert.equal((await worker.send("lookup", { code: "PL2600000001", kind: "PLAN" })).error, "PROCUREMENT_BROWSER_FAILED");
  await worker.send("initialize");
  assert.equal((await worker.send("lookup", { code: "https://foreign.test", kind: "PLAN" })).error, "PROCUREMENT_ADAPTER_UNSUPPORTED");
  assert.equal(worker.runtimes.length, 0);
  await worker.send("shutdown");
  assert.equal((await worker.send("lookup", { code: "PL2600000001", kind: "PLAN" })).error, "PROCUREMENT_BROWSER_FAILED");
});

test("failed lazy initialization closes partial runtime and permits a fresh retry", async () => {
  const worker = workerHarness({ failInitialization: true });
  await worker.send("initialize");
  const request = { code: "PL2600000001", kind: "PLAN" };
  assert.equal((await worker.send("lookup", request)).error, "PROCUREMENT_TIMEOUT");
  assert.equal(worker.runtimes[0].closed, true);
  assert.equal((await worker.send("lookup", request)).ok, true);
  assert.equal(worker.runtimes.length, 2);
});
