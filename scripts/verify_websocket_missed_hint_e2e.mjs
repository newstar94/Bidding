import process from "node:process";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";


const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const runId = String(Date.now());
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const organizationId = `ws-miss-e2e-${runId}-org`;
const otherOrganizationId = `ws-miss-e2e-${runId}-other-org`;
const suspendedOrganizationId = `ws-miss-e2e-${runId}-suspended-org`;
const registeredUsername = `wsmiss${runId.slice(-10)}`;
const account = (key, membership) => ({
  id: `ws-miss-e2e-${runId}-${key}-id`,
  username: `ws-miss-e2e-${runId}-${key}`,
  email: `ws-miss-e2e-${runId}-${key}@example.test`,
  verified: true,
  platformRole: "user",
  membership,
});
const accounts = {
  manager: account("manager", { role: "manager", organizationId }),
  employee: account("employee", { role: "employee", organizationId }),
};
const fixturePayload = {
  runId,
  password,
  organizationId,
  otherOrganizationId,
  suspendedOrganizationId,
  registeredUsername,
  accounts,
};


function assert(condition, message) {
  if (!condition) throw new Error(message);
}


function fixture(action) {
  const execution = spawnSync(
    process.env.PYTHON || "python",
    ["scripts/auth_roles_e2e_fixture.py", action],
    {
      cwd: process.cwd(),
      env: process.env,
      input: JSON.stringify(fixturePayload),
      encoding: "utf8",
      windowsHide: true,
    },
  );
  if (execution.status !== 0) {
    throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  }
  return JSON.parse(execution.stdout || "{}");
}


async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}


async function apiLogin(context, user) {
  const response = await context.request.post(`${baseURL}/api/auth/login`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
    data: { username: user.username, password, remember: false },
  });
  const body = await response.json().catch(() => ({}));
  assert(response.ok(), `Login failed: ${response.status()} ${JSON.stringify(body)}`);
}


async function csrfHeaders(context) {
  let token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  if (!token) {
    await context.request.post(`${baseURL}/api/auth/check-session`, { data: {} });
    token = (await context.cookies(baseURL)).find((cookie) => cookie.name === "csrf_token")?.value;
  }
  assert(token, "Server did not issue a CSRF token");
  return {
    Origin: new URL(baseURL).origin,
    "X-Active-Org": encodeURIComponent(organizationId),
    "X-CSRF-Token": token,
  };
}


let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });

  const employeeContext = await browser.newContext({ locale: "vi-VN" });
  let droppedHints = 0;
  await employeeContext.routeWebSocket("**/ws/sync", (pageSocket) => {
    const serverSocket = pageSocket.connectToServer();
    pageSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => {
      let payload = null;
      try {
        payload = JSON.parse(String(message));
      } catch {
        // Non-JSON frames remain transport data and are forwarded unchanged.
      }
      if (payload?.event === "db_changed") {
        droppedHints += 1;
        return;
      }
      pageSocket.send(message);
    });
  });
  await apiLogin(employeeContext, accounts.employee);
  const employeePage = await employeeContext.newPage();
  const syncResponses = [];
  let mutationStartedAt = 0;
  employeePage.on("response", async (response) => {
    const url = new URL(response.url());
    if (!["/api/get-all-data", "/api/sync/delta", "/api/paginate"].includes(url.pathname)) return;
    syncResponses.push({
      path: `${url.pathname}${url.search}`,
      status: response.status(),
      elapsedSinceMutation: mutationStartedAt ? Date.now() - mutationStartedAt : null,
      body: await response.json().catch(() => null),
    });
  });
  await employeePage.goto(`${baseURL}/chuyen-gia`, { waitUntil: "domcontentloaded" });
  await waitForApp(employeePage);
  await employeePage.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    return !controller?._backgroundSyncRunning && !controller?._backgroundSyncTimer;
  }, null, { timeout: 30_000 });
  let initialPull = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    initialPull = await employeePage.evaluate(async () => {
      const { getAppController } = await import("/frontend/app/controllerRef.js");
      return getAppController()?.forceSyncData?.(true, true);
    });
    if (initialPull?.ok === true) break;
    await employeePage.waitForFunction(async () => {
      const { getAppController } = await import("/frontend/app/controllerRef.js");
      const controller = getAppController();
      return !controller?._backgroundSyncRunning && !controller?._backgroundSyncTimer;
    }, null, { timeout: 30_000 });
  }
  assert(initialPull?.ok === true, `Initial authoritative pull failed: ${JSON.stringify(initialPull)}`);
  await employeePage.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const { currentWorkspaceStorage } = await import("/frontend/app/SyncWorkspaceContext.js");
    const controller = getAppController();
    return controller?._wsReady === true
      && Boolean(controller?._wsPollingTimer)
      && !controller?._backgroundSyncRunning
      && !controller?._backgroundSyncTimer;
  }, null, { timeout: 30_000 });

  const before = await employeePage.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const { currentWorkspaceStorage } = await import("/frontend/app/SyncWorkspaceContext.js");
    const controller = getAppController();
    return {
      syncVersion: Number(currentWorkspaceStorage(controller)?.getItem("bf_last_sync_version") || 0),
      socketReady: controller?._wsReady === true,
      pollingActive: Boolean(controller?._wsPollingTimer),
    };
  });
  assert(
    before.socketReady && before.pollingActive,
    `Browser did not retain ready socket + polling state: ${JSON.stringify({ before, syncResponses })}`,
  );
  droppedHints = 0;
  syncResponses.length = 0;
  const quietUntil = Date.now() + 3_000;
  await employeePage.waitForFunction((deadline) => Date.now() >= deadline, quietUntil);
  syncResponses.length = 0;

  const managerContext = await browser.newContext({ locale: "vi-VN" });
  await apiLogin(managerContext, accounts.manager);
  const allDataResponse = await managerContext.request.get(`${baseURL}/api/get-all-data?since=0`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const allData = await allDataResponse.json();
  assert(allDataResponse.ok(), `Manager full read failed: ${allDataResponse.status()}`);
  const expertId = `ws-miss-e2e-${runId}-expert`;
  const expertName = `Chuyen gia missed hint ${runId}`;
  mutationStartedAt = Date.now();
  const mutationResponse = await managerContext.request.post(`${baseURL}/api/sync`, {
    headers: await csrfHeaders(managerContext),
    data: {
      chuyengia: [{
        id: expertId,
        rootId: expertId,
        hoTen: expertName,
        soChungChi: `WS-MISS-${runId}`,
        soCCCD: `079${runId.slice(-9)}`,
      }],
      baseSyncVersion: Number(allData.syncVersion || 0),
      clientMutationId: `ws-miss-e2e-${runId}-create`,
    },
  });
  const mutationBody = await mutationResponse.json().catch(() => ({}));
  assert(mutationResponse.ok(), `Manager mutation failed: ${JSON.stringify(mutationBody)}`);

  const convergedRow = employeePage.locator("#chuyengia-table tbody tr").filter({ hasText: expertName });
  await convergedRow.first().waitFor({ state: "visible", timeout: 50_000 });
  assert(droppedHints > 0, "The E2E proxy did not drop a db_changed hint");
  const after = await employeePage.evaluate(async (expectedId) => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const { currentWorkspaceStorage } = await import("/frontend/app/SyncWorkspaceContext.js");
    const controller = getAppController();
    const record = (controller?.model?.state?.chuyengia || []).find((item) => item.id === expectedId);
    return {
      record,
      syncVersion: Number(currentWorkspaceStorage(controller)?.getItem("bf_last_sync_version") || 0),
      socketReady: controller?._wsReady === true,
      pollingActive: Boolean(controller?._wsPollingTimer),
    };
  }, expertId);
  assert(await convergedRow.count() === 1, `Polling did not converge one visible committed record: ${JSON.stringify({ after, syncResponses })}`);
  assert((await convergedRow.first().innerText()).includes(expertName), "Visible row does not contain the committed record name");
  assert(after.syncVersion > before.syncVersion, "Polling did not advance the browser sync cursor");
  assert(after.socketReady && after.pollingActive, "Socket stopped being healthy during missed-hint recovery");
  const convergenceMilliseconds = Date.now() - mutationStartedAt;
  const earlyDeltaResponses = syncResponses.filter((item) => (
    item.path.startsWith("/api/sync/delta")
    && item.elapsedSinceMutation !== null
    && item.elapsedSinceMutation < 20_000
  ));
  assert(
    convergenceMilliseconds >= 20_000,
    `Convergence happened before the bounded polling window and is not valid missed-hint evidence: ${JSON.stringify({ convergenceMilliseconds, syncResponses })}`,
  );
  assert(earlyDeltaResponses.length === 0, `A non-polling delta request caused convergence: ${JSON.stringify(earlyDeltaResponses)}`);

  process.stdout.write(`${JSON.stringify({
    runId,
    droppedHints,
    beforeSyncVersion: before.syncVersion,
    afterSyncVersion: after.syncVersion,
    convergenceMilliseconds,
    socketReady: after.socketReady,
    pollingActive: after.pollingActive,
    convergedRecordId: after.record.id,
  }, null, 2)}\n`);
  await managerContext.close();
  await employeeContext.close();
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) fixture("cleanup");
}
