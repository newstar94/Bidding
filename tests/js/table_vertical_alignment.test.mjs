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
  "../../views/css/runtime-styles.css",
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

test("all table headers and data cells are vertically centered", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table id="plain-table"><thead><tr><th>Tiêu đề</th></tr></thead><tbody><tr><td>Dữ liệu</td></tr></tbody></table>
      <table class="data-table"><thead><tr><th>Tiêu đề</th></tr></thead><tbody><tr><td>Dữ liệu</td></tr></tbody></table>
      <table class="data-table detailed-evaluation-table"><thead><tr><th>Tiêu chí</th></tr></thead><tbody><tr><td>Nội dung dài</td></tr></tbody></table>
      <div id="modal-excel-preview"><table class="data-table"><thead><tr><th>Cột Excel</th></tr></thead><tbody><tr><td class="excel-preview-cell">Giá trị</td></tr></tbody></table></div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    const alignments = await page.locator("table th, table td").evaluateAll((cells) => (
      cells.map((cell) => getComputedStyle(cell).verticalAlign)
    ));
    assert.ok(alignments.length >= 8);
    assert.deepEqual([...new Set(alignments)], ["middle"]);
  } finally {
    await browser.close();
  }
});
