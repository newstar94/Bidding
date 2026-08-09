import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";

const baseURL = String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const runId = `offline-e2e-${Date.now()}`;
const organizationId = `${runId}-org`;
const password = `Aa!9${randomBytes(12).toString("hex")}`;
const account = {
  id: `${runId}-manager-id`,
  username: `${runId}-manager`,
  email: `${runId}-manager@example.test`,
  name: `Offline manager ${runId}`,
};
const expertName = `Chuyên gia offline ${runId}`;
const interruptedExpertName = `Chuyên gia gián đoạn ${runId}`;
const fixturePayload = {
  runId,
  organizationId,
  password,
  account,
  crudCodes: { expert: expertName },
};

function fixture(action) {
  const execution = spawnSync(process.env.PYTHON || "python", ["scripts/package_pairwise_fixture.py", action], {
    cwd: process.cwd(),
    env: process.env,
    input: JSON.stringify(fixturePayload),
    encoding: "utf8",
    windowsHide: true,
  });
  if (execution.status !== 0) throw new Error(`Fixture ${action} failed: ${execution.stderr || execution.stdout}`);
  return JSON.parse(execution.stdout || "{}");
}

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false" && getComputedStyle(loader).visibility === "hidden";
  }, null, { timeout: 20_000 });
}

async function fillExpertForm(page, name, suffix) {
  await page.locator("#cg-hoten").fill(name);
  await page.locator("#cg-socccd").fill(`07${String(Date.now()).slice(-9)}${suffix}`);
  await page.locator("#cg-ngaycapcccd").fill("01/01/2024");
  await page.locator("#cg-noicapcccd").fill("Cục Cảnh sát QLHC về TTXH");
  await page.locator("#cg-sochungchi").fill(`${runId}-CC-${suffix}`);
  await page.locator("#cg-ngaycapchungchi").fill("01/02/2024");
  await page.locator("#cg-donvicapchungchi").fill("Cục Quản lý Đấu thầu");
}

let browser;
let fixtureCreated = false;
try {
  fixture("setup");
  fixtureCreated = true;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh" });
  const page = await context.newPage();
  const syncRequests = [];
  const syncResponses = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/sync") syncRequests.push(request);
  });
  page.on("response", (response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === "/api/sync") {
      syncResponses.push({ status: response.status(), ok: response.ok() });
    }
  });

  await page.goto(`${baseURL}/dang-nhap`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#login-username").fill(account.username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await page.waitForFunction(() => getComputedStyle(document.getElementById("auth-overlay")).display === "none", null, { timeout: 20_000 });
  await page.goto(`${baseURL}/chuyen-gia`, { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  await page.locator("#btn-add-chuyengia").click();
  await page.locator("#modal-chuyengia.active").waitFor({ state: "visible" });
  await context.setOffline(true);
  await page.locator("#offline-indicator-banner.visible").waitFor({ state: "visible", timeout: 10_000 });
  await fillExpertForm(page, expertName, "1");
  await page.locator("#form-chuyengia button[type='submit']").click();
  await page.waitForFunction(() => document.getElementById("btn-force-sync")?.dataset?.syncState === "offline", null, { timeout: 15_000 });
  await page.waitForTimeout(500);
  if (await page.locator("#modal-chuyengia.active").isHidden()) {
    throw new Error("Offline save closed the modal and implied a committed server write");
  }

  const committed = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.ok()
  ), { timeout: 20_000 });
  await context.setOffline(false);
  const reconnectOutcome = await Promise.race([
    committed.then(() => "committed"),
    page.waitForTimeout(5_000).then(() => "not-retried"),
  ]);
  if (reconnectOutcome !== "committed") {
    const diagnostics = await page.evaluate(async () => {
      const { getAppController } = await import("/frontend/app/controllerRef.js");
      const controller = getAppController();
      return {
        online: navigator.onLine,
        syncState: document.getElementById("btn-force-sync")?.dataset?.syncState || "",
        pendingBatch: Boolean(controller?.model?.buildMutationSyncPayload?.()),
      };
    });
    throw new Error(`Network recovery did not retry the pending outbox: ${JSON.stringify({ diagnostics, syncResponses })}`);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-chuyengia").fill(expertName);
  const rows = page.locator("#chuyengia-table tbody tr").filter({ hasText: expertName });
  await rows.first().waitFor({ state: "visible", timeout: 20_000 });
  const rowCount = await rows.count();
  if (rowCount !== 1) throw new Error(`Offline retry created ${rowCount} matching records`);

  const paginated = await context.request.get(`${baseURL}/api/paginate?table=chuyengia&page=1&pageSize=200`, {
    headers: { "X-Active-Org": encodeURIComponent(organizationId) },
  });
  const payload = await paginated.json();
  const serverMatches = (payload.items || []).filter((item) => item.hoTen === expertName);
  if (!paginated.ok() || serverMatches.length !== 1) {
    throw new Error(`PostgreSQL-backed pagination has ${serverMatches.length} matching records`);
  }

  await page.locator("#btn-add-chuyengia").click();
  await page.locator("#modal-chuyengia.active").waitFor({ state: "visible" });
  await fillExpertForm(page, interruptedExpertName, "2");
  let abortedSyncCount = 0;
  let allowInterruptedSync = false;
  await page.route("**/api/sync", async (route) => {
    if (route.request().method() === "POST" && !allowInterruptedSync) {
      abortedSyncCount += 1;
      await route.abort("internetdisconnected");
      return;
    }
    await route.continue();
  });
  const interruptedRequestFailed = page.waitForEvent("requestfailed", {
    predicate: (request) => (
      request.method() === "POST"
        && new URL(request.url()).pathname === "/api/sync"
    ),
    timeout: 15_000,
  });
  await page.locator("#form-chuyengia button[type='submit']").click();
  await interruptedRequestFailed;
  await page.waitForFunction(async () => {
    const [{ getAppController }, { getSyncActivitySnapshot }] = await Promise.all([
      import("/frontend/app/controllerRef.js"),
      import("/frontend/app/SyncCoordinator.js"),
    ]);
    const controller = getAppController();
    const activity = getSyncActivitySnapshot(controller);
    const syncState = document.getElementById("btn-force-sync")?.dataset?.syncState || "";
    return activity.settled
      && activity.phase === "transportError"
      && activity.hasPendingMutations
      && syncState === "transport-error"
      && Boolean(controller?.model?.buildMutationSyncPayload?.());
  }, null, { timeout: 15_000 });
  const interruptedSyncState = await page.locator("#btn-force-sync").getAttribute("data-sync-state");
  if (interruptedSyncState !== "transport-error") {
    throw new Error(`Interrupted sync exposed an invalid UI state: ${interruptedSyncState || "missing"}`);
  }
  if (abortedSyncCount < 1 || await page.locator("#modal-chuyengia.active").isHidden()) {
    throw new Error("Interrupted save did not remain pending for an explicit retry");
  }
  await page.locator('#modal-chuyengia .modal-close[data-close="modal-chuyengia"]').click();
  await page.locator("#modal-chuyengia.active").waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    return !controller?._autoSyncPromise
      && !controller?._syncImmediateTimer
      && Boolean(controller?.model?.buildMutationSyncPayload?.());
  }, null, { timeout: 10_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForFunction(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    const controller = getAppController();
    return !controller?._autoSyncPromise
      && Boolean(controller?.model?.buildMutationSyncPayload?.());
  }, null, { timeout: 15_000 });
  const pendingAfterReload = await page.evaluate(async () => {
    const { getAppController } = await import("/frontend/app/controllerRef.js");
    return Boolean(getAppController()?.model?.buildMutationSyncPayload?.());
  });
  if (!pendingAfterReload) {
    throw new Error("Interrupted mutation disappeared from the outbox after reload");
  }
  const interruptedCommit = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.ok()
  ), { timeout: 20_000 });
  allowInterruptedSync = true;
  await page.locator("#btn-force-sync").evaluate((button) => button.click());
  await interruptedCommit;
  await page.unroute("**/api/sync");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.locator("#search-chuyengia").fill(interruptedExpertName);
  const interruptedRows = page.locator("#chuyengia-table tbody tr").filter({ hasText: interruptedExpertName });
  await interruptedRows.first().waitFor({ state: "visible", timeout: 20_000 });
  const interruptedRowCount = await interruptedRows.count();
  if (interruptedRowCount !== 1) throw new Error(`Manual retry created ${interruptedRowCount} matching records`);

  process.stdout.write(`${JSON.stringify({
    runId,
    syncAttempts: syncRequests.length,
    reconnectRetry: { rowCount, serverCount: serverMatches.length },
    interruptedRetry: { pendingAfterReload, rowCount: interruptedRowCount },
  }, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  if (fixtureCreated) fixture("cleanup");
}
