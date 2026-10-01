import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { handlePathRouting } from "../../frontend/app/BiddingControllerUI.js";
import { autoSync } from "../../frontend/app/SyncPushService.js";
import {
  detailRecordExists,
  ensureDetailRecordLoaded,
  fetchRecordByLookup,
  forceSyncData,
} from "../../frontend/app/SyncPullService.js";
import { updateSyncState } from "../../frontend/app/SyncPresenter.js";
import { runManualSyncRetry } from "../../frontend/app/SyncCoordinator.js";
import { CLIENT_TABLE_MAP } from "../../frontend/documents/schemaRuntime.js";
import { cachePaginatedRecords } from "../../frontend/shared/tableDataUtils.js";
import { captureWorkspaceLease } from "../../frontend/app/workspaceLease.js";
import { captureProjectionAuthorizationScope } from "../../frontend/shared/PaginatedProjectionStore.js";
import {
  CONFLICT_CENTER_CAPABILITY,
  invalidateServerCapabilities,
  updateServerCapabilitiesFromSession,
} from "../../frontend/auth/serverCapabilities.js";

const originalGlobals = new Map(["fetch", "document", "window", "history", "requestAnimationFrame", "sessionStorage"]
  .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

afterEach(() => {
  invalidateServerCapabilities();
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function memoryStorage() {
  const values = new Map([["bf_last_sync_version", "17"], ["bf_active_org", "org-a"]]);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    readJson(key, fallback) { return JSON.parse(values.get(key) ?? JSON.stringify(fallback)); },
    writeJson(key, value) { values.set(key, JSON.stringify(value)); },
  };
}

function memoryDatabase() {
  const values = new Map();
  const tables = new Map();
  const table = (key) => {
    if (!tables.has(key)) tables.set(key, new Map());
    return tables.get(key);
  };
  return {
    stores: ["goithau", "nhathau", "hopdong", "assignments"],
    get: async (key) => structuredClone(values.get(key) ?? null),
    set: async (key, value) => { values.set(key, structuredClone(value)); },
    update: async (key, updater) => {
      const next = updater(structuredClone(values.get(key) ?? null));
      values.set(key, structuredClone(next));
      return structuredClone(next);
    },
    getTableData: async (key) => structuredClone([...table(key).values()]),
    putRecord: async (key, row) => { table(key).set(String(row.id), structuredClone(row)); },
    async putRecords(key, rows) { for (const row of rows) await this.putRecord(key, row); },
    putTableData: async (key, rows) => {
      tables.set(key, new Map(rows.map((row) => [String(row.id), structuredClone(row)])));
    },
    deleteRecord: async (key, id) => { table(key).delete(String(id)); },
    async applySyncChanges({ replacements = {}, upserts = {}, deletions = {} }) {
      for (const [key, rows] of Object.entries(replacements)) {
        tables.set(key, new Map(rows.map((row) => [String(row.id), structuredClone(row)])));
      }
      for (const [key, rows] of Object.entries(upserts)) {
        for (const row of rows) await this.putRecord(key, row);
      }
      for (const [key, ids] of Object.entries(deletions)) {
        for (const id of ids) await this.deleteRecord(key, id);
      }
    },
  };
}

function installBrowser(pathname = "/dashboard") {
  globalThis.document = {
    cookie: "csrf_token=test",
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { dataset: {} },
  };
  globalThis.window = { location: { pathname, search: "", hash: "" } };
  globalThis.history = { replaceState() {} };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
}

async function modelFor(storage, db) {
  const model = new BiddingModel();
  model.workspaceScope = { key: "user:org-a", userId: "user", organizationId: "org-a" };
  model.workspaceStorage = storage;
  model.db = db;
  model._workspaceEpoch = 1;
  model.state.activerole = "manager";
  await model.hydrateMutationOutbox();
  return model;
}

function controllerFor(model) {
  const toasts = [];
  return {
    model, autoSync, forceSyncData, fetchRecordByLookup, ensureDetailRecordLoaded,
    handlePathRouting, updateSyncState,
    routeMap: { dashboard: "dashboard", "goithau-detail": "goithau-detail", "nhathau-detail": "nhathau-detail" },
    actionMap: {},
    view: { showToast: (...args) => toasts.push(args) },
    switchTab() {},
    toasts,
  };
}

async function conflictedScenario({ capability = false, type = "goithau", unrelated = false,
  duringPush = null, beforePush = null, requireQuarantine = true, additionalConflict = false,
  captureStatus = 200, fieldsOnly = false } = {}) {
  installBrowser();
  updateServerCapabilitiesFromSession({ valid: true, user: { id: "user" },
    serverCapabilities: capability ? [CONFLICT_CENTER_CAPABILITY] : [] });
  const storage = memoryStorage();
  globalThis.sessionStorage = storage;
  const db = memoryDatabase();
  const model = await modelFor(storage, db);
  const name = { goithau: "tenGoiThau", nhathau: "tenNhaThau", hopdong: "tenHopDong", assignments: "empId" }[type];
  const base = { id: "conflicted", rowVersion: 4, [name]: "Committed base", referenceOnly: false,
    ...(type === "goithau" ? { giaGoiThau: 100, hinhThucLuaChon: "Dau thau rong rai" }
      : type === "hopdong" ? { giaTri: 100, ngayKy: "2026-09-01" }
        : type === "assignments" ? { type: "goithau", targetId: "package-a", organizationId: "org-a" }
          : { diaChi: "Committed address", nguoiDaiDien: "Committed representative" }),
    soTaiKhoan: "authorized-base-account" };
  const entered = { ...base, [name]: "Entered content", soTaiKhoan: "authorized-entered-account" };
  const canonical = { ...base, rowVersion: 5, [name]: "Canonical content", soTaiKhoan: "authorized-canonical-account" };
  const otherBase = { ...base, id: "unrelated", [name]: "Other base" };
  const otherEntered = { ...otherBase, [name]: "Unrelated pending input" };
  const extraBase = { id: "unsupported-conflicted", rowVersion: 4, tenNhaThau: "Unsupported base", referenceOnly: false,
    diaChi: "Original address" };
  const extraEntered = { ...extraBase, tenNhaThau: "Unsupported entered", diaChi: "Entered address" };
  const extraCanonical = { ...extraBase, rowVersion: 5, tenNhaThau: "Unsupported canonical", diaChi: "Canonical address" };
  const posts = [];
  const captures = [];
  let respondPull = () => { throw new Error("Unexpected canonical pull during the rejected save"); };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "/api/sync" && options.method === "POST") {
      posts.push(JSON.parse(options.body));
      if (duringPush) await duringPush({ model, db, entered, base, otherEntered, extraBase, extraEntered });
      const errors = [{
        table: CLIENT_TABLE_MAP[type], id: base.id,
        code: "ROW_VERSION_CONFLICT", expectedVersion: 4, actualVersion: 5,
      }];
      if (additionalConflict) errors.push({ table: CLIENT_TABLE_MAP.nhathau, id: extraBase.id,
        code: "ROW_VERSION_CONFLICT", expectedVersion: 4, actualVersion: 5 });
      return Response.json({ status: "conflict", currentSyncVersion: 18,
        ...(fieldsOnly ? { fields: { errors } } : { errors }) }, { status: 409 });
    }
    if (String(url) === "/api/conflict-drafts" && options.method === "POST") {
      const request = JSON.parse(options.body);
      captures.push(request);
      if (captureStatus !== 200) return Response.json({ error: "Conflict Center capture unavailable" }, { status: captureStatus });
      return Response.json({ id: "server-draft", entityType: type,
        tableName: request.tableName, recordId: base.id, status: "ACTIVE" });
    }
    return respondPull(String(url), options);
  };
  model.state[type] = unrelated ? [entered, otherEntered] : [entered];
  for (const row of model.state[type]) await db.putRecord(type, row);
  model.markRecordDirty(type, model.state[type], { baseRecords: unrelated ? [base, otherBase] : [base] });
  await model.flushMutationOutbox();
  if (additionalConflict) {
    model.state.nhathau = [extraEntered];
    await db.putRecord("nhathau", extraEntered);
    model.markRecordDirty("nhathau", [extraEntered], { baseRecords: [extraBase] });
    await model.flushMutationOutbox();
  }
  const controller = controllerFor(model);
  if (beforePush) beforePush({ model, db, storage });
  const result = await controller.autoSync();
  if (requireQuarantine) {
    assert.equal(result.conflictQuarantined, true, "the actual save must quarantine its rejected receipt");
  }
  if (!duringPush && requireQuarantine) {
    assert.equal(model.state[type][0][name], entered[name]);
    assert.equal(model.state[type][0].soTaiKhoan, entered.soTaiKhoan);
    assert.equal(model.getMutationQueue().upserts?.[type]?.conflicted, undefined);
  }
  assert.equal(controller.toasts.some((toast) => toast[2] === "success"), false);
  assert.equal(captures.length, capability && ["goithau", "kehoach"].includes(type) ? 1 : 0);
  return { model, controller, storage, db, name, base, entered, canonical, otherBase, otherEntered,
    extraBase, extraEntered, extraCanonical, posts, captures, result,
    setPull(handler) { respondPull = handler; } };
}

for (const capability of [false, true]) {
  test(`normal conflict keeps entered authorized fields through a later background pull (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability, unrelated: true });
    scenario.setPull(() => Response.json({ goithau: [scenario.canonical, scenario.otherBase], syncVersion: 18 }));
    const result = await scenario.controller.forceSyncData(true, true);
    assert.equal(result.ok, true);
    assert.equal(scenario.model.state.goithau.find((row) => row.id === "conflicted").tenGoiThau, scenario.entered.tenGoiThau,
      "a background pull before F5 must retain the rejected entered projection while its record remains authorized");
    assert.equal(scenario.model.state.goithau.find((row) => row.id === "conflicted").soTaiKhoan, scenario.entered.soTaiKhoan);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal(scenario.posts.length, 1, "a pull must not replay the rejected mutation");
  });

  test(`conflict retention still honors scope revocation (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability, unrelated: true });
    scenario.storage.setItem("bf_visibility_token", "before-revocation");
    scenario.setPull(() => Response.json({ goithau: [scenario.otherBase], syncVersion: 18,
      visibilityToken: "after-revocation", recordManifest: { goithau: ["unrelated"] } }));
    const result = await scenario.controller.forceSyncData(true, true);
    assert.equal(result.ok, true);
    assert.equal(scenario.model.state.goithau.some((row) => row.id === "conflicted"), false);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal((await scenario.db.getTableData("goithau")).some((row) => row.id === "conflicted"), false);
    assert.equal(scenario.posts.length, 1);
  });
}

test("F5 fresh model replaces rejected contractor cache with canonical detail after paginated full bootstrap", async () => {
  const scenario = await conflictedScenario({ type: "nhathau", unrelated: true });
  const freshModel = await modelFor(scenario.storage, scenario.db);
  await freshModel.loadStorageKeys(["NHATHAU"]);
  assert.equal(freshModel.getMutationQueue().upserts?.nhathau?.conflicted, undefined);
  assert.deepEqual(freshModel.getMutationQueue().upserts.nhathau.unrelated, scenario.otherEntered);
  const freshController = controllerFor(freshModel);
  window.location.pathname = "/nhathau-detail/conflicted";
  let detailGets = 0;
  scenario.setPull((url) => {
    if (url.startsWith("/api/record?")) {
      detailGets += 1;
      return Response.json({ item: scenario.canonical });
    }
    assert.equal(url.startsWith("/api/get-all-data?"), true);
    return Response.json({ nhathau: [], useServerSidePagination: true, paginatedKeys: ["nhathau"],
      referenceData: { nhathau: [{ id: "conflicted", tenNhaThau: "Canonical content", rowVersion: 5 }] },
      recordManifest: { nhathau: ["conflicted", "unrelated"] }, syncVersion: 18 });
  });
  const result = await freshController.forceSyncData(false, true);
  assert.equal(result.ok, true);
  assert.equal(detailGets, 1, "a reference-only bootstrap must confirm canonical detail rather than trust the rejected cache");
  assert.deepEqual(freshModel.state.nhathau.find((row) => row.id === "conflicted"), scenario.canonical);
  assert.equal(detailRecordExists(freshModel, "nhathau", "conflicted"), true);
  assert.deepEqual(freshModel.getMutationQueue().upserts.nhathau.unrelated, scenario.otherEntered);
  assert.equal(scenario.posts.length, 1, "F5 must not replay the conflicted receipt");
});

for (const capability of [false, true]) {
  test(`a newer same-row mutation survives quarantine of the older sent receipt (Conflict Center ${capability})`, async () => {
    let newer;
    const scenario = await conflictedScenario({ capability, unrelated: true,
      duringPush: async ({ model, entered, base, db }) => {
        newer = { ...entered, tenGoiThau: "Newer edit created after send", soTaiKhoan: "newer-account" };
        model.state.goithau[0] = newer;
        model.markRecordDirty("goithau", [newer], { baseRecords: [base] });
        await db.putRecord("goithau", newer);
        await model.flushMutationOutbox();
      },
    });
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.conflicted, newer);
    assert.equal(scenario.model.state.goithau[0].tenGoiThau, newer.tenGoiThau);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    assert.deepEqual(freshModel.getMutationQueue().upserts.goithau.conflicted, newer);
    assert.deepEqual(freshModel.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal(scenario.posts.length, 1);
  });

  test(`direct canonical detail lookup preserves entered projection until F5 (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability });
    scenario.setPull((url) => {
      assert.equal(url.startsWith("/api/record?"), true);
      return Response.json({ item: scenario.canonical });
    });
    await scenario.controller.fetchRecordByLookup("goithau", "conflicted", { requireCanonicalOutcome: true });
    assert.equal(scenario.model.state.goithau[0].tenGoiThau, scenario.entered.tenGoiThau);
    assert.equal(scenario.model.state.goithau[0].soTaiKhoan, scenario.entered.soTaiKhoan);
    assert.equal(scenario.model.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    await freshModel.loadStorageKeys(["GOITHAU"]);
    const cached = freshModel.state.goithau.find((row) => row.id === "conflicted");
    if (detailRecordExists(freshModel, "goithau", "conflicted")) {
      assert.equal(cached.tenGoiThau, scenario.canonical.tenGoiThau);
      assert.equal(cached.soTaiKhoan, scenario.canonical.soTaiKhoan,
        "the persisted entered projection must not become a complete canonical cache after F5");
    }
    await controllerFor(freshModel).fetchRecordByLookup("goithau", "conflicted", { requireCanonicalOutcome: true });
    assert.deepEqual(freshModel.state.goithau[0], scenario.canonical);
    assert.equal(scenario.posts.length, 1);
  });

  test(`paginated canonical cache retains entered projection until F5 without returning rejected query data (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability });
    const canonicalRows = cachePaginatedRecords(scenario.model, "goithau", [scenario.canonical]);
    assert.deepEqual(canonicalRows, [scenario.canonical], "canonical query results must remain canonical");
    assert.equal(scenario.model.state.goithau[0].tenGoiThau, scenario.entered.tenGoiThau);
    assert.equal(scenario.model.state.goithau[0].soTaiKhoan, scenario.entered.soTaiKhoan);
    await new Promise((resolve) => setImmediate(resolve));
    const freshModel = await modelFor(scenario.storage, scenario.db);
    await freshModel.loadStorageKeys(["GOITHAU"]);
    const cached = freshModel.state.goithau.find((row) => row.id === "conflicted");
    if (detailRecordExists(freshModel, "goithau", "conflicted")) {
      assert.equal(cached.tenGoiThau, scenario.canonical.tenGoiThau);
      assert.equal(cached.soTaiKhoan, scenario.canonical.soTaiKhoan);
    }
    assert.equal(freshModel.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    assert.equal(scenario.posts.length, 1);
  });
}

test("saving an unrelated row cannot silently requeue the exact quarantined input retained on screen", async () => {
  const scenario = await conflictedScenario({ unrelated: true });
  scenario.setPull(() => Response.json({ item: scenario.canonical }));
  await scenario.controller.fetchRecordByLookup("goithau", "conflicted", { requireCanonicalOutcome: true });
  const otherChanged = { ...scenario.otherEntered, tenGoiThau: "New unrelated input" };
  scenario.model.state.goithau[1] = otherChanged;
  await scenario.model.persistData("goithau", { throwOnError: true });
  await scenario.model.flushMutationOutbox();
  assert.equal(scenario.model.state.goithau[0].tenGoiThau, scenario.entered.tenGoiThau);
  assert.equal(scenario.model.getMutationQueue().upserts?.goithau?.conflicted, undefined,
    "diffing visible conflict fields against canonical cache must not turn a rejected receipt into a new mutation");
  assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, otherChanged);
  assert.equal(scenario.posts.length, 1);
});

for (const capability of [false, true]) {
  for (const outcome of ["delayed", "failed"]) {
    test(`F5 paginated detail ${outcome} cannot claim canonical completion (Conflict Center ${capability})`, async () => {
      const scenario = await conflictedScenario({ capability, unrelated: true });
      const freshModel = await modelFor(scenario.storage, scenario.db);
      await freshModel.loadStorageKeys(["GOITHAU"]);
      const freshController = controllerFor(freshModel);
      window.location.pathname = "/goithau-detail/conflicted";
      let resolveDetail;
      let detailGets = 0;
      let pullSettled = false;
      const detailResponse = new Promise((resolve) => { resolveDetail = resolve; });
      scenario.setPull((url) => {
        if (url.startsWith("/api/record?")) {
          detailGets += 1;
          return detailResponse;
        }
        assert.equal(url.startsWith("/api/get-all-data?"), true);
        return Response.json({ goithau: [], useServerSidePagination: true, paginatedKeys: ["goithau"],
          referenceData: { goithau: [{ id: "conflicted", tenGoiThau: "Canonical content", rowVersion: 5 }] },
          recordManifest: { goithau: ["conflicted", "unrelated"] }, syncVersion: 18 });
      });
      const pull = freshController.forceSyncData(false, true).then((result) => { pullSettled = true; return result; });
      try {
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(detailGets, 1);
        assert.equal(pullSettled, false, "bootstrap completion must wait for the required canonical detail");
        assert.notEqual(freshController._syncUxState?.phase, "serverSaved");
        resolveDetail(outcome === "delayed" ? Response.json({ item: scenario.canonical })
          : Response.json({ error: "Canonical detail unavailable" }, { status: 500 }));
        const result = await pull;
        if (outcome === "delayed") {
          assert.equal(result.ok, true);
          assert.deepEqual(freshModel.state.goithau.find((row) => row.id === "conflicted"), scenario.canonical);
        } else {
          assert.equal(result.ok, false, "a successful reference bootstrap cannot hide required detail failure");
          assert.notEqual(freshController._syncUxState?.phase, "serverSaved");
        }
        assert.equal(freshModel.getMutationQueue().upserts?.goithau?.conflicted, undefined);
        assert.deepEqual(freshModel.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
        assert.equal(scenario.posts.length, 1);
      } finally {
        resolveDetail(Response.json({ item: scenario.canonical }));
        await pull;
        await Promise.allSettled([...(freshController._pendingDetailRecordLoads?.values() || [])]);
      }
    });
  }
}

test("an old paginated lease cannot retain a conflict projection after active-role or workspace changes", async () => {
  const scenario = await conflictedScenario();
  const lease = { ...captureWorkspaceLease(scenario.model),
    projectionAuthorizationScope: captureProjectionAuthorizationScope(scenario.model) };
  scenario.model.state.activerole = "employee";
  assert.throws(() => cachePaginatedRecords(scenario.model, "goithau", [scenario.canonical], lease),
    (error) => error.code === "PAGINATION_AUTHORIZATION_SCOPE_CHANGED");
  scenario.model.state.activerole = "manager";
  scenario.model.workspaceScope = { key: "user:org-b", userId: "user", organizationId: "org-b" };
  scenario.model._workspaceEpoch += 1;
  scenario.model.state = { goithau: [{ id: "workspace-b", tenGoiThau: "Workspace B" }] };
  assert.throws(() => cachePaginatedRecords(scenario.model, "goithau", [scenario.canonical], lease),
    (error) => error.code === "WORKSPACE_CHANGED");
  assert.deepEqual(scenario.model.state.goithau, [{ id: "workspace-b", tenGoiThau: "Workspace B" }]);
});

for (const capability of [false, true]) {
  test(`retirement flush failure restores the checkpoint but blocks replay and unsafe reload (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability, unrelated: true, requireQuarantine: false,
      beforePush: ({ db, storage }) => {
        db.update = async () => { throw new Error("IndexedDB outbox write failed"); };
        storage.writeJson = () => { throw new Error("localStorage outbox write failed"); };
      },
    });
    assert.equal(scenario.result.ok, false);
    assert.equal(scenario.result.conflictQuarantined, false);
    assert.equal(scenario.result.storageDegraded, true);
    assert.equal(scenario.result.reloadUnsafe, true);
    assert.equal(scenario.controller._syncUxState.phase, "storageError");
    assert.equal(scenario.controller._syncConflict.reloadRequired, true);
    assert.equal(scenario.controller._syncConflict.reloadUnsafe, true);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.conflicted, scenario.entered);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal(scenario.model.state.goithau[0].tenGoiThau, scenario.entered.tenGoiThau);
    assert.equal(scenario.controller.toasts.some((toast) => toast[2] === "success"), false);
    assert.equal(scenario.controller.toasts.some((toast) => /nhấn\s+f5/iu.test(toast.slice(0, 2).join(" "))), false);
    const repeated = await scenario.controller.autoSync();
    assert.equal(repeated.storageDegraded, true);
    assert.equal(repeated.reloadUnsafe, true);
    const manual = await runManualSyncRetry(scenario.controller);
    assert.equal(manual.ok, false);
    assert.equal(manual.storageDegraded, true);
    assert.equal(scenario.controller._syncUxState.phase, "storageError");
    assert.equal(scenario.controller.toasts.some((toast) => /nhấn\s+f5|mở\s+trung tâm xung đột/iu.test(toast.slice(0, 2).join(" "))), false);
    assert.equal(scenario.posts.length, 1, "the restored checkpoint is not authority to replay the rejected input");
  });

  test(`cache cleanup failure after durable retirement never reactivates rejected input (Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability, unrelated: true,
      beforePush: ({ db }) => {
        db.applySyncChanges = async () => { throw new Error("Canonical cache eviction failed"); };
      },
    });
    assert.equal(scenario.result.ok, false);
    assert.equal(scenario.result.conflictQuarantined, true);
    assert.equal(scenario.result.receiptRetired, true);
    assert.equal(scenario.result.storageDegraded, true);
    assert.equal(scenario.result.reloadUnsafe, true);
    assert.equal(scenario.controller._syncUxState.phase, "storageError");
    assert.equal(scenario.controller._syncConflict.reloadRequired, true);
    assert.equal(scenario.controller._syncConflict.reloadUnsafe, true);
    assert.equal(scenario.model.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    assert.equal(freshModel.getMutationQueue().upserts?.goithau?.conflicted, undefined,
      "a separate cache error must not undo acknowledged durable retirement");
    assert.deepEqual(freshModel.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal(scenario.controller.toasts.some((toast) => toast[2] === "success"), false);
    assert.equal(scenario.controller.toasts.some((toast) => /nhấn\s+f5/iu.test(toast.slice(0, 2).join(" "))), false);
    const repeated = await scenario.controller.autoSync();
    assert.equal(repeated.storageDegraded, true);
    assert.equal(repeated.reloadUnsafe, true);
    const manual = await runManualSyncRetry(scenario.controller);
    assert.equal(manual.ok, false);
    assert.equal(manual.storageDegraded, true);
    assert.equal(manual.reloadUnsafe, true);
    assert.equal(scenario.controller._syncUxState.phase, "storageError");
    assert.equal(scenario.controller.toasts.some((toast) => /nhấn\s+f5|mở\s+trung tâm xung đột/iu.test(toast.slice(0, 2).join(" "))), false);
    assert.equal(scenario.posts.length, 1);
  });
}

for (const status of [403, 404, 200]) {
  test(`canonical lookup ${status} with no visible row removes a retained conflict projection`, async () => {
    const scenario = await conflictedScenario({ unrelated: true });
    scenario.setPull(() => Response.json({ item: null }, { status }));
    assert.equal(await scenario.controller.fetchRecordByLookup("goithau", "conflicted", { requireCanonicalOutcome: true }), null);
    assert.equal(scenario.model.state.goithau.some((row) => row.id === "conflicted"), false,
      "retained rejected fields cannot survive an authoritative absence or access denial");
    assert.equal(scenario.model.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal((await scenario.db.getTableData("goithau")).some((row) => row.id === "conflicted"), false);
    assert.equal(scenario.posts.length, 1);
  });
}

for (const type of ["nhathau", "hopdong", "assignments"]) {
  test(`enabled Conflict Center retires an unsupported ${type} conflict session-only and reloads canonical state`, async () => {
    const scenario = await conflictedScenario({ capability: true, type, unrelated: true });
    assert.equal(scenario.result.sessionOnlyConflict, true);
    assert.equal(scenario.captures.length, 0, "unsupported tables must not create a server conflict draft");
    scenario.setPull(() => Response.json({ [type]: [scenario.canonical, scenario.otherBase], syncVersion: 18 }));
    assert.equal((await scenario.controller.forceSyncData(true, true)).ok, true);
    assert.equal(scenario.model.state[type].find((row) => row.id === "conflicted")[scenario.name], scenario.entered[scenario.name]);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    await freshModel.loadStorageKeys([type.toUpperCase()]);
    assert.equal(freshModel.getMutationQueue().upserts?.[type]?.conflicted, undefined);
    const freshController = controllerFor(freshModel);
    assert.equal((await freshController.forceSyncData(false, true)).ok, true);
    assert.deepEqual(freshModel.state[type].find((row) => row.id === "conflicted"), scenario.canonical);
    assert.deepEqual(freshModel.getMutationQueue().upserts[type].unrelated, scenario.otherEntered);
    assert.equal(scenario.posts.length, 1, "unsupported capture capability must not cause rejected replay after F5");
  });
}

for (const newerUnsupported of [false, true]) {
  test(`mixed supported and unsupported conflicts retire only sent generations (newer unsupported ${newerUnsupported})`, async () => {
    let newer;
    const scenario = await conflictedScenario({ capability: true, unrelated: true, additionalConflict: true,
      duringPush: newerUnsupported ? async ({ model, db, extraBase, extraEntered }) => {
        newer = { ...extraEntered, tenNhaThau: "Newer unsupported input" };
        model.state.nhathau[0] = newer;
        model.markRecordDirty("nhathau", [newer], { baseRecords: [extraBase] });
        await db.putRecord("nhathau", newer);
        await model.flushMutationOutbox();
      } : null,
    });
    assert.equal(scenario.captures.length, 1);
    assert.equal(scenario.captures[0].entityType, "goithau");
    assert.equal(scenario.model.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    if (newerUnsupported) assert.deepEqual(scenario.model.getMutationQueue().upserts.nhathau[scenario.extraBase.id], newer);
    else assert.equal(scenario.model.getMutationQueue().upserts?.nhathau?.[scenario.extraBase.id], undefined);
    assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    await freshModel.loadStorageKeys(["GOITHAU", "NHATHAU"]);
    scenario.setPull(() => Response.json({ goithau: [scenario.canonical, scenario.otherBase],
      nhathau: [scenario.extraCanonical], syncVersion: 18 }));
    assert.equal((await controllerFor(freshModel).forceSyncData(false, true)).ok, true);
    assert.deepEqual(freshModel.state.goithau.find((row) => row.id === "conflicted"), scenario.canonical);
    assert.deepEqual(freshModel.state.nhathau.find((row) => row.id === scenario.extraBase.id),
      newerUnsupported ? newer : scenario.extraCanonical);
    assert.equal(freshModel.getMutationQueue().upserts?.goithau?.conflicted, undefined);
    assert.deepEqual(freshModel.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
    assert.equal(scenario.posts.length, 1);
  });
}

test("required supported Conflict Center capture failure preserves the checkpoint and blocks unsafe retry in this tab", async () => {
  const scenario = await conflictedScenario({ capability: true, unrelated: true, captureStatus: 500, requireQuarantine: false });
  assert.equal(scenario.result.ok, false);
  assert.equal(scenario.result.conflictQuarantined, false);
  assert.equal(scenario.result.reloadUnsafe, true);
  assert.equal(scenario.result.storageDegraded, true);
  assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.conflicted, scenario.entered);
  assert.deepEqual(scenario.model.getMutationQueue().upserts.goithau.unrelated, scenario.otherEntered);
  assert.equal(scenario.model.state.goithau[0].tenGoiThau, scenario.entered.tenGoiThau);
  assert.equal(scenario.controller._syncUxState.phase, "storageError");
  assert.equal(scenario.controller.toasts.some((toast) => /nhấn\s+f5|mở\s+trung tâm xung đột/iu.test(toast.slice(0, 2).join(" "))), false);
  const repeated = await scenario.controller.autoSync();
  assert.equal(repeated.reloadUnsafe, true);
  assert.equal(scenario.posts.length, 1);
  assert.equal(scenario.captures.length, 1);
});

for (const { capability, type } of [{ capability: false, type: "goithau" },
  { capability: true, type: "goithau" }, { capability: true, type: "nhathau" }]) {
  test(`fields-only row conflict preserves unrelated receipt rows (${type}, Conflict Center ${capability})`, async () => {
    const scenario = await conflictedScenario({ capability, type, unrelated: true, fieldsOnly: true });
    assert.equal(scenario.model.getMutationQueue().upserts?.[type]?.conflicted, undefined);
    assert.deepEqual(scenario.model.getMutationQueue().upserts[type].unrelated, scenario.otherEntered);
    assert.equal(scenario.model.state[type][0][scenario.name], scenario.entered[scenario.name]);
    const freshModel = await modelFor(scenario.storage, scenario.db);
    await freshModel.loadStorageKeys([type.toUpperCase()]);
    scenario.setPull(() => Response.json({ [type]: [scenario.canonical, scenario.otherBase], syncVersion: 18 }));
    assert.equal((await controllerFor(freshModel).forceSyncData(false, true)).ok, true);
    assert.deepEqual(freshModel.state[type].find((row) => row.id === "conflicted"), scenario.canonical);
    assert.deepEqual(freshModel.getMutationQueue().upserts[type].unrelated, scenario.otherEntered);
    assert.equal(scenario.posts.length, 1);
  });
}
