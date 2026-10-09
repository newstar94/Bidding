import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BiddingModel } from "../../frontend/app/BiddingModel.js";
import { saveBasicExcelImport } from "../../frontend/documents/excelSaveAdapters.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
let browser;
let server;
let origin;
const catalog = { releaseId: "race-release", releaseChecksum: "race-release", offers: [], creditPacks: [], quotaWarnings: [] };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
before(async () => {
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://127.0.0.1").pathname;
      if (path === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end('<html><head><link data-runtime-styles rel="stylesheet" href="/views/css/runtime-styles.css"></head><body></body></html>');
        return;
      }
      const body = await readFile(join(root, path.slice(1)));
      response.writeHead(200, { "content-type": [".js", ".mjs"].includes(extname(path)) ? "text/javascript" : extname(path) === ".css" ? "text/css" : extname(path) === ".json" ? "application/json" : "application/octet-stream" });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});
async function withPage(run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  try { await page.goto(origin); return await run(page); }
  finally { await page.close(); }
}

test("F04 landing checkout uses raw session organization ownership", async () => withPage(async page => {
  let quote;
  await page.route("**/api/billing/quotes", route => {
    quote = route.request().postDataJSON();
    return route.fulfill({ status: 409, json: { code: "FIXTURE_STOP", error: "Stop before payment" } });
  });
  await page.evaluate(async () => {
    document.cookie = "csrf_token=race-fixture;path=/";
    const { startCommercialCheckoutFromLanding } = await import("/frontend/commercial-policy/CommercialStorefront.js");
    await startCommercialCheckoutFromLanding({
      offer: { code: "organization.yearly", ownerKind: "organization", display: { name: "Organization" }, price: { total: 10 } },
      session: { valid: true, user: { id: "admin-1", platform_role: "super_admin", active_org_id: "organization-A", organizations: [{ id: "organization-A", scope_type: "organization", role: "manager" }] } },
    });
  });
  assert.deepEqual(quote, { ownerKind: "organization", ownerId: "organization-A", operation: "purchase", skuCode: "organization.yearly" });
}));

test("F08 a remount replaces pending storefront requests and excludes the previous workspace response", async () => withPage(async page => {
  const usageStarted = deferred(), usageRelease = deferred();
  const scopes = [];
  await page.route("**/api/public/commercial/offers", route => route.fulfill({ json: catalog }));
  await page.route("**/api/billing/usage", async route => {
    const scope = route.request().headers()["x-active-org"];
    scopes.push(scope);
    if (scope === "organization-A") { usageStarted.resolve(); await usageRelease.promise; }
    await route.fulfill({ json: { available: scope === "organization-A" ? 73 : 12, total: 100, used: 1 } }).catch(() => {});
  });
  await page.route("**/api/billing/orders", route => route.fulfill({ json: { orders: [{ publicId: `ORDER-${route.request().headers()["x-active-org"]}`, checkoutState: "expired", paymentState: "unverified", activationState: "not_ready" }] } }));
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="storefront-offers"></div><div id="storefront-balance"></div><div id="storefront-orders"></div><div id="storefront-status"></div>';
    sessionStorage.setItem("bf_active_org", "organization-A");
    window.storefront = { model: { state: { activeuser: { id: "manager", activeOrganizationId: "organization-A" } } } };
    const m = await import("/frontend/commercial-policy/CommercialStorefront.js");
    window.firstMount = m.mountCommercialStorefront(window.storefront);
  });
  await usageStarted.promise;
  await page.evaluate(async () => {
    sessionStorage.setItem("bf_active_org", "organization-B");
    window.storefront.model.state.activeuser.activeOrganizationId = "organization-B";
    const m = await import("/frontend/commercial-policy/CommercialStorefront.js");
    await m.mountCommercialStorefront(window.storefront);
  });
  usageRelease.resolve();
  await page.evaluate(() => window.firstMount);
  assert.deepEqual(scopes, ["organization-A", "organization-B"]);
  assert.match(await page.locator("#storefront-balance").textContent(), /12 còn lại/u);
  assert.doesNotMatch(await page.locator("#storefront-orders").textContent(), /organization-A/u);
}));

for (const delayedStage of ["quote", "checkout", "checkout-error"]) {
  test(`F08 ${delayedStage} continuation cannot create or display payment in a replacement workspace`, async () => withPage(async page => {
    const started = deferred(), release = deferred();
    const checkoutRequests = [];
    let orderPolls = 0;
    const raceOffer = { code: "organization.yearly", ownerKind: "organization", salesState: "sellable",
      display: { name: "Organization" }, price: { total: 10 } };
    await page.route("**/api/public/commercial/offers", route => route.fulfill({ json: { ...catalog, offers: [raceOffer] } }));
    await page.route("**/api/billing/usage", route => route.fulfill({ json: { available: 10, total: 10, used: 0 } }));
    await page.route("**/api/billing/orders", route => route.fulfill({ json: { orders: [] } }));
    await page.route("**/api/billing/orders/ORDER-A", route => {
      orderPolls++;
      return route.fulfill({ json: { order: { publicId: "ORDER-A", checkoutState: "open", paymentState: "unverified", activationState: "not_ready" } } });
    });
    await page.route("**/api/billing/quotes", async route => {
      if (delayedStage === "quote") { started.resolve(); await release.promise; }
      await route.fulfill({ json: { publicId: "quote-A" } });
    });
    await page.route("**/api/billing/checkouts", async route => {
      checkoutRequests.push({ scope: route.request().headers()["x-active-org"], body: route.request().postDataJSON() });
      if (delayedStage !== "quote") { started.resolve(); await release.promise; }
      if (delayedStage === "checkout-error") {
        await route.fulfill({ status: 409, json: { code: "OLD_WORKSPACE_ERROR", error: "Old workspace failure" } });
      } else {
        await route.fulfill({ json: { order: { publicId: "ORDER-A", checkoutState: "open", paymentState: "unverified",
          activationState: "not_ready", totalAmount: 10, checkoutUrl: "https://pay.payos.vn/fixture" } } });
      }
    });
    await page.evaluate(async () => {
      document.cookie = "csrf_token=race-fixture;path=/";
      document.body.innerHTML = '<div id="storefront-offers"></div><div id="storefront-balance"></div><div id="storefront-orders"></div><div id="storefront-status"></div>';
      sessionStorage.setItem("bf_active_org", "organization-A");
      window.storefront = { model: { state: { activeuser: { id: "manager", activeOrganizationId: "organization-A" } } } };
      const module = await import("/frontend/commercial-policy/CommercialStorefront.js");
      await module.mountCommercialStorefront(window.storefront);
    });
    await page.locator('.storefront-buy[data-operation="purchase"]').click();
    await started.promise;
    await page.evaluate(async () => {
      sessionStorage.setItem("bf_active_org", "organization-B");
      window.storefront.model.state.activeuser.activeOrganizationId = "organization-B";
      const module = await import("/frontend/commercial-policy/CommercialStorefront.js");
      await module.mountCommercialStorefront(window.storefront);
      document.getElementById("storefront-status").textContent = "Current B status";
      document.getElementById("storefront-orders").textContent = "Current B history";
    });
    const lateResponse = page.waitForResponse(delayedStage === "quote" ? "**/api/billing/quotes" : "**/api/billing/checkouts");
    release.resolve();
    await lateResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(checkoutRequests, delayedStage === "quote" ? [] : [{ scope: "organization-A", body: { quotePublicId: "quote-A" } }]);
    assert.equal(orderPolls, 0);
    assert.equal(await page.locator("#storefront-orders").textContent(), "Current B history");
    assert.equal(await page.locator("#storefront-status").textContent(), "Current B status");
    assert.equal(await page.locator("dialog[open]").count(), 0);
  }));
}

for (const action of ["new", "mode", "workspace"]) {
  test(`F09 delayed conversation creation cannot restore a conversation after ${action}`, async () => withPage(async page => {
    const result = await page.evaluate(async action => {
      const { assistantApi } = await import("/frontend/assistant/AssistantApi.js");
      let releaseCreate, notifyStarted;
      const started = new Promise(resolve => { notifyStarted = resolve; });
      const calls = [];
      assistantApi.listConversations = async () => ({ items: [] });
      assistantApi.createConversation = async mode => { calls.push({ create: mode }); notifyStarted(); return new Promise(resolve => { releaseCreate = resolve; }); };
      assistantApi.sendMessage = async (id, content, signal) => {
        calls.push({ send: id, content, aborted: signal.aborted });
        return new Response('data: {"type":"message.completed","messageId":"m1"}\n\n', { headers: { "content-type": "text/event-stream" } });
      };
      sessionStorage.setItem("bf_active_org", "organization-A");
      const { mountAssistant } = await import("/frontend/assistant/AssistantController.js");
      const a = mountAssistant({ model: { state: { activeuser: {} } } }, { enabled: true });
      a.open(); await a.historyReady;
      const send = a.send("Question A"); await started;
      if (action === "new") await a.newConversation();
      if (action === "mode") await a.changeMode("app_help");
      if (action === "workspace") { sessionStorage.setItem("bf_active_org", "organization-B"); a.resetForWorkspace(); await a.historyReady; }
      releaseCreate({ id: "conversation-A", mode: "data" }); await send;
      return { id: a.conversationId, history: a.conversations, calls, messages: a.messages.textContent };
    }, action);
    assert.equal(result.id, "");
    assert.equal(result.history.some(item => item.id === "conversation-A"), false);
    assert.deepEqual(result.calls, [{ create: "data" }]);
    assert.doesNotMatch(result.messages, /Question A/u);
  }));
}

for (const transition of ["package", "reopen"]) {
  test(`F16 inline Excel ignores stale responses after ${transition}`, async () => withPage(async page => {
    const started = deferred(), release = deferred();
    await page.route("**/api/import-excel", async route => { started.resolve(); await release.promise; await route.fulfill({ json: { success: true, rows: [{ _valid: true, maPhanLo: "LOT-A" }] } }); });
    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="modal-goithau" class="modal-overlay active"><input id="form-goithau-id" value="package-A"><button id="btn-import-excel-phanlo"></button><input type="file" id="excel-file-input-phanlo"><table><tbody id="phanlo-tbody"><tr><td>Initial A</td></tr></tbody></table></div>';
      document.cookie = "csrf_token=race-fixture;path=/";
      window.inlineController = { model: { workspaceScope: { key: "organization-A" } }, view: { customAlert: (...args) => window.alerts.push(args) }, addPhanLoRow: row => { document.getElementById("phanlo-tbody").innerHTML += `<tr><td>${row.maPhanLo}</td></tr>`; } };
      window.alerts = [];
      const m = await import("/frontend/app/inlineExcelControls.js"); m.setupInlineExcelControls(window.inlineController);
    });
    await page.locator("#excel-file-input-phanlo").setInputFiles({ name: "A.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("fixture") });
    await started.promise;
    await page.evaluate(async transition => {
      if (transition === "package") document.getElementById("form-goithau-id").value = "package-B";
      else { const modal = document.getElementById("modal-goithau"); modal.classList.remove("active"); await Promise.resolve(); modal.classList.add("active"); }
      if (transition === "package") document.getElementById("phanlo-tbody").innerHTML = "<tr><td>Current content</td></tr>";
      window.expectedInlineContent = document.getElementById("phanlo-tbody").textContent;
    }, transition);
    release.resolve();
    await page.waitForResponse("**/api/import-excel");
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 10)));
    assert.equal(await page.locator("#phanlo-tbody").textContent(), await page.evaluate(() => window.expectedInlineContent));
    assert.deepEqual(await page.evaluate(() => window.alerts), []);
  }));
}

function installWorkspace(model, key, state, db) {
  const values = new Map();
  model.workspaceScope = { key, organizationId: key };
  model.workspaceStorage = { getItem: name => values.get(name) ?? null, readJson: (name, fallback) => values.get(name) ?? fallback, writeJson: (name, value) => values.set(name, structuredClone(value)) };
  model.state = state; model.db = db;
  model._mutationOutbox = null; model._mutationOutboxStoreRef = null; model._mutationOutboxStore = null;
  model._mutationOutboxStoreStorage = null; model._mutationOutboxStoreDatabase = null;
}
for (const fail of [false, true]) {
  test(`F16 multi-table Excel ${fail ? "rollback" : "commit"} stays on its captured workspace and drains before a switch`, async () => {
    const write = deferred();
    const model = new BiddingModel();
    const stateA = { ...model.state, kehoach: [{ id: "plan-A", maKeHoach: "PLAN-A", isLatest: 1 }], goithau: [] };
    const dbA = { stores: ["goithau", "kehoach"], applySyncChanges: () => write.promise, get: async () => null, set: async () => {} };
    installWorkspace(model, "organization-A", stateA, dbA);
    const outboxA = model._getMutationOutbox();
    const saving = saveBasicExcelImport({ model, recalculatePlanTotal() {} }, "goithau", [{ maGoiThau: "NEW-A", keHoachId: "PLAN-A", tenGoiThau: "Import A" }]);
    const outcome = saving.then(value => ({ value }), error => ({ error: error.message }));
    model.beginWorkspaceTransition();
    let drained = false;
    const drain = model.waitForWorkspaceMutations().then(() => { drained = true; });
    await Promise.resolve();
    const wasDrainedEarly = drained;
    const stateB = { ...model.state, kehoach: [{ id: "plan-B" }], goithau: [{ id: "package-B" }] };
    installWorkspace(model, "organization-B", stateB, { stores: [] });
    if (fail) write.reject(new Error("old write failed")); else write.resolve();
    const result = await outcome; await drain;
    assert.equal(wasDrainedEarly, false, "workspace transition must wait for Excel mutation completion");
    assert.deepEqual(stateB.kehoach, [{ id: "plan-B" }]);
    assert.deepEqual(stateB.goithau, [{ id: "package-B" }]);
    assert.equal(model.hasPendingMutationOutboxChanges(), false);
    if (fail) { assert.equal(result.error, "old write failed"); assert.deepEqual(stateA.goithau, []); }
    else { assert.equal(result.value, 1); assert.equal(Object.keys(outboxA.snapshot().upserts.goithau).length, 1); }
    assert.equal(model._workspaceMutations.size, 0);
  });
}

for (const result of [
  { ok: false, status: 409, conflict: true },
  { ok: false, validation: true },
  { ok: false, offline: true },
  { ok: true, skipped: true, localMutationsPending: true },
  { ok: true },
]) {
  test(`F17 Excel completion respects canonical outcome ${JSON.stringify(result)}`, async () => withPage(async page => {
    const outcome = await page.evaluate(async result => {
      document.body.innerHTML = '<div id="modal-excel-preview" class="modal-overlay active"></div>';
      const { saveExcelImport, captureExcelImportContext } = await import("/frontend/documents/ExcelIntegration.js");
      const { closeModal } = await import("/frontend/app/BiddingControllerUI.js");
      const toasts = [];
      const model = { state: { kehoach: [] }, currentPage: {}, parseVND: value => Number(value) || 0, persistChanges: async () => {}, commitLocalMutation() {}, getWorkspaceToken: () => "scope-A", isWorkspaceCurrent: token => token === "scope-A" };
      const c = { model, _excelImportType: "kehoach", _excelImportData: [{ _valid: true, maKeHoach: "PLAN-A", tenKeHoach: "Entered plan" }], autoSync: async () => result,
        view: { ensureViewModules: async () => {}, renderKeHoachTable: async () => {}, showToast: (...args) => toasts.push(args), closeModal: id => document.getElementById(id).classList.remove("active") },
        closeModal };
      c._excelImportContext = captureExcelImportContext(c, "kehoach"); await saveExcelImport.call(c);
      return { open: document.getElementById("modal-excel-preview").classList.contains("active"), data: c._excelImportData, context: c._excelImportContext, toasts };
    }, result);
    const committed = result.ok === true && !result.localMutationsPending;
    assert.equal(outcome.open, !committed);
    assert.equal(outcome.toasts.some(item => item[2] === "success"), committed);
    if (!committed) { assert.equal(outcome.data[0].tenKeHoach, "Entered plan"); assert.ok(outcome.context); }
  }));
}

test("F16 an outbox flush failure rolls back durable Excel tables before releasing the mutation", async () => {
  const model = new BiddingModel();
  const stateA = { ...model.state, kehoach: [{ id: "plan-A", maKeHoach: "PLAN-A", isLatest: 1 }], goithau: [] };
  const rollbackStarted = deferred(), rollbackRelease = deferred();
  const writes = [];
  const dbA = { stores: ["goithau", "kehoach"], get: async () => null, set: async () => {}, applySyncChanges: async changes => {
    writes.push(structuredClone(changes));
    if (changes.replacements) { rollbackStarted.resolve(); await rollbackRelease.promise; }
  } };
  installWorkspace(model, "organization-A", stateA, dbA);
  const outboxA = model._getMutationOutbox();
  const originalFlush = outboxA.flush.bind(outboxA);
  let attempts = 0;
  outboxA.flush = async () => { if (++attempts === 1) throw new Error("outbox storage failed"); return originalFlush(); };
  const saving = saveBasicExcelImport({ model, recalculatePlanTotal() {} }, "goithau", [{ maGoiThau: "NEW-A", keHoachId: "PLAN-A" }]);
  const outcome = saving.catch(error => error.message);
  await rollbackStarted.promise;
  model.beginWorkspaceTransition();
  let drained = false;
  const drain = model.waitForWorkspaceMutations().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  rollbackRelease.resolve();
  assert.equal(await outcome, "outbox storage failed"); await drain;
  assert.deepEqual(writes[1].replacements.goithau, []);
  assert.deepEqual(writes[1].replacements.kehoach, [{ id: "plan-A", maKeHoach: "PLAN-A", isLatest: 1 }]);
  assert.deepEqual(stateA.goithau, []);
  assert.equal(model.hasPendingMutationOutboxChanges(), false);
});

test("F17 retrying pending confirmation does not apply Excel mutations twice", async () => withPage(async page => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="modal-excel-preview" class="modal-overlay active"></div>';
    const { saveExcelImport, captureExcelImportContext } = await import("/frontend/documents/ExcelIntegration.js");
    const { closeModal } = await import("/frontend/app/BiddingControllerUI.js");
    let persists = 0, syncs = 0;
    const toasts = [];
    const model = { state: { kehoach: [] }, currentPage: {}, parseVND: value => Number(value) || 0, persistChanges: async () => { persists += 1; }, commitLocalMutation() {}, getWorkspaceToken: () => "scope-A", isWorkspaceCurrent: token => token === "scope-A" };
    const c = { model, _excelImportType: "kehoach", _excelImportData: [{ _valid: true, maKeHoach: "PLAN-A", tenKeHoach: "Entered plan" }], autoSync: async () => ++syncs === 1 ? { ok: true, localMutationsPending: true } : { ok: true },
      view: { ensureViewModules: async () => {}, renderKeHoachTable: async () => {}, showToast: (...args) => toasts.push(args), closeModal: id => document.getElementById(id).classList.remove("active") }, closeModal };
    c._excelImportContext = captureExcelImportContext(c, "kehoach");
    await saveExcelImport.call(c); await saveExcelImport.call(c);
    return { persists, syncs, toasts, records: model.state.kehoach.length, data: c._excelImportData };
  });
  assert.equal(result.persists, 1); assert.equal(result.syncs, 2); assert.equal(result.records, 1);
  assert.equal(result.toasts.filter(item => item[2] === "success").length, 1); assert.equal(result.data, null);
}));

test("F17 a delayed sync completion cannot clear a newer Excel preview", async () => withPage(async page => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="modal-excel-preview" class="modal-overlay active"></div>';
    const { saveExcelImport, captureExcelImportContext } = await import("/frontend/documents/ExcelIntegration.js");
    let release, notifyStarted;
    const started = new Promise(resolve => { notifyStarted = resolve; });
    const events = [];
    const model = { state: { kehoach: [] }, currentPage: {}, parseVND: value => Number(value) || 0, persistChanges: async () => {}, commitLocalMutation() {}, getWorkspaceToken: () => "scope-A", isWorkspaceCurrent: token => token === "scope-A" };
    const c = { model, _excelImportType: "kehoach", _excelImportData: [{ _valid: true, maKeHoach: "PLAN-A" }], autoSync: async () => { notifyStarted(); return new Promise(resolve => { release = resolve; }); },
      view: { ensureViewModules: async () => {}, renderKeHoachTable: async () => events.push("render"), showToast: (...args) => events.push(args) }, closeModal: async () => events.push("close") };
    c._excelImportContext = captureExcelImportContext(c, "kehoach");
    const saving = saveExcelImport.call(c); await started;
    c._excelImportData = [{ _valid: true, maKeHoach: "PLAN-B" }];
    c._excelImportContext = captureExcelImportContext(c, "kehoach");
    release({ ok: true }); await saving;
    return { data: c._excelImportData, events };
  });
  assert.deepEqual(result, { data: [{ _valid: true, maKeHoach: "PLAN-B" }], events: [] });
}));

test("F18 cancelled workspace navigation preserves the workspace and skips success/refresh", async () => withPage(async page => {
  const result = await page.evaluate(async () => {
    document.body.innerHTML = '<div id="org-switch-section"><div id="org-switch-list"></div></div><div id="workspace-pill-container"></div><div class="modal-overlay active" data-bf-unsaved="true"></div>';
    sessionStorage.setItem("bf_active_org", "organization-A");
    const events = [];
    const host = { model: { workspaceScope: { organizationId: "organization-A" }, state: { activeuser: { id: "u1", organizations: ["A", "B"].map(id => ({ id: `organization-${id}`, name: `Workspace ${id}`, role: "manager", status: "active", scope_type: "organization" })) } } },
      view: { customConfirm: async () => false, showToast: (...args) => events.push(args), customAlert: async () => {} }, reloadEmployeesFromDatabase: () => events.push("refresh") };
    const { WorkspaceLifecycleController } = await import("/frontend/app/WorkspaceLifecycleController.js");
    const lifecycle = new WorkspaceLifecycleController(host); host.switchWorkspaceContext = id => lifecycle.switchWorkspace(id);
    const { renderWorkspaceSwitcher } = await import("/frontend/auth/WorkspaceSwitcherController.js");
    renderWorkspaceSwitcher.call(host); document.querySelector('[data-org="organization-B"]').click();
    await new Promise(resolve => setTimeout(resolve, 10));
    return { scope: sessionStorage.getItem("bf_active_org"), events };
  });
  assert.deepEqual(result, { scope: "organization-A", events: [] });
}));

test("F18 organization creation does not claim a workspace switch when navigation is cancelled", async () => withPage(async page => {
  await page.route("**/api/organizations", route => route.fulfill({ status: 201, json: { organization: { id: "organization-B", name: "Workspace B", role: "manager", status: "active", scope_type: "organization" } } }));
  const result = await page.evaluate(async () => {
    document.cookie = "csrf_token=race-fixture;path=/";
    document.body.innerHTML = '<div id="org-switch-section"><div id="org-switch-list"></div></div><div class="modal-overlay active" data-bf-unsaved="true"></div><form id="form-create-organization"><input id="organization-tax-code" value="fixture-tax"><input id="organization-short-name" value="Fixture"><button type="submit">Create</button></form>';
    sessionStorage.setItem("bf_active_org", "organization-A");
    const events = [];
    const host = { model: { workspaceScope: { organizationId: "organization-A" }, state: { activeuser: { id: "u1", organizations: [{ id: "organization-A", name: "Workspace A", role: "manager", status: "active", scope_type: "organization" }] } } },
      view: { validateForm: () => true, closeModal() {}, customConfirm: async () => false, showToast: (...args) => events.push(args), customAlert: async () => {} } };
    const { WorkspaceLifecycleController } = await import("/frontend/app/WorkspaceLifecycleController.js");
    const lifecycle = new WorkspaceLifecycleController(host); host.switchWorkspaceContext = id => lifecycle.switchWorkspace(id);
    const { renderWorkspaceSwitcher } = await import("/frontend/auth/WorkspaceSwitcherController.js");
    renderWorkspaceSwitcher.call(host); document.getElementById("form-create-organization").requestSubmit();
    while (!events.length) await new Promise(resolve => setTimeout(resolve, 5));
    return { scope: sessionStorage.getItem("bf_active_org"), events, organizations: host.model.state.activeuser.organizations.map(item => item.id) };
  });
  assert.equal(result.scope, "organization-A");
  assert.deepEqual(result.organizations, ["organization-A", "organization-B"]);
  assert.equal(result.events[0][0], "Đã tạo tổ chức");
  assert.doesNotMatch(result.events[0][1], /Đang làm việc tại/u);
}));
