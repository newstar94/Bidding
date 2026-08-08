import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const runId = `lp25-${Date.now()}`;
const organizationId = `${runId}-org`;
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const accounts = ["first", "second"].map((key) => ({
  id: `${runId}-${key}-id`,
  username: `${runId}-${key}`,
  email: `${runId}-${key}@example.test`,
  name: `LP-25 ${key}`,
}));
const fixturePayload = { runId, organizationId, password, accounts };

function fixture(action, extra = {}) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/low_price_conflict_fixture.py", action],
    {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify({ ...fixturePayload, ...extra }),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) {
    throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  }
  return JSON.parse(execution.stdout || "{}");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function login(context, account) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
    data: { username: account.username, password, remember: false },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `Login failed for ${account.username}: ${response.status()} ${JSON.stringify(body)}`);
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function csrfHeaders(context) {
  let token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  if (!token) {
    await context.request.post(`${baseURL}/api/auth/check-session`, { data: {} });
    token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  }
  assert(token, "Missing CSRF token");
  return {
    Origin: new URL(baseURL).origin,
    "X-CSRF-Token": token,
    "X-Active-Org": encodeURIComponent(organizationId),
  };
}

async function loadOpening(context, openingId) {
  const response = await context.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `get-all-data failed: ${response.status()} ${JSON.stringify(body)}`);
  const opening = (body.thongtinmothau || []).find((item) => item.id === openingId);
  assert(opening, `Opening ${openingId} was not returned`);
  assert(Number.isInteger(opening.rowVersion), `Opening rowVersion is invalid: ${opening.rowVersion}`);
  return { opening, syncVersion: Number(body.syncVersion || 0) };
}

async function saveDecision(context, staleSnapshot, decision, mutationId) {
  const item = {
    ...staleSnapshot.opening,
    expectedVersion: staleSnapshot.opening.rowVersion,
    chapThuanGiaDeNghiTrungThauDuoi50: decision,
  };
  delete item.rowVersion;
  return context.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(context),
    data: {
      thongtinmothau: [item],
      baseSyncVersion: staleSnapshot.syncVersion,
      clientMutationId: mutationId,
    },
  });
}

async function saveOpeningChanges(context, snapshot, changes, mutationId) {
  const item = {
    ...snapshot.opening,
    ...changes,
    expectedVersion: snapshot.opening.rowVersion,
  };
  delete item.rowVersion;
  return context.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(context),
    data: {
      thongtinmothau: [item],
      baseSyncVersion: snapshot.syncVersion,
      clientMutationId: mutationId,
    },
  });
}

let browser;
let fixtureCreated = false;
try {
  const seeded = fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  await login(firstContext, accounts[0]);
  await login(secondContext, accounts[1]);

  const firstSnapshot = await loadOpening(firstContext, seeded.openingId);
  const secondSnapshot = await loadOpening(secondContext, seeded.openingId);
  assert(
    firstSnapshot.opening.rowVersion === secondSnapshot.opening.rowVersion,
    "The two users did not start from the same row version",
  );

  const firstResponse = await saveDecision(firstContext, firstSnapshot, true, `${runId}-first`);
  const firstBody = await firstResponse.json().catch(() => ({}));
  assert(firstResponse.ok(), `First decision failed: ${firstResponse.status()} ${JSON.stringify(firstBody)}`);

  const secondResponse = await saveDecision(secondContext, secondSnapshot, false, `${runId}-second`);
  const secondBody = await secondResponse.json().catch(() => ({}));
  assert(secondResponse.status() === 409, `Stale decision returned ${secondResponse.status()}: ${JSON.stringify(secondBody)}`);
  const validationErrors = secondBody.validationErrors || secondBody.errors || [];
  assert(
    validationErrors.some((error) => error?.code === "ROW_VERSION_CONFLICT"),
    `Conflict response omitted ROW_VERSION_CONFLICT: ${JSON.stringify(secondBody)}`,
  );

  const refreshed = await loadOpening(secondContext, seeded.openingId);
  assert(
    refreshed.opening.chapThuanGiaDeNghiTrungThauDuoi50 === true,
    `Server decision was overwritten by stale client: ${JSON.stringify(refreshed.opening)}`,
  );
  const database = fixture("verify", { openingId: seeded.openingId });
  assert(database.decision === true, `Database decision is not true: ${JSON.stringify(database)}`);
  assert(database.rowVersion > firstSnapshot.opening.rowVersion, "Database rowVersion did not advance");

  const offlinePage = await secondContext.newPage();
  await offlinePage.goto(`${baseURL}/mothau`, { waitUntil: "domcontentloaded" });
  await waitForApp(offlinePage);
  const sharedSnapshot = await loadOpening(firstContext, seeded.openingId);
  await secondContext.setOffline(true);
  const offlineOutcome = await offlinePage.evaluate(async ({ openingId, mutationId }) => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const { workspaceDataStoreFor } = await import("/frontend/app/WorkspaceDataStore.js");
    const controller = getAppController();
    const opening = controller.model.state.thongtinmothau.find((item) => item.id === openingId);
    if (!opening) throw new Error("Offline browser did not hydrate the shared opening");
    return workspaceDataStoreFor(controller).patch({
      mutationId,
      upserts: {
        thongtinmothau: [{ ...opening, hieuLucHsdt: 321 }],
      },
    });
  }, { openingId: seeded.openingId, mutationId: `${runId}-offline-field` });
  assert(
    offlineOutcome.status === "offlineQueued",
    `Offline browser did not queue its field update: ${JSON.stringify(offlineOutcome)}`,
  );

  const onlineResponse = await saveOpeningChanges(
    firstContext,
    sharedSnapshot,
    { thoiGianThucHien: "45 ngày" },
    `${runId}-online-field`,
  );
  const onlineBody = await onlineResponse.json().catch(() => ({}));
  assert(onlineResponse.ok(), `Online field update failed: ${onlineResponse.status()} ${JSON.stringify(onlineBody)}`);

  const reconnectConflict = offlinePage.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.status() === 409
  ), { timeout: 20_000 });
  await secondContext.setOffline(false);
  await reconnectConflict;
  await offlinePage.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    return !controller?._autoSyncPromise
      && !controller?.model?.buildMutationSyncPayload?.();
  }, null, { timeout: 15_000 });
  const afterOfflineConflict = await loadOpening(secondContext, seeded.openingId);
  assert(
    afterOfflineConflict.opening.thoiGianThucHien === "45 ngày",
    `Offline conflict overwrote the online field: ${JSON.stringify(afterOfflineConflict.opening)}`,
  );
  assert(
    afterOfflineConflict.opening.hieuLucHsdt !== 321,
    `Stale offline field was committed despite row conflict: ${JSON.stringify(afterOfflineConflict.opening)}`,
  );

  await secondContext.setOffline(true);
  const invalidOfflineOutcome = await offlinePage.evaluate(async ({ openingId, mutationId }) => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const { workspaceDataStoreFor } = await import("/frontend/app/WorkspaceDataStore.js");
    const controller = getAppController();
    const opening = controller.model.state.thongtinmothau.find((item) => item.id === openingId);
    if (!opening) throw new Error("Conflict recovery did not restore the shared opening");
    return workspaceDataStoreFor(controller).patch({
      mutationId,
      upserts: {
        thongtinmothau: [{ ...opening, giaDuThau: -1 }],
      },
    });
  }, { openingId: seeded.openingId, mutationId: `${runId}-offline-invalid` });
  assert(
    invalidOfflineOutcome.status === "offlineQueued",
    `Invalid offline update was not retained for server validation: ${JSON.stringify(invalidOfflineOutcome)}`,
  );
  const reconnectValidation = offlinePage.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
  ), { timeout: 20_000 });
  await secondContext.setOffline(false);
  const validationResponse = await reconnectValidation;
  const validationBody = await validationResponse.json().catch(() => ({}));
  assert(
    validationResponse.status() === 400,
    `Offline validation reconnect returned ${validationResponse.status()}: ${JSON.stringify(validationBody)}`,
  );
  await offlinePage.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    return !controller?._autoSyncPromise
      && !controller?.model?.buildMutationSyncPayload?.();
  }, null, { timeout: 15_000 });
  const afterOfflineValidation = await loadOpening(secondContext, seeded.openingId);
  assert(
    afterOfflineValidation.opening.giaDuThau === afterOfflineConflict.opening.giaDuThau,
    `Rejected offline mutation changed the server bid price: ${JSON.stringify(afterOfflineValidation.opening)}`,
  );
  await offlinePage.close();

  process.stdout.write(`${JSON.stringify({
    runId,
    staleStatus: secondResponse.status(),
    conflictCode: "ROW_VERSION_CONFLICT",
    initialRowVersion: firstSnapshot.opening.rowVersion,
    finalRowVersion: database.rowVersion,
    finalDecision: database.decision,
    offlineOnlineConflict: {
      onlineField: afterOfflineConflict.opening.thoiGianThucHien,
      staleOfflineFieldCommitted: afterOfflineConflict.opening.hieuLucHsdt === 321,
    },
    offlineValidationRejected: afterOfflineValidation.opening.giaDuThau
      === afterOfflineConflict.opening.giaDuThau,
  }, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) {
    const cleanup = fixture("cleanup");
    process.stdout.write(`[LP-25] fixture-removed ${JSON.stringify(cleanup)}\n`);
  }
}
