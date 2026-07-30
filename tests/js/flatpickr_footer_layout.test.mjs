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

test("datepicker cancel and confirm actions share the footer evenly", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div class="flatpickr-calendar open">
        <div class="flatpickr-footer">
          <button type="button" class="btn btn-outline">Hủy</button>
          <button type="button" class="btn btn-primary"><svg aria-hidden="true"></svg>Xác nhận</button>
        </div>
      </div>
    `);
    for (const path of stylesheetPaths) await page.addStyleTag({ path });

    for (const width of [534, 320]) {
      await page.locator(".flatpickr-calendar").evaluate((calendar, nextWidth) => {
        calendar.style.width = `${nextWidth}px`;
      }, width);
      const metrics = await page.locator(".flatpickr-footer").evaluate((footer) => {
        const [cancel, confirm] = [...footer.querySelectorAll("button")].map((button) => button.getBoundingClientRect());
        return {
          cancelWidth: cancel.width,
          confirmWidth: confirm.width,
          cancelHeight: cancel.height,
          confirmHeight: confirm.height,
          gap: confirm.left - cancel.right,
        };
      });
      assert.ok(Math.abs(metrics.cancelWidth - metrics.confirmWidth) <= 0.5, `button widths differ at ${width}px`);
      assert.equal(metrics.cancelHeight, metrics.confirmHeight);
      assert.ok(metrics.cancelHeight >= 44);
      assert.ok(metrics.gap >= 8);
    }
  } finally {
    await browser.close();
  }
});
