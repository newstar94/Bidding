import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const [baseUrl] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addCookies([{ name: "analytics_role", value: "super_admin", url: baseUrl }]);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`);
  await page.evaluate(async () => {
    const module = await import("/frontend/admin-platform/AdminAnalytics.js");
    module.renderAdminAnalytics(document.querySelector("#admin-analytics"));
  });
  await page.getByText("Đang trực tuyến").waitFor({ state: "visible" });
  await page.locator("#admin-analytics-from").fill("2026-08-30");
  await page.locator("#admin-analytics-to").fill("2026-08-30");
  await page.locator("[data-admin-analytics-form]").press("Enter");
  await page.getByRole("cell", { name: "Kế hoạch", exact: true }).waitFor({ state: "visible" });

  await context.clearCookies();
  const denied = await page.request.get(`${baseUrl}/api/admin/product-analytics/dashboard`, {
    params: { from: "2026-08-30", to: "2026-08-30" },
  });
  assert.equal(denied.status(), 403);
  assert.equal((await denied.json()).code, "SUPER_ADMIN_REQUIRED");

  await context.addCookies([{ name: "analytics_role", value: "super_admin", url: baseUrl }]);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
} finally {
  await browser.close();
}
