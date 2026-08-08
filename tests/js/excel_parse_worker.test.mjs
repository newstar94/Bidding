import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { ExcelParseWorkerClient } from "../../frontend/documents/ExcelParseWorkerClient.js";


class FakeWorker {
  constructor() {
    this.terminated = false;
    this.messages = [];
  }
  postMessage(message, transfer) {
    this.messages.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
}


test("excel parser worker transfers buffers and cancels stale jobs", async () => {
  const workers = [];
  const client = new ExcelParseWorkerClient({
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  const firstBuffer = new ArrayBuffer(8);
  const first = client.parse(firstBuffer, "rows");
  assert.equal(workers[0].messages[0].transfer[0], firstBuffer);

  const second = client.parse(new ArrayBuffer(16), "sheets");
  assert.equal(workers[0].terminated, true);
  await assert.rejects(first, (error) => error.code === "STALE_EXCEL_PARSE");

  workers[1].onmessage({ data: { ok: true, result: [{ name: "Sheet1", rows: [] }] } });
  assert.deepEqual(await second, [{ name: "Sheet1", rows: [] }]);
  assert.equal(workers[1].terminated, true);
});

test("default Excel worker factory uses the same-origin approved script path", async () => {
  const OriginalWorker = globalThis.Worker;
  let worker;
  globalThis.Worker = class extends FakeWorker {
    constructor(url) {
      super();
      this.url = url;
      worker = this;
    }
  };
  try {
    const client = new ExcelParseWorkerClient();
    const result = client.parse(new ArrayBuffer(8), "rows");
    assert.equal(String(worker.url), "/frontend/documents/excelParseWorker.js");
    worker.onmessage({ data: { ok: true, result: [] } });
    assert.deepEqual(await result, []);
  } finally {
    if (OriginalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = OriginalWorker;
  }
});

test("production build must emit the Excel worker instead of a CSP-blocked data URL", () => {
  const source = readFileSync("frontend/documents/ExcelParseWorkerClient.js", "utf8");
  assert.match(source, /excelParseWorker\.js\?no-inline/);
});

test("Excel worker signs its vendored importScripts URL under Trusted Types", () => {
  const source = readFileSync("frontend/documents/excelParseWorker.js", "utf8");
  let policyName = "";
  let importedValue = null;
  const self = {
    trustedTypes: {
      createPolicy(name, rules) {
        policyName = name;
        return {
          createScriptURL(value) {
            return { trustedScriptURL: rules.createScriptURL(value) };
          },
        };
      },
    },
  };
  vm.runInNewContext(source, {
    self,
    importScripts(value) { importedValue = value; },
  });

  assert.equal(policyName, "biddingflow-html");
  assert.deepEqual(importedValue, {
    trustedScriptURL: "/vendor/xlsx/xlsx.full.min.js?v=0.20.3",
  });
});
