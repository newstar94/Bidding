import { expect, test } from "@playwright/test";

const username = String(process.env.E2E_USERNAME || process.env.ADMIN_USERNAME || "admin");
const password = String(process.env.E2E_PASSWORD || process.env.ADMIN_PASSWORD || "");
if (!password) console.warn("E2E_PASSWORD or ADMIN_PASSWORD is not configured; proceeding with empty password.");

test.beforeEach(async ({ browserName, context }) => {
  // Keep the browser matrix deterministic when host-level traffic filters
  // inject their own userscripts into Firefox's temporary profile. Playwright
  // routing disables the HTTP cache for the entire context, so do not install
  // this Firefox-only workaround in Chromium or WebKit.
  if (browserName === "firefox") {
    await context.route("http://local.adguard.org/**", (route) => route.abort("blockedbyclient"));
  }
});

async function waitForApp(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById("system-init-loader");
    return loader?.getAttribute("aria-busy") === "false"
      && getComputedStyle(loader).visibility === "hidden";
  }, undefined, { timeout: 30_000 });
}

async function loginWithBrowserTransport(page) {
  if (!/^https?:/u.test(page.url())) {
    const browserReady = await page.goto("/health/live", { waitUntil: "domcontentloaded" });
    expect(browserReady?.ok()).toBe(true);
  }
  const login = await page.evaluate(async (credentials) => {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  }, { username, password, remember: false });
  expect(login.ok, login.body).toBe(true);
}

async function expectFilterDropdownToOpen(page, route, selectId) {
  const browserName = page.context().browser()?.browserType().name();
  if (/^https?:/u.test(page.url()) && browserName !== "firefox") {
    // These assertions cover route navigation and filter behavior. Reuse the
    // authenticated application document so each route module loads once;
    // authenticated cold startup is covered by the dedicated scenario above.
    await page.evaluate((target) => {
      history.pushState({}, "", target);
      dispatchEvent(new PopStateEvent("popstate"));
    }, route);
    await page.waitForURL((url) => url.pathname === route);
  } else {
    // Firefox can retain a host-injected callback across top-level navigation.
    if (/^https?:/u.test(page.url())) {
      await page.goto("about:blank", { waitUntil: "commit" });
    }
    await page.goto(route, { waitUntil: "commit" });
    await waitForApp(page);
  }

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

  // Warm only the browser transport. Firefox/WebKit artifact capture can delay
  // their first real network navigation on Windows; the liveness response has
  // no application assets, so /tong-quan remains a true cold application load.
  const browserReady = await page.goto("/health/live", { waitUntil: "domcontentloaded" });
  expect(browserReady?.ok()).toBe(true);
  page.on("pageerror", (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    if (!location.url || location.url.startsWith(appOrigin)) {
      runtimeFailures.push(`console: ${message.text()}`);
    }
  });

  // Reuse the browser transport warmed by /health/live. On filtered Windows
  // hosts, opening a second APIRequest transport here can time out even while
  // the browser's already-established same-origin connection remains healthy.
  await loginWithBrowserTransport(page);

  // The app exposes its own first-frame and loader readiness contracts below.
  // Waiting for DOMContentLoaded here lets host-injected parser scripts hold
  // Firefox's navigation open even after BiddingFlow has received a 200.
  const response = await page.goto("/tong-quan", { waitUntil: "commit" });
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

test("primary route module warms once and navigation reuses the loaded module", async ({ page }) => {
  await loginWithBrowserTransport(page);

  await page.route("**/service-worker.js?**", (route) => route.abort());
  let chunkRequests = 0;
  await page.route("**/dist/assets/KeHoachView-*.js", async (route) => {
    chunkRequests += 1;
    await route.continue();
  });

  const response = await page.goto("/tong-quan", { waitUntil: "commit" });
  expect(response?.ok()).toBe(true);
  await waitForApp(page);

  await expect.poll(() => chunkRequests).toBe(1);
  await page.locator("#btn-tab-kehoach").evaluate((button) => button.click());
  await expect(page.locator("#tab-kehoach")).toHaveClass(/active/);
  await expect(page.locator("#btn-tab-kehoach")).not.toHaveClass(/bf-nav-intent|bf-nav-waiting/);
  await expect(page.locator(".content-viewport")).not.toHaveAttribute("aria-busy", "true");
  expect(chunkRequests).toBe(1);
});

test("required browser renders public routes, shell, and filter dropdowns", async ({ page }) => {
  const landing = await page.goto("/", { waitUntil: "commit" });
  expect(landing?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="landing"]')).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/landing-ready/u);
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", await page.locator("body").evaluate((body) => body.clientWidth));

  const legal = await page.goto("/legal", { waitUntil: "commit" });
  expect(legal?.ok()).toBe(true);
  await expect(page.locator('[data-bf-shell="legal"]')).toBeVisible();
  await expect(page.locator("body")).toHaveClass(/legal-ready/u);

  await page.goto("/dang-nhap", { waitUntil: "commit" });
  await waitForApp(page);
  await expect(page.locator("#form-auth-login")).toBeVisible();
  await loginWithBrowserTransport(page);

  // AuthShell on the public login document observes the newly-created session
  // and may schedule its own redirect. Retire that document before navigating
  // the authenticated workspace so Firefox never has two competing loads.
  const context = page.context();
  await page.close();
  const workspacePage = await context.newPage();
  const workspace = await workspacePage.goto("/tong-quan", { waitUntil: "commit" });
  expect(workspace?.ok()).toBe(true);
  await waitForApp(workspacePage);

  await expect(workspacePage).toHaveURL(/\/tong-quan(?:-admin)?$/);
  const profile = workspacePage.locator("#header-profile-trigger");
  await expect(profile).toBeVisible();
  await profile.click();
  await expect(workspacePage.locator("#profile-dropdown-menu")).toHaveClass(/active/);
  await workspacePage.close();

  const filterPage = await context.newPage();
  try {
    await expectFilterDropdownToOpen(filterPage, "/goi-thau", "#filter-goithau-trangthai");
    await expectFilterDropdownToOpen(filterPage, "/ke-hoach", "#filter-kehoach-nam");
    await expectFilterDropdownToOpen(filterPage, "/hop-dong", "#filter-hopdong-nam");
  } finally {
    await filterPage.close();
  }
});
