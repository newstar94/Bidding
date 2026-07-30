import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const viewsStylesheet = fileURLToPath(new URL("../../views/css/views.css", import.meta.url));

test("detailed evaluation table hands vertical scrolling to its parent at the boundary", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
    await page.setContent(`
      <div id="page-scroll" style="height:300px;overflow-y:auto">
        <div style="height:120px"></div>
        <div class="detailed-evaluation-table-frame" style="height:160px">
          <div style="height:700px">Nội dung bảng</div>
        </div>
        <div style="height:900px"></div>
      </div>
    `);
    await page.addStyleTag({ path: viewsStylesheet });

    const frame = page.locator(".detailed-evaluation-table-frame");
    const parent = page.locator("#page-scroll");
    await frame.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const frameBox = await frame.boundingBox();
    await page.mouse.move(frameBox.x + frameBox.width / 2, frameBox.y + frameBox.height / 2);
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(50);

    const behavior = await frame.evaluate((element) => ({
      x: getComputedStyle(element).overscrollBehaviorX,
      y: getComputedStyle(element).overscrollBehaviorY,
    }));
    assert.deepEqual(behavior, { x: "contain", y: "auto" });
    assert.ok(await parent.evaluate((element) => element.scrollTop) > 0);
  } finally {
    await browser.close();
  }
});
