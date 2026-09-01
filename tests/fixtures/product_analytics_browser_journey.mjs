import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const [baseUrl, releaseId] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "analytics_role", value: "super_admin", url: baseUrl }]);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`);
  await page.evaluate(async () => {
    const module = await import("/frontend/admin/ProductAnalyticsView.js");
    module.mountProductAnalytics(document.querySelector("#product-analytics-workspace"));
  });
  await page.locator("#product-analytics-content").waitFor({ state: "visible" });
  for (const view of ["seats", "procurement", "retention", "plan-fit"]) {
    await page.locator(`[data-product-view="${view}"]`).click();
    await page.waitForFunction(
      (expected) => new URLSearchParams(location.search).get("analytics_view") === expected,
      view,
    );
  }
  await page.locator("#product-analytics-from").fill("2026-08-30");
  await page.locator("#product-analytics-to").fill("2026-08-30");
  await page.locator("#product-analytics-release").fill(releaseId);
  await page.locator("#product-analytics-filter-form").press("Enter");
  await page.locator("#product-analytics-content").waitFor({ state: "visible" });

  await context.clearCookies();
  const denied = await page.request.get(`${baseUrl}/api/admin/product-analytics/dashboard`, {
    params: { from: "2026-08-30", to: "2026-08-30" },
  });
  assert.equal(denied.status(), 403);
  assert.equal((await denied.json()).code, "SUPER_ADMIN_REQUIRED");

  await context.addCookies([{ name: "analytics_role", value: "super_admin", url: baseUrl }]);
  await page.locator("#product-analytics-release").fill("missing-release");
  await page.locator("#product-analytics-filter-form").press("Enter");
  await page.locator("#product-analytics-empty").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
} finally {
  await browser.close();
}
