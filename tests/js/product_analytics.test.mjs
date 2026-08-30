import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

import { buildProductAnalyticsUrl } from "../../frontend/admin/ProductAnalyticsView.js";

const root = fileURLToPath(new URL("../..", import.meta.url));

function contentType(pathname) {
  if ([".js", ".mjs"].includes(extname(pathname))) return "text/javascript; charset=utf-8";
  if (extname(pathname) === ".css") return "text/css; charset=utf-8";
  return "application/octet-stream";
}


test("product analytics URL keeps only defined shareable aggregate filters", () => {
  const url = buildProductAnalyticsUrl({
    from: "2026-08-01",
    to: "2026-08-30",
    view: "plan-fit",
    ownerKind: "organization",
    variant: "connected",
    releaseId: "release-2026",
    releaseMode: "live",
    sizeBucket: "6_15",
    plan: "gold",
    paidState: "paid",
    ignored: "must-not-leak",
  });
  const parsed = new URL(url, "http://localhost");
  assert.equal(parsed.pathname, "/api/admin/product-analytics/dashboard");
  assert.equal(parsed.searchParams.get("view"), "plan-fit");
  assert.equal(parsed.searchParams.get("releaseId"), "release-2026");
  assert.equal(parsed.searchParams.get("releaseMode"), "live");
  assert.equal(parsed.searchParams.get("ignored"), null);
});


test("product analytics shell exposes all decision views and accessible states", async () => {
  const template = await readFile("views/tabs/tab_usage_analytics.html", "utf8");
  for (const view of ["overview", "activation", "features", "seats", "procurement",
    "credits", "funnel", "retention", "economics", "plan-fit"]) {
    assert.match(template, new RegExp(`data-product-view="${view}"`, "u"));
  }
  assert.match(template, /id="product-analytics-loading" role="status"/u);
  assert.match(template, /id="product-analytics-error" role="alert"/u);
  assert.match(template, /id="product-analytics-empty" role="status"/u);
  assert.match(template, /id="product-analytics-trend-table-body"/u);
  assert.match(template, /id="product-analytics-pagination"/u);
  assert.match(template, /data-product-range="365"/u);
});


test("Super Admin product analytics flow filters, navigates, handles empty and denies direct API", async () => {
  const template = await readFile(join(root, "views/tabs/tab_usage_analytics.html"), "utf8");
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(`<!doctype html><html lang="vi"><body>${template}</body></html>`);
        return;
      }
      if (url.pathname === "/api/admin/product-analytics/dashboard") {
        requests.push(Object.fromEntries(url.searchParams));
        if (url.searchParams.get("releaseId") === "deny") {
          response.writeHead(403, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "SUPER_ADMIN_REQUIRED" }));
          return;
        }
        if (url.searchParams.get("releaseId") === "empty") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ dashboard: { hasData: false, message: "Chưa đủ dữ liệu trong khoảng thời gian này." } }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ dashboard: {
          hasData: true,
          view: url.searchParams.get("view") || "overview",
          updatedAt: "2026-08-30T10:00:00Z",
          kpis: [{ key: "monthlyActiveWorkspaces", label: "MAW", value: 24, change: 0.2, changeState: "positive" }],
          series: [{ key: "meaningfulActions", points: [{ date: "2026-08-30", value: 42 }] }],
          segments: [
            { segment: url.searchParams.get("view"), workspaceCount: 24, eventCount: 42 },
            { segment: "small cohort", workspaceCount: null, suppressed: true, status: "insufficient_sample" },
          ],
          funnel: [{ stage: "payment.verified", count: 8 }],
          economics: { netSettledRevenueVnd: 1000000 },
          ai: { activeWorkspaces: 11, requests: 22 },
          mix: [{ variant: "connected", workspaceCount: 24 }],
          planDistribution: [{ plan: "gold", workspaceCount: 24 }],
          insights: [{ message: "Connected usage is present.", basis: "workspace mix" }],
          overviewCharts: [{ key: "variant_mix", label: "Internal vs Connected mix", series: [
            { key: "variant", label: "Workspaces", points: [{ label: "connected", value: 24 }] },
          ] }],
        } }));
        return;
      }
      const payload = await readFile(join(root, url.pathname.replace(/^\//u, "")));
      response.writeHead(200, { "content-type": contentType(url.pathname) });
      response.end(payload);
    } catch {
      response.writeHead(404); response.end("Not Found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(async () => {
      const module = await import("/frontend/admin/ProductAnalyticsView.js");
      module.mountProductAnalytics(document.querySelector("#product-analytics-workspace"));
    });
    await page.locator("#product-analytics-content").waitFor({ state: "visible" });
    assert.equal(await page.getByText("MAW", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Internal vs Connected mix", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Connected usage is present.", { exact: true }).count(), 1);
    assert.ok(await page.getByText("Insufficient sample", { exact: true }).count() >= 1);
    assert.equal(await page.getByText("20.0% so với kỳ trước", { exact: true }).count(), 1);
    assert.equal(await page.locator(".product-analytics__mini-bar[tabindex='0']").count(), 1);
    const accessibility = await new AxeBuilder({ page })
      .include("#product-analytics-workspace")
      .disableRules(["color-contrast"])
      .analyze();
    assert.deepEqual(accessibility.violations, []);
    for (const view of ["seats", "procurement", "retention", "plan-fit"]) {
      await page.locator(`[data-product-view="${view}"]`).click();
      await page.waitForFunction((expected) => new URLSearchParams(location.search).get("analytics_view") === expected, view);
    }
    await page.locator("#product-analytics-from").fill("2026-08-01");
    await page.locator("#product-analytics-to").fill("2026-08-30");
    await page.locator("#product-analytics-release").fill("release-1");
    const filteredResponse = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return url.pathname === "/api/admin/product-analytics/dashboard"
        && url.searchParams.get("releaseId") === "release-1";
    });
    await page.locator("#product-analytics-filter-form").press("Enter");
    await filteredResponse;
    await page.waitForFunction(() => new URLSearchParams(location.search).get("analytics_releaseId") === "release-1");
    assert.equal(requests.at(-1).releaseId, "release-1");

    await page.locator("#product-analytics-release").fill("empty");
    await page.locator("#product-analytics-filter-form").press("Enter");
    await page.locator("#product-analytics-empty").waitFor({ state: "visible" });
    await page.locator("#product-analytics-release").fill("deny");
    await page.locator("#product-analytics-filter-form").press("Enter");
    await page.locator("#product-analytics-error").waitFor({ state: "visible" });
    assert.match(await page.locator("#product-analytics-error-message").textContent(), /SUPER_ADMIN_REQUIRED/u);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
