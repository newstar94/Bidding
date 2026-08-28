import { expect, test } from "@playwright/test";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) console.warn("E2E_PASSWORD or ADMIN_PASSWORD is not configured; proceeding with empty password.");

test.beforeEach(async ({ page }) => {
  // Keep the browser matrix deterministic when host-level traffic filters
  // inject their own userscripts into Playwright's temporary profiles.
  await page.route("http://local.adguard.org/**", (route) => route.abort("blockedbyclient"));
});

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, undefined, { timeout: 30_000 });
}

async function expectFilterDropdownToOpen(page, route, selectId) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForApp(page);

  const combobox = page.locator(`${selectId}-combobox`);
  await expect(combobox).toBeVisible();
  await expect(combobox).toHaveAttribute("data-bf-auto-scroll", "off");
  await combobox.click();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");

  const listboxId = await combobox.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  await expect(page.locator(`#${listboxId}`)).toBeVisible();
}

test("authenticated cold load hydrates icons and navigation handlers", async ({ page }) => {
  const runtimeFailures = [];
  const appOrigin = new URL(String(process.env.E2E_BASE_URL || "http://127.0.0.1:8000")).origin;
  page.on("pageerror", (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    if (!location.url || location.url.startsWith(appOrigin)) {
      runtimeFailures.push(`console: ${message.text()}`);
    }
  });

  const login = await page.context().request.post("/api/auth/login", {
    data: { username, password, remember: false },
  });
  expect(login.ok()).toBe(true);

  const response = await page.goto("/tong-quan", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  // Keep readiness polling inside the page. Repeated Playwright evaluate calls
  // can deadlock Firefox trace snapshots while Lucide replaces the initial
  // icon nodes, leaving both the assertion and the page's main thread stuck.
  await page.waitForFunction(
    () => performance.getEntriesByName("bf:first-app-frame").length > 0,
    undefined,
    { timeout: 30_000 },
  );
  await waitForApp(page);
  await expect(page.locator("i[data-lucide]")).toHaveCount(0);
  expect(await page.locator("svg[data-lucide]").count()).toBeGreaterThan(0);

  const profile = page.locator("#header-profile-trigger");
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page.locator("#profile-dropdown-menu")).toHaveClass(/active/);
  expect(runtimeFailures).toEqual([]);
});

test("primary route module starts on click and keeps visible navigation feedback while loading", async ({ page }) => {
  const login = await page.context().request.post("/api/auth/login", {
    data: { username, password, remember: false },
  });
  expect(login.ok()).toBe(true);

  await page.route("**/service-worker.js?**", (route) => route.abort());
  let releaseChunk;
  const chunkGate = new Promise((resolve) => { releaseChunk = resolve; });
  let chunkRequests = 0;
  let navigationStarted = false;
  await page.route("**/dist/assets/KeHoachView-*.js", async (route) => {
    chunkRequests += 1;
    // Let an accidental pre-click request finish so the test fails on the
    // explicit zero-request assertion instead of deadlocking app startup.
    if (navigationStarted) await chunkGate;
    await route.continue();
  });

  const response = await page.goto("/tong-quan", { waitUntil: "domcontentloaded" });
  expect(response?.ok()).toBe(true);
  await waitForApp(page);

  // Cross the idle-warming window: route UI must still remain cold.
  await page.waitForTimeout(7_500);
  expect(chunkRequests).toBe(0);

  try {
    navigationStarted = true;
    await page.locator("#btn-tab-kehoach").evaluate((button) => button.click());
    await expect.poll(() => chunkRequests).toBe(1);
    await expect(page.locator("#btn-tab-kehoach")).toHaveClass(/bf-nav-intent/);
    await page.waitForTimeout(160);
    await expect(page.locator("#btn-tab-kehoach")).toHaveClass(/bf-nav-waiting/);
    await expect(page.locator(".content-viewport")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#tab-dashboard")).toHaveClass(/active/);

    releaseChunk();
    await expect(page.locator("#tab-kehoach")).toHaveClass(/active/);
    await expect(page.locator("#btn-tab-kehoach")).not.toHaveClass(/bf-nav-intent|bf-nav-waiting/);
    await expect(page.locator(".content-viewport")).not.toHaveAttribute("aria-busy", "true");
    expect(chunkRequests).toBe(1);
  } finally {
    releaseChunk();
  }
});

test("required browser renders public routes, shell, and filter dropdowns", async ({ page }) => {
  const landing = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(landing?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="landing"]')).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));

  const legal = await page.goto("/legal", { waitUntil: "domcontentloaded" });
  expect(legal?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="legal"]')).toBeVisible();

  await page.goto("/dang-nhap", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const loginResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/auth/login"
    && response.request().method() === "POST"
  ));
  await page.locator("#login-username").fill(username);
  await page.locator("#login-password").fill(password);
  await page.locator("#form-auth-login button[type='submit']").click();
  expect((await loginResponse).ok()).toBe(true);
  await expect(page.locator("#auth-overlay")).toBeHidden();
  await waitForApp(page);

  await page.goto("/tong-quan", { waitUntil: "domcontentloaded" });
  await waitForApp(page);
  const profile = page.locator("#header-profile-trigger");
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(page.locator("#profile-dropdown-menu")).toHaveClass(/active/);

  await expectFilterDropdownToOpen(page, "/goi-thau", "#filter-goithau-trangthai");
  await expectFilterDropdownToOpen(page, "/ke-hoach", "#filter-kehoach-nam");
  await expectFilterDropdownToOpen(page, "/hop-dong", "#filter-hopdong-nam");
});
