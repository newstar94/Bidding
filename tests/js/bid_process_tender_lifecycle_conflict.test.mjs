import assert from "node:assert/strict";
import test from "node:test";

import { moThauGoiThau } from "../../frontend/packages/bidProcessTenderLifecycle.js";


function createController({ prompt, serverStatus = "Đang mời thầu" }) {
  const calls = [];
  const localPackage = {
    id: "package-1",
    rootId: "package-1",
    rowVersion: 3,
    tenGoiThau: "Gói thầu kiểm thử",
    trangThai: "Đang mời thầu",
    thoiGianDongThau: "2026-08-07T08:00:00",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  const serverPackage = {
    ...localPackage,
    rowVersion: 4,
    trangThai: serverStatus,
  };
  const model = {
    state: { goithau: [localPackage] },
    commitLocalMutation(table, { records }) {
      const record = Array.isArray(records) ? records[0] : records;
      calls.push(["stage", table, record.rowVersion, record.thoiGianMoThau]);
    },
    async persistData(table) {
      calls.push(["persist", table]);
    },
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    view: {
      customPrompt: prompt,
      async customAlert() {},
      renderGoiThauTable() {},
    },
    async fetchRecordByLookup(table, id) {
      calls.push(["fetch", table, id]);
      model.state.goithau[0] = serverPackage;
      return serverPackage;
    },
    async autoSync() {
      calls.push(["sync"]);
      return { ok: false, conflict: true, status: 409 };
    },
  };
  return { controller, calls };
}


test("opening a package refreshes its row version immediately before staging", async () => {
  const { controller, calls } = createController({
    prompt: async () => "09:00 ngày 07/08/2026",
  });

  await moThauGoiThau.call(controller, "package-1");

  assert.deepEqual(calls, [
    ["fetch", "goithau", "package-1"],
    ["stage", "goithau", 4, "2026-08-07T09:00:00"],
    ["persist", "goithau"],
    ["sync"],
  ]);
});


test("an already-opened server package is treated as an idempotent success", async () => {
  const { controller, calls } = createController({
    prompt: async () => "09:00 ngày 07/08/2026",
    serverStatus: "Đã mở thầu",
  });

  const result = await moThauGoiThau.call(controller, "package-1");

  assert.deepEqual(result, { ok: true, skipped: true });
  assert.deepEqual(calls, [["fetch", "goithau", "package-1"]]);
});


test("opening the same package concurrently runs only one workflow", async () => {
  let releasePrompt;
  let promptCount = 0;
  const promptResult = new Promise((resolve) => {
    releasePrompt = resolve;
  });
  const { controller, calls } = createController({
    prompt: async () => {
      promptCount += 1;
      return promptResult;
    },
  });

  const first = moThauGoiThau.call(controller, "package-1");
  const second = moThauGoiThau.call(controller, "package-1");
  await Promise.resolve();

  assert.equal(promptCount, 1);
  releasePrompt("09:00 ngày 07/08/2026");
  await Promise.all([first, second]);

  assert.equal(calls.filter(([kind]) => kind === "sync").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "stage").length, 1);
});
