import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const dashboardStylesheet = fileURLToPath(
  new URL("../../frontend/app/DashboardView.css", import.meta.url),
);

test("contract counts and values keep aligned columns", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
    await page.setContent(`
      <div class="dashboard-contract-breakdown" style="width:720px">
        <div class="dashboard-contract-row">
          <span class="dashboard-contract-status">Chưa hiệu lực</span>
          <span class="dashboard-contract-values"><strong>0 HĐ</strong><em>0 ₫</em></span>
        </div>
        <div class="dashboard-contract-row">
          <span class="dashboard-contract-status">Đang thực hiện</span>
          <span class="dashboard-contract-values"><strong>1 HĐ</strong><em>12 Tr ₫</em></span>
        </div>
        <div class="dashboard-contract-row">
          <span class="dashboard-contract-status">Đã hoàn thành</span>
          <span class="dashboard-contract-values"><strong>12 HĐ</strong><em>1,2 T ₫</em></span>
        </div>
      </div>
    `);
    await page.addStyleTag({ path: dashboardStylesheet });

    const countBoxes = await page.locator(".dashboard-contract-values strong").evaluateAll(
      (elements) => elements.map((element) => element.getBoundingClientRect().right),
    );
    const valueBoxes = await page.locator(".dashboard-contract-values em").evaluateAll(
      (elements) => elements.map((element) => element.getBoundingClientRect().right),
    );

    assert.ok(countBoxes.every((right) => Math.abs(right - countBoxes[0]) <= 0.5));
    assert.ok(valueBoxes.every((right) => Math.abs(right - valueBoxes[0]) <= 0.5));
  } finally {
    await browser.close();
  }
});
