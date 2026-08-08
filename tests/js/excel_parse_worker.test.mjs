import assert from "node:assert/strict";
import test from "node:test";

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
