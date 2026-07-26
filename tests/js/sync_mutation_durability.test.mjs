import assert from "node:assert/strict";
import test from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { autoSync } from "../../frontend/app/BiddingControllerSync.js";


function createWorkspaceStorage(values = new Map()) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    readJson(key, fallback) {
      const value = this.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    },
    writeJson(key, value) {
      this.setItem(key, JSON.stringify(value));
    },
    values,
  };
}


function createModel(storage = createWorkspaceStorage()) {
  const model = new BiddingModel();
  model.workspaceScope = {
    userId: "user-1",
    organizationId: "org-1",
    key: "user-1:org-1",
  };
  model.workspaceStorage = storage;
  model.db = {
    async get() { return null; },
    async set() {},
  };
  model.state.kehoach = [{ id: "plan-1", tenKeHoach: "Bản nháp chưa đồng bộ" }];
  model.markRecordDirty("kehoach", model.state.kehoach[0]);
  return model;
}


function installBrowserFakes(response) {
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      cookie: "csrf_token=test-token",
      getElementById: () => null,
    },
  });
  globalThis.fetch = async () => response;
  return () => {
    globalThis.fetch = originalFetch;
    if (originalDocument === undefined) delete globalThis.document;
    else Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  };
}


function createController(model) {
  let forcedReloads = 0;
  const controller = {
    model,
    view: { showToast() {} },
    updateSyncState() {},
    async forceSyncData() {
      forcedReloads += 1;
    },
    get forcedReloads() {
      return forcedReloads;
    },
  };
  controller.autoSync = () => autoSync.call(controller);
  return controller;
}


for (const scenario of [
  { status: 500, data: { status: "error", message: "server failed" } },
  { status: 409, data: { status: "conflict", currentSyncVersion: 12 } },
]) {
  test(`sync ${scenario.status} keeps the local mutation and visible draft`, async () => {
    const model = createModel();
    const controller = createController(model);
    const restore = installBrowserFakes({
      ok: false,
      status: scenario.status,
      async json() {
        return scenario.data;
      },
    });
    try {
      const result = await autoSync.call(controller);
      assert.equal(result.ok, false);
      assert.notEqual(model.buildMutationSyncPayload(), null);
      assert.equal(model.state.kehoach[0].tenKeHoach, "Bản nháp chưa đồng bộ");
      assert.equal(controller.forcedReloads, 0);
    } finally {
      restore();
    }
  });
}


test("a workspace reload hydrates its pending mutation outbox", async () => {
  const storage = createWorkspaceStorage();
  const firstModel = createModel(storage);
  assert.notEqual(firstModel.buildMutationSyncPayload(), null);
  assert.notEqual(storage.getItem("bf_mutation_queue"), null);

  const reloadedModel = new BiddingModel();
  reloadedModel.workspaceScope = firstModel.workspaceScope;
  reloadedModel.workspaceStorage = storage;
  await reloadedModel.hydrateMutationOutbox();

  const restored = reloadedModel.buildMutationSyncPayload();
  assert.notEqual(restored, null);
  assert.equal(
    restored.payload.kehoach[0].tenKeHoach,
    "Bản nháp chưa đồng bộ",
  );
});


test("IndexedDB restores the outbox when the local-storage mirror is unavailable", async () => {
  const storage = createWorkspaceStorage();
  const indexedValues = new Map();
  const firstModel = createModel(storage);
  firstModel.db = {
    async get(key) { return indexedValues.get(key) || null; },
    async set(key, value) { indexedValues.set(key, structuredClone(value)); },
  };
  firstModel.state.kehoach[0] = {
    id: "plan-1",
    tenKeHoach: "Chỉ còn trong IndexedDB",
  };
  firstModel.markRecordDirty("kehoach", firstModel.state.kehoach[0]);
  await firstModel.flushMutationOutbox();
  storage.removeItem("bf_mutation_queue");

  const reloadedModel = new BiddingModel();
  reloadedModel.workspaceScope = firstModel.workspaceScope;
  reloadedModel.workspaceStorage = storage;
  reloadedModel.db = firstModel.db;
  await reloadedModel.hydrateMutationOutbox();

  assert.equal(
    reloadedModel.buildMutationSyncPayload().payload.kehoach[0].tenKeHoach,
    "Chỉ còn trong IndexedDB",
  );
});


test("an edit created while sync is pending survives acknowledgement of the older snapshot", async () => {
  const model = createModel();
  const controller = createController(model);
  controller._deferPostCommitRender = true;
  let releaseResponse;
  const responseReady = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const restore = installBrowserFakes(awaitableResponse(responseReady));
  try {
    const syncing = autoSync.call(controller);
    await new Promise((resolve) => setTimeout(resolve, 0));

    model.state.kehoach[0] = {
      ...model.state.kehoach[0],
      tenKeHoach: "Chỉnh tiếp trong lúc đang gửi",
    };
    model.markRecordDirty("kehoach", model.state.kehoach[0]);
    releaseResponse({
      ok: true,
      status: 200,
      async json() {
        return { status: "success", syncVersion: 3 };
      },
    });

    const result = await syncing;
    assert.equal(result.ok, true);
    const pending = model.buildMutationSyncPayload();
    assert.notEqual(pending, null);
    assert.equal(
      pending.payload.kehoach[0].tenKeHoach,
      "Chỉnh tiếp trong lúc đang gửi",
    );
  } finally {
    restore();
  }
});


test("a stale validation response cannot discard a corrected record", () => {
  const model = createModel();
  const sent = model.buildMutationSyncPayload();

  model.state.kehoach[0] = {
    ...model.state.kehoach[0],
    tenKeHoach: "Đã sửa sau khi gửi",
  };
  model.markRecordDirty("kehoach", model.state.kehoach[0]);
  const corrected = model.buildMutationSyncPayload();
  const rejected = model.discardRejectedMutations(
    [{ table: "kehoach", id: "plan-1" }],
    sent.snapshot,
  );

  assert.notEqual(
    corrected.payload.clientMutationId,
    sent.payload.clientMutationId,
    "mỗi nội dung payload phải có idempotency key riêng",
  );
  assert.deepEqual(rejected, []);
  assert.equal(
    model.buildMutationSyncPayload().payload.kehoach[0].tenKeHoach,
    "Đã sửa sau khi gửi",
  );
});


function awaitableResponse(responsePromise) {
  return {
    then(resolve, reject) {
      return responsePromise.then(resolve, reject);
    },
  };
}
