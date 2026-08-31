import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import {
  buildUsageAnalyticsUrl,
  normalizeUsageAnalyticsSummary,
} from "../../frontend/admin/UsageAnalyticsView.js";
import {
  createUsageAnalyticsTracker,
  featureCodeForTab,
  USAGE_HEARTBEAT_INTERVAL_MS,
} from "../../frontend/app/UsageAnalyticsTracker.js";
import { BiddingController } from "../../frontend/app/BiddingController.js";

const settle = () => new Promise((resolve) => setImmediate(resolve));
const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if (extname(pathname) === ".js" || extname(pathname) === ".mjs") return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}

test("usage analytics summary adapter accepts canonical and snake-case payloads", () => {
  const canonical = normalizeUsageAnalyticsSummary({
    generatedAt: "2026-08-30T10:00:00Z",
    range: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    onlineNow: 12,
    peakConcurrency: { count: 18, start: "2026-08-28T01:00:00Z", end: "2026-08-28T02:00:00Z" },
    topFeatures: [{ feature: "packages", label: "Gói thầu", count: 91, uniqueUsers: 14 }],
    averages: { jobsPerActiveUser: 2.5, wordExportsPerActiveUser: 1.25 },
    workActivityCount: 35,
    wordExportCount: 18,
    featureUseCount: 104,
    activeUsers: 14,
    eventCount: 157,
    concurrencySeries: [{ timestamp: "2026-08-28T01:00:00Z", count: 18 }],
    coverage: { hasData: true, startedAt: "2026-08-01T00:00:00Z", partial: true },
  });
  assert.equal(canonical.onlineNow, 12);
  assert.equal(canonical.range.bucket, "day");
  assert.equal(canonical.topFeatures[0].uniqueUsers, 14);
  assert.equal(canonical.workActivityCount, 35);
  assert.equal(canonical.wordExportCount, 18);
  assert.equal(canonical.featureUseCount, 104);
  assert.deepEqual(canonical.coverage, {
    hasData: true,
    startedAt: "2026-08-01T00:00:00Z",
    partial: true,
  });

  const snakeCase = normalizeUsageAnalyticsSummary({ data: {
    generated_at: "2026-08-30T10:00:00Z",
    date_range: { start: "2026-08-01", end: "2026-08-30", bucket: "hour" },
    online_now: "7",
    peak_concurrency: { value: "9", start_at: "2026-08-29T01:00:00Z" },
    top_features: { contracts: 24 },
    average: { jobs_per_active_user: "3.5", word_exports_per_active_user: "0.5" },
    work_activity_count: "21",
    word_export_count: "3",
    feature_use_count: "24",
    active_users: "6",
    event_count: "48",
    concurrency_series: { "2026-08-29T01:00:00Z": 9 },
    coverage: { has_data: "false", started_at: null, partial: false },
  } });
  assert.equal(snakeCase.onlineNow, 7);
  assert.equal(snakeCase.topFeatures[0].label, "Hợp đồng");
  assert.equal(snakeCase.concurrencySeries[0].count, 9);
  assert.equal(snakeCase.averages.jobsPerActiveUser, 3.5);
  assert.deepEqual(snakeCase.coverage, {
    hasData: false,
    startedAt: null,
    partial: false,
  });
});

test("usage analytics URL validates dates and supports only stable buckets", () => {
  assert.equal(
    buildUsageAnalyticsUrl({ from: "2026-08-01", to: "2026-08-30", bucket: "day" }),
    "/api/admin/usage-analytics/summary?from=2026-08-01&to=2026-08-30&bucket=day",
  );
  assert.match(buildUsageAnalyticsUrl({ from: "2026-08-01", to: "2026-08-07", bucket: "minute" }), /bucket=hour$/u);
  assert.throws(() => buildUsageAnalyticsUrl({ from: "2026-08-31", to: "2026-08-01" }), /Ngày bắt đầu/u);
  assert.throws(() => buildUsageAnalyticsUrl({ from: "not-a-date", to: "2026-08-01" }), /không hợp lệ/u);
});

test("usage tracker sends only allowlisted feature codes and exact event bodies", async () => {
  const documentRef = new EventTarget();
  Object.defineProperty(documentRef, "visibilityState", { value: "visible", writable: true });
  const requests = [];
  let intervalCallback = null;
  let intervalMs = 0;
  const tracker = createUsageAnalyticsTracker({
    documentRef,
    now: () => 10_000,
    setIntervalImpl(callback, milliseconds) {
      intervalCallback = callback;
      intervalMs = milliseconds;
      return 1;
    },
    clearIntervalImpl() {},
    send: async (body) => {
      requests.push(body);
      return { ok: true, status: 202 };
    },
  });

  tracker.start({ initialTab: "goithau-detail" });
  await settle();
  assert.equal(intervalMs, USAGE_HEARTBEAT_INTERVAL_MS);
  assert.deepEqual(requests, [
    { eventType: "heartbeat" },
    { eventType: "feature_used", feature: "packages" },
  ]);

  assert.equal(tracker.trackFeature("goithau"), false, "same normalized feature is deduplicated");
  assert.equal(tracker.trackFeature("unknown-route/record-123?secret=yes"), false);
  assert.equal(tracker.trackFeature("hopdong"), true);
  intervalCallback();
  await settle();
  assert.deepEqual(requests.slice(2), [
    { eventType: "feature_used", feature: "contracts" },
    { eventType: "heartbeat" },
  ]);
  assert.equal(featureCodeForTab("xuatban-word"), "word-publication");
  assert.equal(featureCodeForTab("goithau/record-1"), "");
});

test("usage tracker pauses while hidden, deduplicates resume, and stops on auth failure", async () => {
  const documentRef = new EventTarget();
  Object.defineProperty(documentRef, "visibilityState", { value: "hidden", writable: true });
  const requests = [];
  let currentTime = 1_000;
  const tracker = createUsageAnalyticsTracker({
    documentRef,
    now: () => currentTime,
    setIntervalImpl: () => 1,
    clearIntervalImpl() {},
    send: async (body) => {
      requests.push(body);
      return body.eventType === "heartbeat"
        ? { ok: false, status: 403 }
        : { ok: true, status: 202 };
    },
  });

  tracker.start();
  assert.deepEqual(requests, []);
  documentRef.visibilityState = "visible";
  documentRef.dispatchEvent(new Event("visibilitychange"));
  documentRef.dispatchEvent(new Event("visibilitychange"));
  await settle();
  assert.deepEqual(requests, [{ eventType: "heartbeat" }]);
  assert.equal(tracker.isStopped(), true);
  currentTime += 60_000;
  assert.equal(tracker.heartbeat({ force: true }), false);
});

test("Super Admin usage analytics route is lazy, guarded, and discoverable", async () => {
  const controller = new BiddingController({}, {});
  assert.equal(controller.routeMap["usage-analytics"], "phan-tich-su-dung");
  assert.equal(controller.lazyTabPartials["usage-analytics"], "/tabs/tab_usage_analytics.html");
  assert.deepEqual(controller.getStartupPriorityKeys("/phan-tich-su-dung"), []);

  const [sidebar, routeShell, controllerUi, template] = await Promise.all([
    readFile("views/components/sidebar.html", "utf8"),
    readFile("views/vendor/initial-route.js", "utf8"),
    readFile("frontend/app/BiddingControllerUI.js", "utf8"),
    readFile("views/tabs/tab_usage_analytics.html", "utf8"),
  ]);
  assert.match(sidebar, /role-menu-superadmin[\s\S]*?data-tab="usage-analytics"/u);
  assert.match(routeShell, /"phan-tich-su-dung": \["usage-analytics"/u);
  assert.match(controllerUi, /\["superadmin-dashboard", "superadmin", "usage-analytics", "commercial-admin"\]/u);
  assert.match(template, /id="usage-online-now"/u);
  assert.match(template, /id="usage-feature-list"/u);
  assert.match(template, /Asia\/Ho_Chi_Minh/u);
  assert.match(template, /data-analytics-section="usage"/u);
  assert.match(template, /data-analytics-section="commercial"/u);
  assert.match(template, /data-analytics-panel="commercial"[^>]*hidden/u);
});

test("usage analytics view loads the 30-day daily summary and renders responsive evidence", async () => {
  const template = await readFile(join(root, "views/tabs/tab_usage_analytics.html"), "utf8");
  let requestedQuery = "";
  let activeOrganizationHeader = "";
  let usageAnalyticsRequests = 0;
  let productAnalyticsRequests = 0;
  const summary = {
    generatedAt: "2026-08-30T10:00:00Z",
    range: { from: "2026-08-01", to: "2026-08-30", bucket: "day" },
    onlineNow: 12,
    peakConcurrency: { count: 18, start: "2026-08-28T00:00:00Z", end: "2026-08-29T00:00:00Z" },
    topFeatures: [
      { feature: "packages", label: "Gói thầu", count: 91, uniqueUsers: 14 },
      { feature: "contracts", label: "Hợp đồng", count: 42, uniqueUsers: 9 },
    ],
    averages: { jobsPerActiveUser: 2.5, wordExportsPerActiveUser: 1.25 },
    workActivityCount: 35,
    wordExportCount: 18,
    featureUseCount: 133,
    activeUsers: 14,
    eventCount: 186,
    coverage: { hasData: true, startedAt: "2026-08-01T00:00:00Z", partial: true },
    concurrencySeries: Array.from({ length: 30 }, (_, index) => ({
      timestamp: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      count: index === 27 ? 18 : index % 8,
    })),
  };
  const emptySummary = {
    generatedAt: "2026-08-30T10:00:00Z",
    range: { from: "2026-07-01", to: "2026-07-31", bucket: "day" },
    onlineNow: 3,
    activeUsers: 0,
    eventCount: 0,
    coverage: { hasData: false, startedAt: null, partial: false },
  };

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><head><title>Phân tích sử dụng</title><link rel="stylesheet" data-runtime-styles href="/runtime.css"></head><body><main>${template}</main></body></html>`);
        return;
      }
      if (url.pathname === "/runtime.css") {
        response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
        response.end(":root{--bg-card:#fff;--bg-app:#f8fafc;--border-color:#dbe3ee;--text-main:#172033;--text-muted:#5f6b7a;--text-light:#788596;--primary:#2563eb;--primary-soft:#eff6ff;--danger:#dc2626;--danger-soft:#fef2f2;--focus-ring:#2563eb;--shadow-sm:0 1px 2px rgba(15,23,42,.06)}body{margin:16px;background:var(--bg-app);font-family:Arial,sans-serif}.form-control{box-sizing:border-box;padding:8px;border:1px solid var(--border-color);border-radius:8px}.btn{min-height:38px;padding:8px 12px;border:1px solid var(--border-color);border-radius:8px;background:#fff}.btn-primary{background:var(--primary);color:#fff}");
        return;
      }
      if (url.pathname === "/api/admin/usage-analytics/summary") {
        usageAnalyticsRequests += 1;
        requestedQuery = url.search;
        activeOrganizationHeader = String(request.headers["x-active-org"] || "");
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(url.searchParams.get("from") === "2026-07-01" ? emptySummary : summary));
        return;
      }
      if (url.pathname === "/api/admin/product-analytics/dashboard") {
        productAnalyticsRequests += 1;
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ dashboard: { hasData: false } }));
        return;
      }
      const payload = await readFile(join(root, url.pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404);
      response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      sessionStorage.setItem("bf_active_org", "organization-analytics");
      const module = await import("/frontend/admin/UsageAnalyticsView.js");
      await module.mountUsageAnalytics({ view: { createIconsScoped() {} } });
    });

    assert.equal(activeOrganizationHeader, "organization-analytics");
    assert.match(requestedQuery, /bucket=day/u);
    assert.equal(await page.locator("#usage-online-now").textContent(), "12");
    assert.equal(await page.locator("#usage-jobs-basis").textContent(), "35 hoạt động / 14 người");
    assert.equal(await page.locator("#usage-word-basis").textContent(), "18 lượt / 14 người");
    assert.equal(await page.locator("#usage-peak-unit").textContent(), "ngày cao điểm");
    assert.equal(await page.getByText("Gói thầu", { exact: true }).count(), 1);
    assert.ok(await page.locator(".usage-chart__bar[tabindex='0']").count() <= 10);
    assert.equal(await page.locator("#usage-analytics-content").getAttribute("hidden"), null);
    assert.match(await page.locator("#usage-analytics-coverage-text").textContent(), /Dữ liệu được ghi nhận từ/u);
    assert.equal(await page.locator("#usage-analytics-coverage").getAttribute("hidden"), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(productAnalyticsRequests, 0, "commercial analytics must stay lazy until selected");
    assert.equal(await page.locator("[data-analytics-panel='usage']").isVisible(), true);
    assert.equal(await page.locator("[data-analytics-panel='commercial']").isVisible(), false);

    const productAnalyticsResponse = page.waitForResponse((candidate) => (
      new URL(candidate.url()).pathname === "/api/admin/product-analytics/dashboard"
    ));
    await page.locator("[data-analytics-section='usage']").press("ArrowRight");
    await productAnalyticsResponse;
    await page.waitForFunction(() => document.querySelector("#product-analytics-workspace")?.dataset.productAnalyticsBound === "true");
    assert.equal(productAnalyticsRequests, 1);
    assert.equal(await page.locator("[data-analytics-panel='usage']").isVisible(), false);
    assert.equal(await page.locator("[data-analytics-panel='commercial']").isVisible(), true);
    assert.equal(await page.locator("[data-analytics-section='commercial']").getAttribute("aria-selected"), "true");
    await page.locator("[data-analytics-section='usage']").click();

    await page.locator("#usage-analytics-from").fill("2026-07-01");
    await page.locator("#usage-analytics-to").fill("2026-07-31");
    await page.locator("#usage-analytics-filter-form").press("Enter");
    await page.locator("#usage-analytics-empty").waitFor({ state: "visible" });
    assert.equal(await page.locator("#usage-empty-online-now").textContent(), "3");
    assert.equal(await page.locator("#usage-analytics-content").isVisible(), false);
    assert.equal(await page.locator("#usage-analytics-empty").isVisible(), true);
    assert.notEqual(await page.locator("#usage-analytics-coverage").getAttribute("hidden"), null);
    assert.equal(await page.locator("#usage-concurrency-chart").isVisible(), false);

    const requestsBeforeDeniedMount = usageAnalyticsRequests;
    const employeePage = await browser.newPage();
    await employeePage.goto(`http://127.0.0.1:${server.address().port}/`);
    const employeeMounted = await employeePage.evaluate(async () => {
      const module = await import("/frontend/admin/UsageAnalyticsView.js");
      return module.mountUsageAnalytics({
        model: { state: { activerole: "employee" } },
        view: { createIconsScoped() {} },
      });
    });
    assert.equal(employeeMounted, false);
    assert.equal(await employeePage.locator("#tab-usage-analytics").isVisible(), false);
    assert.equal(usageAnalyticsRequests, requestsBeforeDeniedMount);
    await employeePage.close();
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("usage analytics pane becomes hidden after navigating to another outer tab", async () => {
  const [tabCss, analyticsCss] = await Promise.all([
    readFile(join(root, "views/css/components.css"), "utf8"),
    readFile(join(root, "frontend/admin/UsageAnalyticsView.css"), "utf8"),
  ]);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section id="tab-usage-analytics" class="tab-pane usage-analytics active"></section>
        <section id="tab-superadmin" class="tab-pane"></section>
      </main>
    `);
    await page.addStyleTag({ content: tabCss });
    await page.addStyleTag({ content: analyticsCss });

    const result = await page.evaluate(() => {
      const analyticsPane = document.getElementById("tab-usage-analytics");
      const targetPane = document.getElementById("tab-superadmin");
      analyticsPane.classList.remove("active");
      targetPane.classList.add("active");
      return {
        analyticsActive: analyticsPane.classList.contains("active"),
        analyticsDisplay: getComputedStyle(analyticsPane).display,
        targetActive: targetPane.classList.contains("active"),
        targetDisplay: getComputedStyle(targetPane).display,
      };
    });

    assert.deepEqual(result, {
      analyticsActive: false,
      analyticsDisplay: "none",
      targetActive: true,
      targetDisplay: "block",
    });
  } finally {
    await browser?.close();
  }
});
