import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { ADMIN_ROUTES } from "../../frontend/admin-platform/AdminRouter.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const template = await readFile(join(root, "views/admin/index.html"), "utf8");
const cases = new Map();
let browser;
let server;
let baseURL;
let nextCase = 0;

// Synthetic, test-only HTTP fixtures. They model the existing public read
// contracts; none of the names or totals below are production data.
const overviewFixture = {
  generatedAt: "2026-09-23T02:42:00Z",
  metrics: {
    organizations: 128,
    activeOrganizations: 119,
    newOrganizations30Days: 12,
    users: 3482,
    activeAccounts: 3320,
    activeUsers: null,
    newUsers30Days: 246,
    activeSubscriptions: 96,
    currentPeriodRevenue: { value: 12500000, currency: "VND", period: "current_month" },
    mrr: null,
    arr: null,
    unpaidInvoices: null,
    overdueInvoices: null,
    pendingJobs: null,
  },
  recentOrganizations: [
    ["org-layout-1", "Công ty Kiểm thử An Phát", 24, "active", "active"],
    ["org-layout-2", "Ban Quản lý Kiểm thử Thăng Long", 56, "active", "active"],
    ["org-layout-3", "Công ty Kiểm thử Minh Dương", 8, "suspended", "expired"],
    ["org-layout-4", "Đơn vị Kiểm thử Đà Nẵng", 120, "active", "active"],
    ["org-layout-5", "Công ty Kiểm thử Việt Nam", 37, "inactive", "cancelled"],
  ].map(([id, name, memberCount, status, subscriptionStatus], index) => ({
    id, name, memberCount, status, subscriptionStatus,
    createdAt: `2026-09-${String(23 - index).padStart(2, "0")} 01:15:00`,
  })),
  charts: [
    {
      key: "newUsers", label: "Người dùng mới",
      series: [{ key: "newUsers", label: "Người dùng mới", points: [
        { date: "2026-08-25", value: 12 },
        { date: "2026-08-31", value: 18 },
        { date: "2026-09-06", value: 24 },
        { date: "2026-09-12", value: 31 },
        { date: "2026-09-18", value: 39 },
        { date: "2026-09-23", value: 45 },
      ] }],
    },
    {
      key: "newOrganizations", label: "Tổ chức mới",
      series: [{ key: "newOrganizations", label: "Tổ chức mới", points: [
        { date: "2026-08-25", value: 1 },
        { date: "2026-08-31", value: 2 },
        { date: "2026-09-06", value: 3 },
        { date: "2026-09-12", value: 1 },
        { date: "2026-09-18", value: 2 },
        { date: "2026-09-23", value: 3 },
      ] }],
    },
    {
      key: "revenue", label: "Doanh thu theo thời gian",
      series: [{ key: "revenue", label: "Doanh thu đã xác minh", points: [
        { date: "2026-09-06", value: 7500000 },
        { date: "2026-09-23", value: 5000000 },
      ] }],
    },
    {
      key: "subscriptionDistribution", label: "Phân bố đăng ký",
      series: [{ key: "subscriptionDistribution", label: "Đăng ký theo trạng thái", points: [
        { label: "active", value: 96 }, { label: "expired", value: 8 },
      ] }],
    },
    {
      key: "invoiceStatus", label: "Trạng thái hóa đơn",
      series: [{ key: "invoiceStatus", label: "Hóa đơn theo trạng thái", points: [
        { label: "requested", value: 2 }, { label: "issued", value: 6 },
      ] }],
    },
  ],
  activityFeed: [{
    id: "org-layout-1:created", kind: "organization.created",
    title: "Công ty Kiểm thử An Phát", occurredAt: "2026-09-23T01:15:00Z",
    status: "active", detail: null,
  }],
  alerts: [{
    code: "INACTIVE_ORGANIZATIONS", severity: "warning", count: 9,
    title: "Tổ chức cần rà soát", message: "Tổ chức không ở trạng thái hoạt động.",
    href: "/admin/organizations?status=suspended",
  }],
};

const healthFixture = {
  generatedAt: "2026-09-23T02:42:00Z",
  status: "ready",
  application: { startupComplete: true, ready: true, eventLoopLagMs: 1.2 },
  database: { status: "available", schemaVersion: 90, latencyMs: 2, version: "17.6" },
  operations: {
    collectionAvailable: true,
    documentWorker: { active: 1, waiting: 2, completed: 8, failed: 0, rejected: 0 },
    backgroundJobs: [{ queue: "layout-fixture", status: "pending", count: 2, oldestSeconds: 1 }],
  },
  resources: {
    application: { status: "healthy" },
    postgresql: { status: "healthy" },
    documentWorker: { status: "healthy" },
    backgroundJobs: { status: "healthy" },
  },
};

function sendJSON(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

function contentType(pathname) {
  return ({
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
  })[extname(pathname)] || "application/octet-stream";
}

function testPage() {
  return template
    .replace("__BF_ADMIN_STYLES__", '<link rel="stylesheet" href="/node_modules/@tabler/core/dist/css/tabler.min.css"><link rel="stylesheet" href="/frontend/admin-platform/admin.css"><link rel="stylesheet" data-runtime-styles href="/layout-runtime.css">')
    .replace("__BF_ADMIN_VENDOR_SCRIPT__", "")
    .replace("__BF_ADMIN_SESSION__", JSON.stringify({
      valid: true, user: { id: "layout-super-admin", name: "Nguyễn Minh", platform_role: "super_admin" },
    }))
    // The source shell uses native ES modules; CSS is loaded above as in the
    // server template instead of asking the browser to import a CSS module.
    .replace("__BF_ADMIN_ENTRY__", "/frontend/admin-platform/AdminApp.js");
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const caseState = cases.get(request.headers["x-admin-layout-case"]);
      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(testPage());
        return;
      }
      if (pathname === "/api/admin/overview") {
        sendJSON(response, overviewFixture);
        return;
      }
      if (pathname === "/api/admin/health") {
        caseState?.onHealthRequested();
        if (caseState?.deferHealth) {
          caseState.healthResponses.add(response);
          response.once("close", () => caseState.healthResponses.delete(response));
        } else {
          if (caseState) caseState.healthSent = true;
          sendJSON(response, caseState?.healthStatus === 500 ? { error: "Health snapshot unavailable in the test fixture." } : healthFixture, caseState?.healthStatus || 200);
        }
        return;
      }
      if (pathname === "/layout-runtime.css") {
        response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        response.end("");
        return;
      }
      if (!pathname.startsWith("/frontend/")
        && !pathname.startsWith("/vendor/fonts/")
        && !pathname.startsWith("/node_modules/@tabler/core/")
        && !pathname.startsWith("/node_modules/dompurify/")) {
        response.writeHead(404);
        response.end("Not Found");
        return;
      }
      const path = resolve(root, pathname.startsWith("/vendor/") ? `views${pathname}` : pathname.slice(1));
      const relativePath = relative(root, path);
      if (relativePath.startsWith("..") || relativePath === "") throw new Error("Invalid fixture path");
      const payload = await readFile(path);
      response.writeHead(200, { "content-type": contentType(pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const caseState of cases.values()) caseState.releaseHealth();
  await browser?.close();
  if (server) {
    await new Promise((done) => {
      server.close(done);
      server.closeAllConnections();
    });
  }
});

async function loadOverview(width, height, { deferHealth = false, healthStatus = 200 } = {}) {
  const caseId = `admin-layout-${++nextCase}`;
  let onHealthRequested;
  const healthRequested = new Promise((done) => { onHealthRequested = done; });
  const caseState = {
    deferHealth, healthStatus, healthResponses: new Set(), healthSent: false, onHealthRequested,
    releaseHealth() {
      this.deferHealth = false;
      for (const response of this.healthResponses) {
        if (!response.destroyed && !response.writableEnded) {
          sendJSON(response, this.healthStatus === 500 ? { error: "Health snapshot unavailable in the test fixture." } : healthFixture, this.healthStatus);
        }
      }
      this.healthSent = true;
      this.healthResponses.clear();
    },
  };
  cases.set(caseId, caseState);
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    reducedMotion: "reduce",
    extraHTTPHeaders: { "x-admin-layout-case": caseId },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseURL}/admin`, { waitUntil: "domcontentloaded" });
  if (!deferHealth) {
    await page.locator('[data-admin-metric="organizations"]').waitFor({ state: "visible" });
    await page.locator(".bf-admin-operation-chip.is-success").first().waitFor({ state: "visible" });
  }
  await page.evaluate(() => document.fonts.ready);
  return {
    page, errors, caseState, healthRequested,
    async close() {
      caseState.releaseHealth();
      await context.close();
      cases.delete(caseId);
    },
  };
}

async function assertNoPageOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(dimensions.html <= dimensions.viewport + 1, `${label}: document overflow ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.body <= dimensions.viewport + 1, `${label}: body overflow ${JSON.stringify(dimensions)}`);
}

async function capture(page, label) {
  if (!process.env.ADMIN_OVERVIEW_SCREENSHOT_DIR) return;
  const directory = resolve(root, process.env.ADMIN_OVERVIEW_SCREENSHOT_DIR);
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `admin-overview-fixture-${label}.png`), fullPage: true });
  await page.screenshot({ path: join(directory, `admin-overview-fixture-${label}-viewport.png`) });
}

test("admin filters use the shared combobox and retain native submitted values", async () => {
  const fixture = await loadOverview(1200, 850);
  try {
    const { page } = fixture;
    await page.locator('.navbar-vertical [data-admin-link="/admin/system/sync"]').click();
    const input = page.locator('[role="combobox"][aria-label="Trạng thái"]');
    await input.waitFor();
    await input.click();
    const list = page.locator('.bf-admin-select-list:visible');
    await list.getByRole('option', { name: 'Chờ thử lại', exact: true }).click();
    assert.equal(await page.locator('select[name="status"]').inputValue(), 'retry');
    assert.equal(await input.inputValue(), 'Chờ thử lại');
    assert.equal(await page.locator('form[data-admin-directory-form]').evaluate((form) => new FormData(form).get('status')), 'retry');
    await input.click();
    await page.keyboard.press('Escape');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    await page.locator('.navbar-vertical [data-admin-link="/admin"]').click();
    assert.equal(await page.locator('body > .bf-admin-select-list').count(), 0);
  } finally { await fixture.close(); }
});

test("admin overview at 1672px shows horizontal KPIs, growth beside health, then recent organizations", async () => {
  const fixture = await loadOverview(1672, 942);
  const { page, errors } = fixture;
  try {
    await assertNoPageOverflow(page, "desktop overview");
    const cards = await page.locator(".bf-admin-stat-grid > .bf-admin-stat-card").evaluateAll((nodes) => nodes.map((node) => {
      const card = node.getBoundingClientRect();
      const icon = node.querySelector(".bf-admin-stat-icon").getBoundingClientRect();
      const copy = node.querySelector(".bf-admin-stat-copy").getBoundingClientRect();
      return {
        x: card.x, y: card.y, width: card.width, right: card.right,
        iconRight: icon.right, copyLeft: copy.left,
        iconCenter: icon.y + icon.height / 2, copyCenter: copy.y + copy.height / 2,
      };
    }));
    assert.equal(cards.length, 4);
    for (const [index, card] of cards.entries()) {
      assert.ok(Math.abs(card.y - cards[0].y) <= 1, `KPI ${index} must share the desktop row`);
      assert.ok(card.width >= 220, `KPI ${index} is too narrow: ${card.width}`);
      assert.ok(card.iconRight <= card.copyLeft + 1, `KPI ${index} icon must sit left of its text: ${JSON.stringify(card)}`);
      assert.ok(Math.abs(card.iconCenter - card.copyCenter) <= 5, `KPI ${index} icon/text should align vertically`);
      if (index) assert.ok(card.x >= cards[index - 1].right, `KPI ${index} overlaps its neighbor`);
    }
    const growth = await page.locator(".bf-admin-growth-card").boundingBox();
    const health = await page.locator(".bf-admin-operation-card").boundingBox();
    const recent = await page.locator(".bf-admin-recent-card").boundingBox();
    assert.ok(growth && health && recent);
    assert.ok(Math.abs(growth.y - health.y) <= 1, "growth and health should share the main desktop row");
    assert.ok(growth.x + growth.width <= health.x + 1, "health must be to the right of growth");
    assert.ok(growth.width > health.width, "growth should have the larger portion of the row");
    assert.ok(recent.y >= Math.max(growth.y + growth.height, health.y + health.height), "recent organizations must follow the main row");
    assert.equal(await page.locator(".bf-admin-recent-organizations tbody tr").count(), 5);
    assert.deepEqual(errors, []);
    await capture(page, "1672x942");
  } finally {
    await fixture.close();
  }
});

test("admin overview remains usable at 390px without body or document overflow", async () => {
  const fixture = await loadOverview(390, 844);
  const { page, errors } = fixture;
  try {
    await page.locator('[data-admin-metric="organizations"]').waitFor({ state: "visible" });
    await page.locator(".bf-admin-operation-chip").first().waitFor({ state: "visible" });
    await assertNoPageOverflow(page, "mobile overview");
    const cards = await page.locator(".bf-admin-stat-grid > .bf-admin-stat-card").evaluateAll((nodes) => nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, width: rect.width, height: rect.height };
    }));
    assert.equal(cards.length, 4);
    assert.ok(cards.every((card) => card.left >= 0 && card.right <= 390 + 1), JSON.stringify(cards));
    assert.ok(cards.some((card) => card.top > cards[0].top), "mobile KPI cards should wrap instead of shrinking below a usable width");
    const growth = await page.locator(".bf-admin-growth-card").boundingBox();
    const health = await page.locator(".bf-admin-operation-card").boundingBox();
    assert.ok(growth && health);
    assert.ok(health.y >= growth.y + growth.height - 1, "growth and health should stack on mobile");
    assert.deepEqual(errors, []);
    await capture(page, "390x844");
  } finally {
    await fixture.close();
  }
});

test("mobile navigation toggle opens and closes the sidebar", async () => {
  const fixture = await loadOverview(390, 844);
  const { page } = fixture;
  try {
    const toggle = page.locator("[data-admin-nav-toggle]");
    const navigation = page.locator("#admin-navbar");
    await assertNoPageOverflow(page, "mobile navigation before toggle");
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await navigation.evaluate((node) => node.classList.contains("show")), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.equal(await navigation.evaluate((node) => node.classList.contains("show")), true);
    assert.equal(await page.locator(".navbar-vertical [data-admin-link]").first().isVisible(), true);
    await assertNoPageOverflow(page, "mobile navigation open");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(await navigation.evaluate((node) => node.classList.contains("show")), false);
    await assertNoPageOverflow(page, "mobile navigation closed");
  } finally {
    await fixture.close();
  }
});

test("desktop navigation toggle closes and restores the visible sidebar", async () => {
  const fixture = await loadOverview(1672, 942);
  const { page } = fixture;
  try {
    const toggle = page.locator("[data-admin-nav-toggle]");
    const sidebar = page.locator(".navbar-vertical");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const initial = await sidebar.boundingBox();
    assert.ok(initial && initial.x >= 0 && initial.width > 200);
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await page.waitForFunction(() => document.querySelector(".navbar-vertical").getBoundingClientRect().right <= 1);
    const closed = await sidebar.boundingBox();
    assert.ok(!closed || closed.x + closed.width <= 1, "collapsed desktop sidebar must leave the viewport");
    await assertNoPageOverflow(page, "desktop sidebar collapsed");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await page.waitForFunction(() => document.querySelector(".navbar-vertical").getBoundingClientRect().left >= -0.1);
    const reopened = await sidebar.boundingBox();
    assert.ok(reopened && reopened.x >= 0 && reopened.width > 200);
  } finally {
    await fixture.close();
  }
});

test("growth selector supports keyboard tab navigation and keeps the selected panel accessible", async () => {
  const fixture = await loadOverview(1200, 850);
  const { page } = fixture;
  try {
    const tabs = page.locator("[data-admin-growth-series]");
    assert.equal(await tabs.count(), 3);
    const tabState = await tabs.evaluateAll((nodes) => nodes.map((node) => ({
      key: node.dataset.adminGrowthSeries,
      id: node.id,
      role: node.getAttribute("role"),
      selected: node.getAttribute("aria-selected"),
      tabIndex: node.tabIndex,
      controls: node.getAttribute("aria-controls"),
    })));
    assert.ok(tabState.every((item) => item.role === "tab" && item.controls), JSON.stringify(tabState));
    assert.equal(tabState.filter((item) => item.tabIndex === 0).length, 1);
    const initial = tabState.find((item) => item.tabIndex === 0);
    assert.equal(tabState.filter((item) => item.selected === "true").length, 1);
    assert.equal(initial.selected, "true");
    const panel = page.locator("[data-admin-growth-chart]");
    assert.equal(await panel.getAttribute("role"), "tabpanel");
    assert.equal(await panel.getAttribute("aria-labelledby"), initial.id);
    assert.equal(await panel.getAttribute("id"), initial.controls);
    const initialIndex = tabState.findIndex((item) => item.key === initial.key);
    await tabs.nth(initialIndex).focus();
    await page.keyboard.press("ArrowRight");
    const afterRight = await tabs.evaluateAll((nodes) => nodes.map((node) => ({ key: node.dataset.adminGrowthSeries, selected: node.getAttribute("aria-selected"), tabIndex: node.tabIndex })));
    assert.equal(afterRight.filter((item) => item.selected === "true").length, 1);
    assert.equal(afterRight.filter((item) => item.tabIndex === 0).length, 1);
    const movedIndex = (initialIndex + 1) % afterRight.length;
    assert.equal(afterRight[movedIndex].selected, "true");
    assert.equal(await tabs.nth(movedIndex).evaluate((node) => document.activeElement === node), true);
    assert.equal(await panel.getAttribute("aria-labelledby"), `admin-growth-tab-${afterRight[movedIndex].key}`);
    const chartLabel = await page.locator("[data-admin-growth-chart] svg").getAttribute("aria-label");
    assert.match(chartLabel || "", /theo ngày trong 30 ngày gần nhất/u);
    await page.keyboard.press("Home");
    assert.equal(await tabs.evaluateAll((nodes) => nodes.find((node) => node.tabIndex === 0)?.dataset.adminGrowthSeries), "newUsers");
    await page.keyboard.press("End");
    assert.equal(await tabs.evaluateAll((nodes) => nodes.find((node) => node.tabIndex === 0)?.dataset.adminGrowthSeries), "subscriptions");
  } finally {
    await fixture.close();
  }
});

test("every sidebar route is addressable without leaving the admin shell", async () => {
  const fixture = await loadOverview(1200, 850);
  const { page } = fixture;
  try {
    const links = await page.locator(".navbar-vertical [data-admin-link]").evaluateAll((nodes) => nodes.map((node) => ({
      href: node.getAttribute("href"), path: node.dataset.adminLink,
    })));
    assert.equal(links.length, ADMIN_ROUTES.length);
    assert.deepEqual(new Set(links.map((link) => link.path)), new Set(ADMIN_ROUTES.map(([path]) => path)));
    for (const [path, title] of ADMIN_ROUTES) {
      const link = page.locator(`.navbar-vertical [data-admin-link="${path}"]`);
      assert.equal(await link.count(), 1, `missing sidebar route ${path}`);
      assert.equal(await link.getAttribute("href"), path);
      await link.click();
      await page.waitForFunction((expected) => window.location.pathname === expected, path);
      assert.equal(await page.locator(`.navbar-vertical [data-admin-link="${path}"]`).getAttribute("aria-current"), "page");
      assert.equal(await page.title(), `${title} | BiddingFlow Admin`);
      assert.equal((await page.locator(".bf-admin-header-crumb").textContent()).trim(), title);
      assert.match(await page.locator("#admin-main").getAttribute("tabindex"), /-1/u);
    }
  } finally {
    await fixture.close();
  }
});

test("overview shell and KPIs render before a slow health snapshot completes", async () => {
  const fixture = await loadOverview(1200, 850, { deferHealth: true });
  const { page, healthRequested } = fixture;
  try {
    await healthRequested;
    await page.locator('[data-admin-metric="organizations"]').waitFor({ state: "visible" });
    assert.equal(await page.locator("#admin-overview-title").isVisible(), true);
    const healthSummary = page.locator("[data-admin-health-summary]");
    assert.equal(await healthSummary.count(), 1);
    assert.equal(await healthSummary.getAttribute("aria-busy"), "true");
    assert.equal(fixture.caseState.healthSent, false, "health response is still deliberately held");
    assert.equal(await healthSummary.locator(".bf-admin-operation-chip").count(), 0);
    fixture.caseState.releaseHealth();
    await page.locator(".bf-admin-operation-chip").first().waitFor({ state: "visible" });
    assert.equal(await healthSummary.getAttribute("aria-busy"), "false");
  } finally {
    await fixture.close();
  }
});

test("a rejected health snapshot settles locally without removing the overview", async () => {
  const fixture = await loadOverview(1200, 850, { deferHealth: true, healthStatus: 500 });
  const { page, healthRequested, errors } = fixture;
  try {
    await healthRequested;
    await page.locator('[data-admin-metric="organizations"]').waitFor({ state: "visible" });
    const healthSummary = page.locator("[data-admin-health-summary]");
    assert.equal(await healthSummary.getAttribute("aria-busy"), "true");
    fixture.caseState.releaseHealth();
    await page.waitForFunction(() => document.querySelector("[data-admin-health-summary]")?.getAttribute("aria-busy") === "false");
    assert.equal(await page.locator("#admin-overview-title").isVisible(), true);
    assert.equal(await page.locator('[data-admin-metric="organizations"]').textContent(), "128");
    assert.equal(await healthSummary.locator(".bf-admin-operation-chip.is-success").count(), 0);
    assert.equal(await healthSummary.locator(".spinner-border").count(), 0);
    assert.match(await healthSummary.textContent(), /Không thể|Chưa có|Chưa xác định|thành công/u);
    assert.deepEqual(errors, []);
  } finally {
    await fixture.close();
  }
});

test("leaving the overview cancels a slow health read and never overwrites the destination route", async () => {
  const fixture = await loadOverview(1200, 850, { deferHealth: true });
  const { page, healthRequested, errors } = fixture;
  try {
    await healthRequested;
    await page.locator('[data-admin-metric="organizations"]').waitFor({ state: "visible" });
    const cancelledHealth = page.waitForEvent("requestfailed", (request) => new URL(request.url()).pathname === "/api/admin/health");
    await page.locator('.navbar-vertical [data-admin-link="/admin/organizations"]').click();
    await cancelledHealth;
    fixture.caseState.releaseHealth();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    assert.equal(new URL(page.url()).pathname, "/admin/organizations");
    assert.equal(await page.title(), "Tổ chức | BiddingFlow Admin");
    assert.equal((await page.locator(".bf-admin-header-crumb").textContent()).trim(), "Tổ chức");
    assert.equal(await page.locator("#admin-overview-title").count(), 0);
    assert.equal(await page.locator("[data-admin-health-summary]").count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await fixture.close();
  }
});
