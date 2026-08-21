import { expect, test } from "@playwright/test";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");

test.use({ serviceWorkers: "block" });

test.afterEach(async ({ page }) => {
  await page.__releaseStartupSyncReads?.();
});

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  });
}

async function login(page) {
  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await page.waitForFunction(
    () => typeof document.getElementById("form-auth-login")?.onsubmit === "function",
  );
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  await expect(page.locator("#auth-overlay")).toBeHidden();
}

async function waitForInitialReconciliation(page) {
  await page.waitForFunction(() => (
    document.getElementById("btn-force-sync")?.dataset.syncState === "server-saved"
  ));
}

async function fillExpertForm(page, suffix) {
  const projectDigit = { chromium: "1", firefox: "2", webkit: "3" }[
    test.info().project.name
  ] || "9";
  await page.locator("#cg-hoten").fill(`Chuyên gia startup ${suffix}`);
  await page.locator("#cg-socccd").fill(`07${String(Date.now()).slice(-9)}${projectDigit}`);
  await page.locator("#cg-ngaycapcccd").fill("2020-01-01");
  await page.locator("#cg-noicapcccd").fill("Cục Cảnh sát QLHC về TTXH");
  await page.locator("#cg-sochungchi").fill(`STARTUP-${suffix}`);
  await page.locator("#cg-ngaycapchungchi").fill("2020-02-01");
  await page.locator("#cg-donvicapchungchi").fill("Cục Quản lý Đấu thầu");
}

async function activeOrganizationId(page) {
  return page.evaluate(() => (
    sessionStorage.getItem("bf_active_org") || localStorage.getItem("bf_active_org") || ""
  ));
}

function installBrowserReadGate({ includePagination }) {
  if (globalThis.__bfStartupSyncReadGate) return;
  const originalFetch = globalThis.fetch.bind(globalThis);
  let releaseReads;
  const readsReleased = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const gate = {
    released: false,
    started: false,
    release() {
      if (this.released) return;
      this.released = true;
      releaseReads();
    },
  };
  globalThis.__bfStartupSyncReadGate = gate;
  globalThis.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input?.url;
    const url = new URL(rawUrl, globalThis.location.href);
    const method = String(init.method || input?.method || "GET").toUpperCase();
    const heldPath = url.pathname === "/api/get-all-data"
      || url.pathname === "/api/sync/delta"
      || (includePagination && url.pathname === "/api/paginate"
        && url.searchParams.get("table") === "chuyengia");
    if (method === "GET" && heldPath && !gate.released) {
      gate.started = true;
      await readsReleased;
    }
    return originalFetch(input, init);
  };
}

async function setupServerReadGate(page, { includePagination = false } = {}) {
  await page.addInitScript(installBrowserReadGate, { includePagination });
  await page.evaluate(installBrowserReadGate, { includePagination });
  page.__releaseStartupSyncReads = async () => {
    await page.evaluate(() => globalThis.__bfStartupSyncReadGate?.release());
  };
}

test("startup_does_not_commit_a_stale_record_before_authoritative_reconciliation", async ({ page }) => {
  await login(page);
  await page.goto("/chuyen-gia", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await waitForInitialReconciliation(page);

  await setupServerReadGate(page);
  let syncPosts = 0;
  await page.route("**/api/sync", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    syncPosts += 1;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        status: "conflict",
        message: "E2E retained local mutation",
        currentSyncVersion: 0,
        errors: [],
      }),
    });
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chuyengia-table")).toBeVisible();
  await page.waitForFunction(() => globalThis.__bfStartupSyncReadGate?.started === true);
  await page.locator("#btn-add-chuyengia").click();
  await expect(page.locator("#modal-chuyengia.active")).toBeVisible();
  const formRoute = new URL(page.url()).pathname;
  expect(formRoute).toBe("/chuyen-gia/tao-moi");
  const suffix = `${Date.now()}-${test.info().project.name}`;
  await fillExpertForm(page, suffix);
  await page.locator("#form-chuyengia button[type='submit']").click();

  // The submit handler stages the local mutation before it waits on the
  // authoritative startup boundary.  Wait for that observable state instead
  // of assuming WebKit has dispatched the async handler within a fixed delay.
  await expect(page.locator("#btn-force-sync")).toHaveAttribute(
    "data-sync-state",
    "local-pending",
  );
  expect(syncPosts).toBe(0);
  expect(new URL(page.url()).pathname).toBe(formRoute);

  await page.__releaseStartupSyncReads();
  await expect.poll(async () => ({
    syncPosts,
    syncState: await page.locator("#btn-force-sync").getAttribute("data-sync-state"),
  })).toEqual({ syncPosts: 1, syncState: "conflict" });
  expect(syncPosts).toBe(1);
  expect(new URL(page.url()).pathname).toBe(formRoute);
  await expect(page.locator("#modal-chuyengia.active")).toBeVisible();
});

test("server_deleted_record_is_not_resurrected_from_indexeddb_startup", async ({ page }) => {
  await login(page);
  await page.goto("/chuyen-gia", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  await waitForInitialReconciliation(page);

  const suffix = `deleted-${Date.now()}-${test.info().project.name}`;
  const expertName = `Chuyên gia startup ${suffix}`;
  await page.locator("#btn-add-chuyengia").click();
  await expect(page.locator("#modal-chuyengia.active")).toBeVisible();
  await fillExpertForm(page, suffix);
  const createResponsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/sync"
      && response.ok()
  ));
  await page.locator("#form-chuyengia button[type='submit']").click();
  const createResponse = await createResponsePromise;
  const createPayload = createResponse.request().postDataJSON();
  const createdExpert = (createPayload.chuyengia || []).find(
    (record) => record.hoTen === expertName,
  );
  expect(createdExpert?.id).toBeTruthy();
  const createResult = await createResponse.json();
  const createdVersion = (createResult.rowVersions || []).find((entry) => (
    ["chuyengia", "chuyen_gia"].includes(entry?.table)
      && String(entry?.id) === String(createdExpert.id)
  ))?.rowVersion;
  expect(Number.isInteger(createdVersion)).toBe(true);
  const createdSyncVersion = createResult.syncVersion;
  expect(Number.isInteger(createdSyncVersion)).toBe(true);

  await setupServerReadGate(page, { includePagination: true });

  const organizationId = await activeOrganizationId(page);
  expect(organizationId).toBeTruthy();
  const deleteResult = await page.evaluate(async ({ organizationId, recordId, rowVersion, baseSyncVersion, suffix }) => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrf_token="))
      ?.slice("csrf_token=".length);
    if (!csrf) return { ok: false, status: 0, body: { code: "CSRF_COOKIE_MISSING" } };
    const response = await fetch("/api/sync", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Active-Org": encodeURIComponent(organizationId),
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify({
        deletions: [{
          table: "chuyengia",
          id: recordId,
          expectedVersion: rowVersion,
        }],
        baseSyncVersion,
        clientMutationId: `startup-delete-${suffix}`,
      }),
    });
    return { ok: response.ok, status: response.status, body: await response.json() };
  }, {
    organizationId,
    recordId: createdExpert.id,
    rowVersion: createdVersion,
    baseSyncVersion: createdSyncVersion,
    suffix,
  });
  expect(deleteResult, JSON.stringify(deleteResult.body)).toMatchObject({ ok: true, status: 200 });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("#chuyengia-table")).toBeVisible();
  await page.waitForFunction(() => globalThis.__bfStartupSyncReadGate?.started === true);
  expect(new URL(page.url()).pathname).toBe("/chuyen-gia");
  await page.locator("#search-chuyengia").fill(expertName);
  await expect(
    page.locator("#chuyengia-table tbody tr").filter({ hasText: expertName }).first(),
  ).toBeVisible();

  await page.__releaseStartupSyncReads();
  await waitForInitialReconciliation(page);
  await page.locator("#search-chuyengia").fill(expertName);
  await expect(
    page.locator("#chuyengia-table tbody tr").filter({ hasText: expertName }),
  ).toHaveCount(0);
  expect(new URL(page.url()).pathname).toBe("/chuyen-gia");
});
