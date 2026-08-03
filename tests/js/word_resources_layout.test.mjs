import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const viewsStylesheet = fileURLToPath(new URL("../../views/css/views.css", import.meta.url));

test("Word dictionary and templates use one full-width column on desktop", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
    await page.setContent(`
      <section id="tab-bieumau">
        <div class="word-resource-grid" style="width:1200px">
          <article class="dashboard-card">Từ điển dữ liệu</article>
          <article class="dashboard-card">Danh sách biểu mẫu hệ thống</article>
        </div>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const cards = page.locator(".word-resource-grid > .dashboard-card");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();

    assert.ok(Math.abs(first.width - second.width) <= 1);
    assert.ok(second.y >= first.y + first.height);
  } finally {
    await browser.close();
  }
});

test("Word resource cards stack on narrow screens", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
    await page.setContent(`
      <section id="tab-bieumau">
        <div class="word-resource-grid" style="width:700px">
          <article class="dashboard-card">Từ điển dữ liệu</article>
          <article class="dashboard-card">Danh sách biểu mẫu hệ thống</article>
        </div>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const cards = page.locator(".word-resource-grid > .dashboard-card");
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();

    assert.ok(second.y > first.y + first.height);
  } finally {
    await browser.close();
  }
});
