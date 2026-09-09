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


function withTimeout(promise, timeoutMilliseconds, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label)), timeoutMilliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
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
  browser = await chromium.launch({
    headless: true,
    args: ["--no-proxy-server"],
  });

  const employeeContext = await browser.newContext({ locale: "vi-VN" });
  let droppedHints = 0;
  let resolveSocketReady;
  const socketReady = new Promise((resolve) => {
    resolveSocketReady = resolve;
  });
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
      if (payload?.type === "ready") resolveSocketReady(payload);
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
  const initialAuthoritativePull = employeePage.waitForResponse((response) => (
    response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/get-all-data"
      && response.ok()
  ), { timeout: 30_000 });
  await employeePage.goto(`${baseURL}/chuyen-gia`, { waitUntil: "domcontentloaded" });
  await waitForApp(employeePage);
  const initialResponse = await initialAuthoritativePull;
  const initialBody = await initialResponse.json().catch(() => ({}));
  const readyMessage = await withTimeout(
    socketReady,
    30_000,
    "Browser WebSocket did not receive the authenticated ready frame",
  );
  const before = {
    syncVersion: Number(initialBody.syncVersion || 0),
    socketReady: readyMessage?.type === "ready"
      && String(readyMessage?.organizationId || "") === organizationId,
  };
  assert(
    before.socketReady && Number.isInteger(before.syncVersion),
    `Browser did not finish authoritative startup with a ready socket: ${JSON.stringify({ before, syncResponses })}`,
  );
  droppedHints = 0;
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

  const convergedRow = employeePage.locator(
    `#chuyengia-table tbody tr:has(a[data-bf-action="show-expert"][data-id="${expertId}"])`,
  );
  await convergedRow.first().waitFor({ state: "visible", timeout: 50_000 });
  assert(droppedHints > 0, "The E2E proxy did not drop a db_changed hint");
  assert(await convergedRow.count() === 1, `Polling did not converge one visible committed record: ${JSON.stringify({ syncResponses })}`);
  assert((await convergedRow.first().innerText()).includes(expertName), "Visible row does not contain the committed record name");
  const convergenceMilliseconds = Date.now() - mutationStartedAt;
  const earlyDeltaResponses = syncResponses.filter((item) => (
    item.path.startsWith("/api/sync/delta")
    && item.elapsedSinceMutation !== null
    && item.elapsedSinceMutation < 20_000
  ));
  const pollingDeltaResponses = syncResponses.filter((item) => (
    item.path.startsWith("/api/sync/delta")
      && item.status === 200
      && item.elapsedSinceMutation >= 20_000
      && Number(item.body?.syncVersion || 0) > before.syncVersion
  ));
  const afterSyncVersion = Math.max(
    before.syncVersion,
    ...pollingDeltaResponses.map((item) => Number(item.body?.syncVersion || 0)),
  );
  assert(
    convergenceMilliseconds >= 20_000,
    `Convergence happened before the bounded polling window and is not valid missed-hint evidence: ${JSON.stringify({ convergenceMilliseconds, syncResponses })}`,
  );
  assert(earlyDeltaResponses.length === 0, `A non-polling delta request caused convergence: ${JSON.stringify(earlyDeltaResponses)}`);
  assert(
    pollingDeltaResponses.length > 0 && afterSyncVersion > before.syncVersion,
    `Visible convergence was not backed by the bounded polling delta: ${JSON.stringify(syncResponses)}`,
  );

  process.stdout.write(`${JSON.stringify({
    runId,
    droppedHints,
    beforeSyncVersion: before.syncVersion,
    afterSyncVersion,
    convergenceMilliseconds,
    socketReady: before.socketReady,
    pollingActive: pollingDeltaResponses.length > 0,
    convergedRecordId: expertId,
  }, null, 2)}\n`);
  await managerContext.close();
  await employeeContext.close();
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) fixture("cleanup");
}
