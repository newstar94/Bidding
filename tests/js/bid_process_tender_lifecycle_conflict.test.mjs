import assert from "node:assert/strict";
import test from "node:test";

import { moThauGoiThau } from "../../frontend/packages/bidProcessTenderLifecycle.js";
import {
  invalidateServerCapabilities,
  PROCUREMENT_IMPORT_CAPABILITY,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";


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


test("opening from Mua Sắm Công fills the time then applies bidders to the opening draft", async () => {
  updateServerCapabilitiesFromSession({
    valid: true,
    user: { id: "user-1" },
    serverCapabilities: [PROCUREMENT_IMPORT_CAPABILITY],
  });
  const calls = [];
  const localPackage = {
    id: "package-1",
    rootId: "package-1",
    rowVersion: 4,
    maGoiThau: "IB2600000002",
    tenGoiThau: "Gói thầu kiểm thử",
    trangThai: "Đang mời thầu",
    thoiGianDongThau: "2026-08-07T08:00:00",
    phuongThucLuaChon: "Một giai đoạn một túi hồ sơ",
  };
  const prepared = {
    preview: {
      previewId: "opening-preview",
      package: { id: "package-1", rowVersion: 4 },
    },
    applied: {
      package: { id: "package-1", rowVersion: 4 },
      opening: {
        openingAt: "2026-08-07T09:00:00",
        bidders: [{ contractorCode: "0100000001", contractorName: "Nhà thầu 01" }],
      },
    },
  };
  const model = {
    state: { goithau: [localPackage], kehoach: [] },
    formatForDatetimeLocal: () => "07/08/2026 09:00",
    formatDateWithTime: (value) => value,
    commitLocalMutation(table, { records }) {
      calls.push(["stage", table, records[0].thoiGianMoThau]);
    },
    async persistData(table) { calls.push(["persist", table]); },
    async flushMutationOutbox() {},
  };
  const controller = {
    model,
    view: {
      async customPrompt(...args) {
        const action = args[7]?.secondaryAction;
        assert.equal(action?.label, "Lấy dữ liệu mở thầu từ Mua sắm công");
        const result = await action.run();
        calls.push(["prompt-import-status", result.status]);
        return result.value;
      },
      async customAlert() {},
      renderGoiThauTable() {},
    },
    async prepareOpeningForLifecycle(pkg) {
      calls.push(["prepare-opening", pkg.id]);
      return prepared;
    },
    applyOpeningImportToDraft(payload) {
      calls.push(["apply-opening-draft", payload.applied.opening.bidders.length]);
      return { added: 1 };
    },
    async fetchRecordByLookup() { return localPackage; },
    async autoSync() { calls.push(["sync"]); return { ok: true }; },
    async switchTab(tab, packageId) { calls.push(["switch-tab", tab, packageId]); },
  };

  try {
    await moThauGoiThau.call(controller, "package-1");
  } finally {
    invalidateServerCapabilities();
  }

  assert.deepEqual(calls, [
    ["prepare-opening", "package-1"],
    ["prompt-import-status", "Đã lấy 1 nhà thầu từ Mua sắm công."],
    ["stage", "goithau", "2026-08-07T09:00:00"],
    ["persist", "goithau"],
    ["sync"],
    ["switch-tab", "goithau-detail", "package-1"],
    ["apply-opening-draft", 1],
  ]);
});
