import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const viewsStylesheet = fileURLToPath(new URL("../../views/css/views.css", import.meta.url));
const wordTemplatesView = fileURLToPath(new URL("../../views/tabs/tab_bieumau.html", import.meta.url));
const wordIntegrationSource = fileURLToPath(new URL("../../frontend/documents/WordIntegration.js", import.meta.url));
const partnerViewSource = fileURLToPath(new URL("../../frontend/partners/PartnerView.js", import.meta.url));

test("Word template manager uses an add button without seeded default rows", async () => {
  const html = await readFile(wordTemplatesView, "utf8");

  assert.match(html, /id="word-template-add-button"/);
  assert.match(html, /id="word-file-input"[^>]*multiple/);
  assert.match(html, /aria-label="Chọn một hoặc nhiều biểu mẫu Word để thêm"/);
  assert.match(html, /<th class="text-center">STT<\/th>/);
  assert.match(html, /<th>File mẫu<\/th>/);
  assert.match(html, /colspan="5"/);
  assert.match(html, /id="word-template-assignment-list"/);
  assert.match(html, /id="word-template-assignment-save"/);
  assert.match(html, /Cài đặt biểu mẫu theo chức năng/u);
  assert.doesNotMatch(html, /id="word-drag-drop-zone"/);
  assert.doesNotMatch(html, /id="word-template-replace-input"/);
  assert.doesNotMatch(html, /Bản báo cáo đánh giá mặc định/);
  assert.doesNotMatch(html, /Mẫu hợp đồng kinh tế LCNT/);
});

test("Word template upload processes every selected file and refreshes once", async () => {
  const source = await readFile(wordIntegrationSource, "utf8");

  assert.match(source, /Array\.from\(e\.target\.files \|\| \[\]\)/);
  assert.match(source, /handleWordTemplateBatchUpload\.call\(this, files\)/);
  assert.match(source, /for \(const file of files\)/);
  assert.match(source, /reload: false/);
});

test("Word template rows render a one-based sequence number", async () => {
  const source = await readFile(partnerViewSource, "utf8");

  assert.match(source, /templatesPage\.items\.map\(\(tpl, index\) =>/);
  assert.match(source, /word-template-index-cell[^`]*\$\{templatesPage\.startIndex \+ index \+ 1\}/);
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
          <thead><tr><th>STT</th><th>Tên biểu mẫu</th><th>File mẫu</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
          <tbody><tr>
            <td>1</td><td>Biểu mẫu báo cáo</td><td>bao-cao.docx</td><td>Sẵn sàng</td>
            <td><div class="word-template-actions"><button class="btn">Sửa</button><button class="btn">Xóa</button></div></td>
          </tr></tbody>
        </table>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const headers = page.locator("#word-templates-table th");
    assert.equal(await headers.count(), 5);
    const indexColumn = await headers.nth(0).boundingBox();
    const nameColumn = await headers.nth(1).boundingBox();
    const fileColumn = await headers.nth(2).boundingBox();
    const actionColumn = await headers.nth(4).boundingBox();

    assert.ok(indexColumn.width >= 72);
    assert.ok(fileColumn.width < nameColumn.width);
    assert.ok(actionColumn.width >= 156);
    assert.ok(actionColumn.width < fileColumn.width);
    assert.ok(actionColumn.width < 240);
  } finally {
    await browser.close();
  }
});

test("Word template list shows a tall overview with a sticky header", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.setContent(`
      <section id="tab-bieumau">
        <div class="table-container word-template-table-container">
          <table class="data-table" id="word-templates-table">
            <thead><tr><th>STT</th><th>Template name</th><th>File</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${Array.from({ length: 20 }, (_, index) => `<tr><td>${index + 1}</td><td>Template ${index + 1}</td><td>template-${index + 1}.docx</td><td>Available</td><td>Open</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const container = page.locator(".word-template-table-container");
    const styles = await container.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        minHeight: Number.parseFloat(computed.minHeight),
        maxHeight: Number.parseFloat(computed.maxHeight),
        overflowY: computed.overflowY,
      };
    });
    const headerPosition = await page.locator("#word-templates-table thead th").first().evaluate(
      (element) => getComputedStyle(element).position,
    );

    assert.ok(styles.minHeight >= 360);
    assert.ok(styles.maxHeight >= 480);
    assert.equal(styles.overflowY, "auto");
    assert.equal(headerPosition, "sticky");
  } finally {
    await browser.close();
  }
});

test("Word template rows stay compact and icon actions remain horizontal", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 700 } });
    await page.setContent(`
      <section id="tab-bieumau">
        <table class="data-table" id="word-templates-table" data-density="compact">
          <tbody><tr>
            <td class="word-template-index-cell">1</td><td>Template</td><td>template.docx</td><td>Active</td>
            <td class="word-template-action-cell"><div class="word-template-actions">
              <button class="btn btn-outline btn-sm word-template-action-button"><i></i></button>
              <button class="btn btn-outline btn-sm word-template-action-button"><i></i></button>
              <button class="btn btn-danger btn-sm word-template-action-button"><i></i></button>
            </div></td>
          </tr></tbody>
        </table>
      </section>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const rowHeight = await page.locator("#word-templates-table tbody tr").evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    const actionStyles = await page.locator(".word-template-actions").evaluate((element) => {
      const computed = getComputedStyle(element);
      return { display: computed.display, flexWrap: computed.flexWrap };
    });
    const buttons = await page.locator(".word-template-action-button").all();
    const buttonBoxes = await Promise.all(buttons.map((button) => button.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { y: rect.y, width: rect.width, height: rect.height };
    })));

    assert.ok(rowHeight <= 56);
    assert.deepEqual(actionStyles, { display: "flex", flexWrap: "nowrap" });
    assert.equal(new Set(buttonBoxes.map((box) => box.y)).size, 1);
    assert.ok(buttonBoxes.every((box) => box.width === 36 && box.height === 36));
  } finally {
    await browser.close();
  }
});
