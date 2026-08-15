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

test("goods hierarchy table fits its container without horizontal scrolling", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="table-container package-goods-table">
        <table class="data-table package-goods-hierarchy-table">
          <colgroup>
            <col class="package-goods-col-sequence">
            <col class="package-goods-col-lot-code">
            <col class="package-goods-col-lot-name">
            <col class="package-goods-col-name">
            <col class="package-goods-col-unit">
            <col class="package-goods-col-quantity">
            <col class="package-goods-col-actions">
          </colgroup>
          <thead><tr><th>STT</th><th>Mã phần (lô)</th><th>Tên phần lô</th><th>Danh mục hàng hóa</th><th class="package-goods-unit">Đơn vị tính</th><th class="package-goods-quantity">Khối lượng</th><th>Thao tác</th></tr></thead>
          <tbody>
            <tr class="package-goods-lot-row"><td>1</td><td>PL1</td><td>Lô 1</td><td colspan="4"></td></tr>
            <tr class="package-goods-item-row"><td class="package-goods-sequence">1.1</td><td></td><td></td><td class="package-goods-name">Hóa chất xét nghiệm định lượng C-reactive protein dùng cho máy xét nghiệm sinh hóa</td><td class="package-goods-unit">Hộp</td><td class="package-goods-quantity">18</td><td class="package-goods-actions-cell"><div class="action-btn-group"><button class="action-btn btn-edit" aria-label="Sửa">${icon}</button><button class="action-btn btn-delete" aria-label="Xóa">${icon}</button></div></td></tr>
            <tr class="package-goods-item-row package-goods-item-row--editing package-goods-item-row--creating"><td class="package-goods-sequence">1.2</td><td colspan="2"><select class="bf-combobox-native" hidden><option>Lô 1</option></select><div class="bf-combobox is-searchable open"><input class="bf-combobox-input" value="PL1 — Lô 1"><button class="bf-combobox-toggle"><span class="bf-combobox-chevron"></span></button><ul class="bf-combobox-list"><li class="bf-combobox-option selected">PL1 — Lô 1</li><li class="bf-combobox-option">PL2 — Lô 2</li></ul></div></td><td><textarea class="form-control package-goods-inline-control package-goods-inline-name"></textarea></td><td><input class="form-control package-goods-inline-control package-goods-inline-unit"></td><td><input class="form-control package-goods-inline-control package-goods-inline-number" type="number"></td><td class="package-goods-actions-cell"><div class="package-goods-inline-actions"><button class="action-btn btn-edit package-goods-inline-action--save" aria-label="Lưu">${icon}</button><button class="action-btn btn-delete package-goods-inline-action--cancel" aria-label="Hủy">${icon}</button></div></td></tr>
          </tbody>
        </table>
      </div>`);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    const alignment = await page.evaluate(() => ({
      unitHeader: getComputedStyle(document.querySelector("thead .package-goods-unit")).textAlign,
      unitCell: getComputedStyle(document.querySelector("tbody .package-goods-unit")).textAlign,
      quantityHeader: getComputedStyle(document.querySelector("thead .package-goods-quantity")).textAlign,
      quantityCell: getComputedStyle(document.querySelector("tbody .package-goods-quantity")).textAlign,
    }));
    assert.deepEqual(alignment, {
      unitHeader: "center",
      unitCell: "center",
      quantityHeader: "right",
      quantityCell: "right",
    });
    const columnWidths = await page.locator(".package-goods-table").evaluate((container) => ({
      table: container.querySelector("table").getBoundingClientRect().width,
      lotCode: container.querySelector("thead th:nth-child(2)").getBoundingClientRect().width,
      lotName: container.querySelector("thead th:nth-child(3)").getBoundingClientRect().width,
    }));
    assert.ok(columnWidths.lotCode >= columnWidths.table * 0.105);
    assert.ok(columnWidths.lotName > columnWidths.lotCode);
    assert.ok(columnWidths.lotName >= columnWidths.table * 0.115);
    const comboboxStyle = await page.locator(".package-goods-table .bf-combobox-input").evaluate((input) => ({
      height: getComputedStyle(input).height,
      listDisplay: getComputedStyle(input.closest(".bf-combobox").querySelector(".bf-combobox-list")).display,
      listPosition: getComputedStyle(input.closest(".bf-combobox").querySelector(".bf-combobox-list")).position,
    }));
    assert.deepEqual(comboboxStyle, { height: "38px", listDisplay: "block", listPosition: "absolute" });

    for (const width of [1440, 1200, 1024, 768, 600]) {
      await page.setViewportSize({ width, height: 600 });
      const metrics = await page.locator(".package-goods-table").evaluate((container) => ({
        clientWidth: container.clientWidth,
        scrollWidth: container.scrollWidth,
        scrollLeft: container.scrollLeft,
        actionCell: (() => {
          const rect = container.querySelector(".package-goods-actions-cell").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
        actionGroup: (() => {
          const rect = container.querySelector(".package-goods-actions-cell .action-btn-group").getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        })(),
      }));
      assert.equal(metrics.scrollWidth, metrics.clientWidth, `table overflows at ${width}px`);
      assert.equal(metrics.scrollLeft, 0);
      assert.ok(metrics.actionGroup.left >= metrics.actionCell.left - 0.5, `actions overflow left at ${width}px`);
      assert.ok(metrics.actionGroup.right <= metrics.actionCell.right + 0.5, `actions overflow right at ${width}px`);
    }
  } finally {
    await browser.close();
  }
});
