import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const viewsStylesheet = fileURLToPath(new URL("../../views/css/views.css", import.meta.url));
const wordTemplatesView = fileURLToPath(new URL("../../views/tabs/tab_bieumau.html", import.meta.url));

test("Word template manager uses an add button without seeded default rows", async () => {
  const html = await readFile(wordTemplatesView, "utf8");

  assert.match(html, /id="word-template-add-button"/);
  assert.match(html, /<th>File mẫu<\/th>/);
  assert.doesNotMatch(html, /id="word-drag-drop-zone"/);
  assert.doesNotMatch(html, /id="word-template-replace-input"/);
  assert.doesNotMatch(html, /Bản báo cáo đánh giá mặc định/);
  assert.doesNotMatch(html, /Mẫu hợp đồng kinh tế LCNT/);
});

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

test("Word template action column shrinks to its controls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 500 } });
    await page.setContent(`
      <section id="tab-bieumau">
        <table class="data-table" id="word-templates-table" style="width:1200px">
          <thead><tr><th>Tên biểu mẫu</th><th>File mẫu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody><tr>
            <td>Biểu mẫu báo cáo</td><td>bao-cao.docx</td><td>Đang hoạt động</td>
            <td><div class="word-template-actions"><button class="btn">Sửa</button><button class="btn">Xóa</button></div></td>
          </tr></tbody>
        </table>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const headers = page.locator("#word-templates-table th");
    assert.equal(await headers.count(), 4);
    const fileColumn = await headers.nth(1).boundingBox();
    const actionColumn = await headers.nth(3).boundingBox();

    assert.ok(actionColumn.width < fileColumn.width);
    assert.ok(actionColumn.width < 240);
  } finally {
    await browser.close();
  }
});
