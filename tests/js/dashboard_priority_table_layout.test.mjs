import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const componentStylesheet = fileURLToPath(
  new URL("../../views/css/components.css", import.meta.url),
);
const redesignStylesheet = fileURLToPath(
  new URL("../../views/css/ui-redesign.css", import.meta.url),
);
const dashboardStylesheet = fileURLToPath(
  new URL("../../frontend/app/DashboardView.css", import.meta.url),
);

test("priority table sticky header covers the top edge of its scrollport", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const rows = Array.from({ length: 7 }, (_, index) => `
      <tr class="dashboard-task-row">
        <td><a class="dashboard-package-cell"><span class="dashboard-object-code">E2E-${index}</span><small>Gói hàng hóa ${index}</small></a></td>
        <td><span class="dashboard-action-label">Chậm báo cáo đánh giá</span><small class="dashboard-action-detail">Quá 7 ngày sau mở thầu</small></td>
        <td><span class="dashboard-deadline">10:00 24/08/2026</span></td>
      </tr>
    `).join("");
    await page.setContent(`
      <section class="dashboard-operations">
        <div class="dashboard-work-grid">
          <section class="dashboard-card dashboard-priority-card">
            <div class="card-header">Việc cần điều phối</div>
            <div class="card-body overflow-x dashboard-table-body">
              <table class="data-table dashboard-action-table" data-density="comfortable">
                <thead><tr><th>Đối tượng</th><th>Nội dung cần xử lý</th><th>Hạn/mốc</th></tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </section>
          <section></section>
        </div>
      </section>
    `);
    await page.addStyleTag({ path: componentStylesheet });
    await page.addStyleTag({ path: redesignStylesheet });
    await page.addStyleTag({ path: dashboardStylesheet });

    const layout = await page.locator(".dashboard-table-body").evaluate((scrollport) => {
      scrollport.scrollTop = 60;
      const header = scrollport.querySelector("thead th");
      const scrollportRect = scrollport.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      return {
        gap: headerRect.top - scrollportRect.top,
        paddingBlockStart: getComputedStyle(scrollport).paddingBlockStart,
      };
    });

    assert.equal(layout.paddingBlockStart, "0px");
    assert.ok(Math.abs(layout.gap) <= 0.5, `sticky header left a ${layout.gap}px exposed gap`);
  } finally {
    await browser.close();
  }
});
