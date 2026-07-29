import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const stylesheetPaths = [
  "../../views/css/tokens.css",
  "../../views/css/variables.css",
  "../../views/css/base.css",
  "../../views/css/components.css",
  "../../views/css/views.css",
  "../../views/css/generated-static-styles.css",
  "../../views/css/ui-redesign.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

const icon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16"></path></svg>';

test("goods toolbar keeps all desktop and tablet actions on one aligned row", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <header class="package-section-header package-goods-toolbar">
          <div class="package-goods-heading">
            <h4 class="package-section-title is-neutral package-goods-title">Danh mục hàng hóa</h4>
            <p class="package-goods-summary">0 mặt hàng</p>
          </div>
          <div class="compact-action-group package-goods-actions">
            <label class="package-goods-search">${icon}<input class="form-control" placeholder="Tìm mã hoặc tên hàng hóa"></label>
            <button class="btn btn-outline">${icon}Tải file mẫu</button>
            <button class="btn btn-outline">${icon}Xuất Excel</button>
            <button class="btn btn-outline" disabled>${icon}Nhập Excel</button>
            <button class="btn btn-primary" disabled>${icon}Thêm hàng hóa</button>
          </div>
        </header>
      </main>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    for (const width of [2048, 1440, 1280, 1200, 1024, 768]) {
      await page.setViewportSize({ width, height: 500 });
      const layout = await page.evaluate(() => ({
        buttonTops: [...document.querySelectorAll(".package-goods-actions .btn")]
          .map((button) => button.offsetTop),
        buttonHeights: [...document.querySelectorAll(".package-goods-actions .btn")]
          .map((button) => button.offsetHeight),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      assert.equal(
        new Set(layout.buttonTops).size,
        1,
        `toolbar actions wrapped at ${width}px: ${layout.buttonTops.join(", ")}`,
      );
      assert.equal(new Set(layout.buttonHeights).size, 1, `button heights differ at ${width}px`);
      assert.equal(layout.overflow, false, `toolbar overflows at ${width}px`);
    }

    for (const [width, expectedButtonRows] of [[720, 2], [600, 2], [440, 4], [320, 4]]) {
      await page.setViewportSize({ width, height: 700 });
      const layout = await page.evaluate(() => ({
        buttonTops: [...document.querySelectorAll(".package-goods-actions .btn")]
          .map((button) => button.offsetTop),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      assert.equal(new Set(layout.buttonTops).size, expectedButtonRows);
      assert.equal(layout.overflow, false, `toolbar overflows at ${width}px`);
    }
  } finally {
    await browser.close();
  }
});
